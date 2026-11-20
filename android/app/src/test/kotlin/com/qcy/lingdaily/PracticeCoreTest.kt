package com.qcy.lingdaily

import java.io.File
import java.nio.file.Files
import java.util.UUID
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import com.qcy.lingdaily.core.model.AIFeedback
import com.qcy.lingdaily.core.model.AILearningItem
import com.qcy.lingdaily.core.model.AIPracticeAction
import com.qcy.lingdaily.core.model.AIPracticeResponse
import com.qcy.lingdaily.core.model.AIPracticeTurn
import com.qcy.lingdaily.core.model.AIScenarioResponse
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.PartnerTemperament
import com.qcy.lingdaily.core.model.PracticeArchive
import com.qcy.lingdaily.core.model.PracticeLevel
import com.qcy.lingdaily.core.model.PracticeMessage
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.PracticeSession.Phase
import com.qcy.lingdaily.core.model.PracticeStep
import com.qcy.lingdaily.core.model.ReviewTarget
import com.qcy.lingdaily.core.persistence.ArchiveFile
import com.qcy.lingdaily.core.realtime.LiveTokenRequest

fun testScenario(steps: Int = 3, id: String = "test"): PracticeScenario = PracticeScenario(
    id = id, title = "Test rehearsal", subtitle = "Test", category = "Test", symbol = "waveform",
    partner = "Alex", partnerRole = "Colleague", setting = "Test",
    steps = (0 until steps).map {
        PracticeStep("step-$it", "Task $it", "Question $it?", "问题", "提示", "word", "Example $it", "示例")
    },
)

/** Applies a transition that must be accepted. */
fun PracticeSession?.must(): PracticeSession = this ?: throw AssertionError("transition was refused")

class PracticeCoreTest {
    private val scenario = testScenario(steps = 2)

    private fun withFile(body: (File) -> Unit) {
        val directory = Files.createTempDirectory("lingdaily-tests").toFile()
        try {
            body(File(directory, "nested/archive.json"))
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun emptyAndOversizedSubmissionsNeverCreateHistory() {
        var session = PracticeSession.start(scenario)
        assertNull(session.submit(" \n "))
        assertNull(session.submit("a".repeat(801)))
        session = session.advance().beginRetry()
        assertEquals(Phase.SPEAKING, session.phase)
        assertEquals(0, session.stepIndex)
        assertTrue(PracticeArchive().upsert(session).sessions.isEmpty())
    }

    @Test
    fun retryPreservesOriginalAndDoesNotAdvanceTask() {
        var session = PracticeSession.start(scenario).submit("  Original answer  ").must()
        assertNull(session.submit("Accidental double submit"))
        session = session.beginRetry().advance() // Can't skip while a retry is waiting for input.
        assertEquals(Phase.RETRY, session.phase)
        session = session.submit("A second version").must().beginRetry().submit("A third version").must()
        assertEquals("Original answer", session.messages.last { it.kind == PracticeMessage.Kind.ANSWER }.text)
        assertEquals(listOf("Original answer", "A second version", "A third version"),
            session.messages.filter { it.role == PracticeMessage.Role.USER }.map { it.text })
        assertEquals(2, session.retryCount)
        assertEquals(0, session.stepIndex)
        session = session.advance()
        assertEquals(1, session.stepIndex)
        assertEquals("Question 1?", session.messages.last().text)
        assertEquals(Phase.SPEAKING, session.phase)
    }

    @Test
    fun completionRequiresEveryTaskAndIsTerminal() {
        var session = PracticeSession.start(scenario).submit("First").must().advance().advance()
        assertEquals(Phase.SPEAKING, session.phase)
        session = session.submit("Second").must().advance()
        assertEquals(Phase.COMPLETED, session.phase)
        assertEquals(2, session.completedSteps)
        assertNull(session.submit("Too late"))
        assertEquals(session, session.beginRetry().advance())
    }

    @Test
    fun cancelRetryKeepsOriginalWithoutInventingAnotherTurn() {
        var session = PracticeSession.start(scenario).submit("Keep this answer").must().beginRetry().cancelRetry()
        assertEquals(Phase.REVIEW, session.phase)
        assertEquals(1, session.userTurns)
        assertEquals(0, session.retryCount)
        session = session.advance()
        assertEquals(1, session.stepIndex)
    }

    @Test
    fun savingUpdatesSameSessionButKeepsNewAttemptsSeparate() {
        var first = PracticeSession.start(scenario, goal = "  My goal  ")
        assertEquals("My goal", first.title)
        first = first.submit("First").must()
        var archive = PracticeArchive().upsert(first)
        first = first.beginRetry().submit("Again").must()
        archive = archive.upsert(first)
        assertEquals(1, archive.sessions.size)
        assertEquals(1, archive.sessions[0].retryCount)
        val next = PracticeSession.start(scenario).submit("Another day", now = System.currentTimeMillis() + 5000).must()
        archive = archive.upsert(next)
        assertEquals(2, archive.sessions.size)
        assertEquals(next.id, archive.sessions.first().id)
    }

    @Test
    fun favoritesNormalizeIdentityAndToggle() {
        var archive = PracticeArchive().toggleExpression("Could we try?", "试试？", "Test")
            .toggleExpression(" COULD WE TRY?  ", "试试？", "Test")
        assertTrue(archive.expressions.isEmpty())
        archive = archive.toggleExpression("Could we try?", "试试？", "Test").toggleExpression("  ", "", "")
        assertEquals(1, archive.expressions.size)
    }

    @Test
    fun archiveRoundTripCanResumeRetryAndKeepsFavorites() = withFile { path ->
        val file = ArchiveFile(path)
        assertEquals(PracticeArchive(), file.load())
        val session = PracticeSession.start(scenario, goal = "Tomorrow", context = "Be polite").submit("First try").must().beginRetry()
        val archive = PracticeArchive().upsert(session).toggleExpression("Useful phrase", "好用的表达", "Test")
        file.save(archive)
        val loaded = file.load()
        assertEquals(archive, loaded)
        val resumed = loaded.sessions.first().submit("Second try").must()
        assertEquals("First try", resumed.messages.last { it.kind == PracticeMessage.Kind.ANSWER }.text)
        assertEquals(1, resumed.retryCount)
    }

    @Test
    fun corruptFutureAndInvalidArchivesAreRejectedWithoutChangingBytes() = withFile { path ->
        val file = ArchiveFile(path)
        path.parentFile!!.mkdirs()
        for (bytes in listOf("broken JSON", "{\"schemaVersion\":3,\"sessions\":[],\"expressions\":[]}")) {
            path.writeText(bytes)
            assertThrows(Exception::class.java) { file.load() }
            assertEquals(bytes, path.readText())
        }
        val archive = PracticeArchive().upsert(PracticeSession.start(scenario).submit("Hello").must())
        val json = AppJson.encodeToJsonElement(PracticeArchive.serializer(), archive).jsonObject
        val broken = JsonObject(json + ("sessions" to kotlinx.serialization.json.JsonArray(
            json.getValue("sessions").jsonArray.map { JsonObject(it.jsonObject + ("stepIndex" to JsonPrimitive(-1))) })))
        path.writeText(broken.toString())
        assertThrows(Exception::class.java) { file.load() }
    }

    // ---- AI turns ----

    private val aiScenario = testScenario(steps = 3, id = "deadline")

    private fun response(session: PracticeSession, answer: Boolean = false) = AIPracticeResponse(
        requestId = session.pendingAIRequest!!.requestId, model = "test-model",
        data = AIPracticeTurn("A real model reply", "来自模型的回复", "说说你的计划", "plan, Thursday",
            "Could we move it to Thursday?", "能改到周四吗？",
            if (answer) AIFeedback("I need until Thursday.", "我需要到周四。", "把具体日期说清楚。") else null),
    )

    @Test
    fun aiMustReplyBeforeInputOrTaskAdvances() {
        var session = PracticeSession.start(aiScenario, useAI = true)
        assertTrue(session.messages.isEmpty())
        assertNull(session.submit("Too early"))
        session = session.applyAIResponse(response(session)).must()
        assertEquals(1, session.messages.size)
        assertFalse(session.messages[0].text.contains("Question"))
        session = session.submit("I need Thursday").must()
        assertEquals(AIPracticeAction.ANSWER, session.pendingAIRequest?.action)
        session = session.beginRetry().advance()
        assertEquals(Phase.REVIEW, session.phase)
        assertEquals(0, session.stepIndex)
        assertNull(session.submit("Double tap"))
        session = session.applyAIResponse(response(session, answer = true)).must()
        assertEquals("I need until Thursday.", session.currentFeedback?.revised)
        session = session.advance()
        assertEquals(AIPracticeAction.ADVANCE, session.pendingAIRequest?.action)
        assertEquals(PracticeMessage.Kind.RESPONSE, session.messages.last().kind)
        session = session.applyAIResponse(response(session)).must()
        assertEquals(PracticeMessage.Kind.PROMPT, session.messages.last().kind)
        assertEquals(1, session.stepIndex)
    }

    @Test
    fun lateOrDuplicateReplyCannotOverwriteState() {
        var session = PracticeSession.start(aiScenario, useAI = true)
        val opening = response(session)
        session = session.applyAIResponse(opening).must()
        assertNull(session.applyAIResponse(opening))
        session = session.submit("I need time").must()
        assertNull(session.applyAIResponse(opening))
        assertNotNull(session.pendingAIRequest)
        // A reply shaped for the wrong action is refused: answers need feedback, openings must not have it.
        assertNull(session.applyAIResponse(response(session, answer = false)))
    }

    @Test
    fun retryHasIndependentFeedbackAndKeepsOriginal() {
        var session = PracticeSession.start(aiScenario, useAI = true)
        session = session.applyAIResponse(response(session)).must().submit("I need Thursday").must()
        session = session.applyAIResponse(response(session, answer = true)).must()
        session = session.beginRetry().submit("Would Thursday work for you?").must()
        assertNull(session.currentFeedback)
        session = session.applyAIResponse(response(session, answer = true)).must()
        assertEquals("I need Thursday", session.messages.last { it.kind == PracticeMessage.Kind.ANSWER }.text)
        assertEquals(1, session.retryCount)
        assertEquals(2, session.ai?.feedbacks?.map { it.id }?.toSet()?.size)
        for (message in session.messages) {
            assertEquals(message.role == PracticeMessage.Role.USER, session.feedback(message.id) != null)
        }
    }

    @Test
    fun pendingRequestIdentitySurvivesArchiveRoundTripAndCompletionCoversAllTasks() {
        var session = PracticeSession.start(aiScenario, useAI = true)
        session = session.applyAIResponse(response(session)).must().submit("An answer awaiting AI").must()
        val loaded = AppJson.decodeFromString<PracticeArchive>(AppJson.encodeToString(PracticeArchive().upsert(session)))
        assertEquals(session.pendingAIRequest?.requestId, loaded.sessions.first().pendingAIRequest?.requestId)
        assertTrue(loaded.sessions[0].isValid)

        var full = PracticeSession.start(aiScenario, useAI = true)
        repeat(3) { index ->
            full = full.applyAIResponse(response(full)).must().submit("My answer for task $index").must()
            full = full.applyAIResponse(response(full, answer = true)).must().advance()
        }
        assertEquals(Phase.COMPLETED, full.phase)
        assertNull(full.pendingAIRequest)
        assertEquals(listOf(0, 1, 2), full.ai?.feedbacks?.map { it.stepIndex })
    }

    @Test
    fun requestsCarryLevelTemperamentAndReviewItemsOnlyWhenSet() {
        val standard = PracticeSession.start(aiScenario, useAI = true)
        val encoded = AppJson.encodeToJsonElement(com.qcy.lingdaily.core.model.AIPracticeRequest.serializer(), standard.pendingAIRequest!!).jsonObject
        // The server's schema is strict: defaults must be absent, not null.
        assertEquals(setOf("requestId", "sessionId", "action", "stepIndex", "goal", "context", "scenario", "messages"), encoded.keys)
        assertEquals(setOf("title", "partner", "partnerRole", "setting", "goals"), encoded.getValue("scenario").jsonObject.keys)

        val review = listOf(ReviewTarget("availability", "空闲时间"))
        val easy = PracticeSession.start(aiScenario.withPersona(" 嘴硬 "), useAI = true, level = PracticeLevel.EASY,
            temperament = PartnerTemperament.at(0.9, -0.3), reviewItems = review)
        val request = easy.pendingAIRequest!!
        assertEquals("easy", request.level)
        assertEquals(review, request.reviewItems)
        assertEquals("嘴硬", request.scenario.persona)
        assertEquals(PartnerTemperament(2, -1), request.temperament)
        assertEquals("easy", LiveTokenRequest.from(easy).level)
        val restored = AppJson.decodeFromString<PracticeSession>(AppJson.encodeToString(easy))
        assertEquals(easy, restored)
        // A level or temperament shape from a newer app never breaks decoding.
        val json = AppJson.encodeToJsonElement(PracticeSession.serializer(), easy).jsonObject
        val newer = AppJson.decodeFromJsonElement(PracticeSession.serializer(), JsonObject(json +
            ("level" to JsonPrimitive("expert")) + ("temperament" to JsonPrimitive("stormy")) + ("futureField" to JsonPrimitive(1))))
        assertEquals(PracticeLevel.STANDARD, newer.practiceLevel)
        assertTrue(newer.partnerTemperament.isScenario)
    }

    @Test
    fun temperamentSnapsToLevelsAndDescribesItself() {
        assertEquals(PartnerTemperament(2, 2), PartnerTemperament(9, 9))
        assertEquals(PartnerTemperament(-1, 1), PartnerTemperament.at(-0.25, 0.26))
        assertTrue(PartnerTemperament.at(0.2, -0.2).isScenario)
        assertNull(PartnerTemperament.scenario.label)
        assertEquals("寸步不让、冷淡克制", PartnerTemperament(2, -2).label)
        assertEquals("情绪外露", PartnerTemperament(0, 1).label)
    }

    @Test
    fun generatedScenarioNeedsExactlyThreeFilledSteps() {
        val step = AIScenarioResponse.Step("目标", "Hi?", "你好？", "提示", "kw", "Hello.", "你好。")
        fun draft(count: Int) = AIScenarioResponse(UUID.randomUUID(), "m",
            AIScenarioResponse.Draft("退押金", "确认", "日常", "Morgan", "房东", "情境", List(count) { step }))
        assertNull(draft(2).makeScenario())
        val scenario = draft(3).makeScenario()!!
        assertTrue(scenario.id.matches(Regex("^custom-[0-9A-F-]{36}$")))
        assertEquals(3, scenario.steps.map { it.id }.toSet().size)
    }

    @Test
    fun collectedWordsAreDeduplicatedAndNewestFirst() {
        val archive = PracticeArchive().collect(listOf(AILearningItem("on track", "phrase", "按计划"),
            AILearningItem("availability", "word", "空闲时间")), source = "s")
            .collect(listOf(AILearningItem(" On Track ", "phrase", "x")), source = "t")
        assertEquals(listOf("on track", "availability"), archive.expressions.map { it.id })
        assertEquals("s", archive.expressions[0].source)
    }
}
