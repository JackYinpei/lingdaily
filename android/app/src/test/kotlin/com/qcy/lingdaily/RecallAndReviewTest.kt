package com.qcy.lingdaily

import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.UUID
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import com.qcy.lingdaily.core.model.AIFeedback
import com.qcy.lingdaily.core.model.AILearningItem
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.PracticeArchive
import com.qcy.lingdaily.core.model.PracticeMessage.Role
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.PracticeStats
import com.qcy.lingdaily.core.model.RecallMatcher
import com.qcy.lingdaily.core.model.ReminderPlan
import com.qcy.lingdaily.core.model.ReviewLog
import com.qcy.lingdaily.core.model.ReviewPicker
import com.qcy.lingdaily.core.model.ReviewTarget
import com.qcy.lingdaily.core.model.SavedExpression
import com.qcy.lingdaily.core.model.ScenarioCatalogResponse
import com.qcy.lingdaily.core.model.SentenceReviewRecord
import com.qcy.lingdaily.core.model.SentenceReviewResponse
import com.qcy.lingdaily.core.model.TodayResponse
import com.qcy.lingdaily.core.model.learnerMessages
import com.qcy.lingdaily.core.model.nextSentenceReview
import com.qcy.lingdaily.core.model.sentenceReview
import com.qcy.lingdaily.core.model.session
import com.qcy.lingdaily.core.model.summaryLines

class RecallAndReviewTest {
    private val scenario = testScenario(steps = 3, id = "deadline").copy(title = "把延期说清楚")
    private val zone = ZoneId.of("Asia/Shanghai")

    private fun liveSession(vararg lines: String, review: List<ReviewTarget> = emptyList(), now: Long = System.currentTimeMillis()): PracticeSession {
        var session = PracticeSession.start(scenario, useAI = true, reviewItems = review, now = now).beginLive("live-model", now)
        for (line in lines) session = session.liveTranscript(UUID.randomUUID(), Role.USER, line, now).must()
        return session
    }

    @Test
    fun recallIgnoresCasePunctuationAndSimpleEndings() {
        assertTrue(RecallMatcher.matches("availability", "What's your Availability on Friday?"))
        assertTrue(RecallMatcher.matches("move the launch", "Could we moved the launch to Monday"))
        assertTrue(RecallMatcher.matches("try", "He tries again."))
        assertFalse("A phrase keeps its order", RecallMatcher.matches("move the launch", "the launch, move it"))
        assertFalse(RecallMatcher.matches("deadline", ""))
        val sentence = "I need about two more days to fix and test it."
        assertTrue(RecallMatcher.matches(sentence, "I need about two more days to fix and test it"))
        assertTrue("One STT change is fine", RecallMatcher.matches(sentence, "I need about 2 more days to fix and test it."))
        assertFalse(RecallMatcher.matches(sentence, "I need more time."))
    }

    @Test
    fun reviewPickerBringsBackFreshWordsNotSentencesOrUsedOnes() {
        var archive = PracticeArchive().collect(listOf(AILearningItem("on track", "phrase", "按计划"),
            AILearningItem("availability", "word", "空闲时间"), AILearningItem("would rather", "grammar", "宁愿")), "s")
            .toggleExpression("Could we move it to Monday?", "能改到周一吗？", "s")
        assertEquals("Newest first; no sentence or grammar", listOf("on track", "availability"), ReviewPicker.pick(archive).map { it.text })
        archive = archive.upsert(liveSession("We are on track.", review = listOf(ReviewTarget("on track", "按计划"))))
        assertEquals("Used ones are not brought back", listOf("availability"), ReviewPicker.pick(archive).map { it.text })
        archive = archive.upsert(liveSession("Hello.", review = listOf(ReviewTarget("availability", "空闲时间"))))
            .collect(listOf(AILearningItem("verification code", "phrase", "验证码")), "s")
        assertEquals("Least targeted first", listOf("verification code", "availability"), ReviewPicker.pick(archive).map { it.text })
        archive = archive.collect(listOf(AILearningItem("room service", "phrase", "客房服务")), "入住出了点小状况")
        val hotel = scenario.copy(id = "hotel", title = "入住出了点小状况")
        assertEquals("Words met in this scenario come first", "room service", ReviewPicker.pick(archive, hotel).first().text)
    }

    @Test
    fun liveCollectedWordsAndReusedReviewItemsReachTheSummaryAndTheSourceConversation() {
        val review = listOf(ReviewTarget("availability", "空闲时间"), ReviewTarget("on track", "按计划"))
        val session = liveSession("Is there any availability on Monday?", review = review)
            .recordCollected(listOf(AILearningItem("verification code", "phrase", "验证码")))
            .recordCollected(listOf(AILearningItem("Verification code", "phrase", "验证码")))
        assertEquals(listOf("verification code"), session.collectedItems.map { it.text })
        assertEquals(listOf("availability"), session.reusedReviewItems.map { it.text })
        val archive = PracticeArchive().upsert(session).collect(session.collectedItems, session.scenario.title)
        assertEquals(session.id, archive.session(archive.expressions.first())?.id)
        assertNull(archive.session(SavedExpression("x", "x", "", "另一个场景", 0)))
    }

    @Test
    fun reviewsAreSpacedFurtherApartEachTimeAnItemIsRecalled() {
        val day = 86_400_000L
        val items = listOf("a", "b", "c", "d").map { SavedExpression(it, it, if (it == "d") " " else "意思", "s", 0) }
        // a was recalled twice (next gap 3 days), b was missed (due again at once), c is new, d has no meaning to recall.
        var log = ReviewLog().record("a", recalled = true, now = 0).record("a", recalled = true, now = day)
            .record("b", recalled = false, now = day)
        assertEquals(ReviewLog.Entry(day, 2, 2, streak = 2), log.entries["a"])
        assertEquals(day + 3 * day, log.entries.getValue("a").dueAt)
        assertEquals("A miss comes back first, then what is new", listOf("b", "c"), log.deck(items, now = 2 * day).map { it.id })
        assertEquals(listOf("b"), log.due(items, now = 2 * day).map { it.id })
        assertEquals("Due items in order of how overdue they are, then new ones", listOf("b", "a", "c"), log.deck(items, now = 5 * day).map { it.id })
        assertEquals(listOf("b", "a"), log.deck(items, limit = 2, now = 5 * day).map { it.id })

        log = log.record("b", recalled = true, now = 5 * day).record("c", recalled = true, now = 5 * day).record("a", recalled = true, now = 5 * day)
        assertEquals(1, log.entries.getValue("b").streak)
        assertTrue(log.due(items, now = 5 * day + 1).isEmpty())
        assertEquals("Nothing due: the soonest ones are still offered", listOf("b", "c", "a"), log.deck(items, now = 5 * day + 1).map { it.id })
        assertEquals(setOf("b", "c"), log.due(items, now = 6 * day).map { it.id }.toSet())
        // A long streak never runs past the last gap, and a log written before spacing still loads.
        var long = ReviewLog()
        repeat(12) { long = long.record("a", recalled = true, now = 0) }
        assertEquals(30 * day, long.entries.getValue("a").dueAt)
        assertEquals(0, AppJson.decodeFromString<ReviewLog>("""{"entries":{"a":{"lastReviewedAt":"2026-10-01T00:00:00.000Z","attempts":3,"recalled":2}}}""").entries.getValue("a").streak)
        assertEquals(log, AppJson.decodeFromString<ReviewLog>(AppJson.encodeToString(log)))
    }

    @Test
    fun statsCountSpokenTurnsAndActiveDaysInTheLearnersTimeZone() {
        val now = ZonedDateTime.of(2026, 10, 26, 22, 0, 0, 0, zone).toInstant().toEpochMilli()
        val day = 86_400_000L
        val sessions = listOf(
            liveSession("One.", "Two.", now = now - 3_600_000),
            liveSession("Yesterday.", now = now - day),
            liveSession("Last week.", now = now - 7 * day),
        )
        assertEquals(PracticeStats.Recent(activeDays = 2, turns = 3), PracticeStats.recent(sessions, now = now, zone = zone))
        assertTrue(PracticeStats.spokeToday(sessions, now = now, zone = zone))
        assertFalse(PracticeStats.spokeToday(sessions.drop(1), now = now, zone = zone))
        // 23:30 the evening before is a different local day, even though it is less than 24 hours ago.
        val morning = ZonedDateTime.of(2026, 10, 26, 8, 0, 0, 0, zone).toInstant().toEpochMilli()
        assertFalse(PracticeStats.spokeToday(listOf(liveSession("Late.", now = morning - 8 * 3_600_000 - 1_800_000)), now = morning, zone = zone))

        assertEquals(listOf(0, 0, 0, 0, 0, 1, 2), PracticeStats.daily(sessions, now = now, zone = zone).map { it.turns })
        assertEquals(26, PracticeStats.daily(sessions, now = now, zone = zone).last().date.dayOfMonth)
        assertEquals(2, PracticeStats.streak(sessions, now = now, zone = zone))
        assertEquals("Yesterday's streak still counts before today's practice", 1, PracticeStats.streak(sessions.drop(1), now = now, zone = zone))
        assertEquals(0, PracticeStats.streak(sessions.drop(2), now = now, zone = zone))
    }

    @Test
    fun remindersSkipTimesAlreadyPastAndDaysAlreadyPractised() {
        val now = ZonedDateTime.of(2026, 10, 26, 20, 30, 0, 0, zone).toInstant().toEpochMilli()
        fun hour(millis: Long) = java.time.Instant.ofEpochMilli(millis).atZone(zone).hour
        fun dayOfMonth(millis: Long) = java.time.Instant.ofEpochMilli(millis).atZone(zone).dayOfMonth
        val events = ReminderPlan.event(LocalDate.of(2026, 10, 28), now, zone)
        assertEquals(listOf(20 to false, 8 to true), events.map { hour(it.at) to it.isSameDay })
        assertEquals("Tomorrow's eve reminder (tonight 20:00) has passed", listOf(true),
            ReminderPlan.event(LocalDate.of(2026, 10, 27), now, zone).map { it.isSameDay })
        assertTrue(ReminderPlan.event(LocalDate.of(2026, 10, 26), now, zone).isEmpty())
        assertEquals(7, ReminderPlan.daily(21, 30, practicedToday = false, now = now, zone = zone).size)
        val practised = ReminderPlan.daily(21, 30, practicedToday = true, now = now, zone = zone)
        assertEquals(6, practised.size)
        assertEquals(27, dayOfMonth(practised[0]))
        assertEquals("20:00 today has passed", 6, ReminderPlan.daily(20, 0, practicedToday = false, now = now, zone = zone).size)
    }

    @Test
    fun todayAndCatalogDecodeAndRejectWhatTheAppCannotPractise() {
        val step = """{"goal":"说说新闻","prompt":"Did you hear about it?","translation":"你听说了吗？","hint":"先说是什么新闻。","keywords":"I heard","expression":"I heard that foldable phones got cheaper.","meaning":"我听说折叠屏降价了。"}"""
        val today = AppJson.decodeFromString<TodayResponse>("""
            {"today":{"date":"2026-10-26","title":"LingDaily 10/26","summary":"今天聊折叠屏。","audioURL":"https://cos.example.test/a.mp3",
            "duration":612,"vocabulary":[{"term":"foldable phone","meaning":"折叠屏手机","example":"It's a foldable phone."}],
            "scenario":{"title":"聊聊折叠屏","subtitle":"说说看法","category":"社交","partner":"Riley","partnerRole":"同事",
            "setting":"今天的 LingDaily 播客聊到折叠屏降价。","steps":[$step,$step,$step]}}}
        """.trimIndent()).today!!
        assertEquals("today-2026-10-26", today.practiceScenario?.id)
        assertEquals("phrase", today.vocabulary.first().kind)
        assertEquals("每日播客 10月26日", today.source)
        assertNotNull(today.playableURL)
        assertNull(today.copy(audioURL = "http://cos.example.test/a.mp3").playableURL)
        assertNull(AppJson.decodeFromString<TodayResponse>("""{"today":null}""").today)
        assertNull(AppJson.decodeFromString<TodayResponse>("""{"today":{"date":"2026-10-26","title":"t","summary":"","audioURL":null,"duration":null,"vocabulary":[],"scenario":null}}""").today?.practiceScenario)

        fun catalog(ids: List<String>, steps: Int = 3): List<String> {
            val stepJSON = """{"id":"a","goal":"g","prompt":"p","translation":"t","hint":"h","keywords":"k","expression":"e","meaning":"m"}"""
            val items = ids.joinToString(",") { """{"id":"$it","title":"t","subtitle":"s","category":"日常","symbol":"house","partner":"Avery","partnerRole":"邻居","setting":"情境","steps":[${List(steps) { stepJSON }.joinToString(",")}]}""" }
            return AppJson.decodeFromString<ScenarioCatalogResponse>("""{"version":2,"scenarios":[$items]}""").validScenarios.map { it.id }
        }
        assertEquals(listOf("neighbor"), catalog(listOf("neighbor", "custom-1", "today-2026", "Bad Id", "neighbor")))
        assertEquals(emptyList<String>(), catalog(listOf("neighbor"), steps = 2))
    }

    @Test
    fun updateIsOfferedOnlyForANewerVersionFromOurOwnAddress() {
        fun release(code: Int, url: String) = """{"versionCode":$code,"versionName":"9.9","apkUrl":"$url","sha256":"x","changelog":"改进"}"""
        val base = com.qcy.lingdaily.app.UpdateChecker.BASE_URL
        assertEquals("9.9", com.qcy.lingdaily.app.UpdateChecker.newer(release(3, "$base/LingDaily-v9.9.apk"), current = 2)?.versionName)
        assertNull(com.qcy.lingdaily.app.UpdateChecker.newer(release(2, "$base/LingDaily-v9.9.apk"), current = 2))
        assertNull("A download from anywhere else is never offered", com.qcy.lingdaily.app.UpdateChecker.newer(release(3, "https://evil.test/a.apk"), current = 2))
        assertNull(com.qcy.lingdaily.app.UpdateChecker.newer("not json", current = 2))
    }

    // ---- Sentence review after a conversation ----

    private fun conversation(): PracticeSession {
        var session = PracticeSession.start(scenario, useAI = true).beginLive()
        for (text in listOf("我直行。", "Yeah, you didn't see me. And you almost hit me.", "Yeah, I'm scared very much.", "Okay. Good.")) {
            session = session.liveTranscript(UUID.randomUUID(), Role.PARTNER, "Synthetic partner line").must()
                .liveTranscript(UUID.randomUUID(), Role.USER, text).must()
        }
        return session.liveComplete(2).must()
    }

    private fun natural(request: com.qcy.lingdaily.core.model.SentenceReviewRequest) = SentenceReviewResponse(request.requestId,
        request.messages.map { SentenceReviewResponse.Item(it.messageId, "", "", "") })

    @Test
    fun everyLearnerTurnSurvivesEvenWithinOneTaskAndWithAnExistingCorrection() {
        var session = conversation()
        val messages = session.learnerMessages
        session = session.liveCorrection(messages[2].text, AIFeedback("I was really scared.", "我真的很害怕。", "表达受惊")).must()
        assertEquals(messages.map { it.id }, session.summaryLines.map { it.id })
        assertEquals(messages.map { it.text }, session.summaryLines.map { it.original })
        assertEquals("I was really scared.", session.summaryLines[2].text)
        assertFalse(session.summaryLines[2].isOwnWords)
        assertEquals("Okay. Good.", session.summaryLines.last().text)
        assertTrue(session.summaryLines.last().isOwnWords)
        val long = "Very important. ".repeat(100)
        session = session.copy(phase = PracticeSession.Phase.SPEAKING).liveTranscript(UUID.randomUUID(), Role.USER, long).must()
        assertEquals("No truncation", long, session.summaryLines.last().original)
    }

    @Test
    fun batchesCoverEveryTurnPersistAndAreSkippedOnReopen() {
        var session = conversation()
        repeat(5) { session = session.liveTranscript(UUID.randomUUID(), Role.USER, "Yes.").must() }
        val sizes = mutableListOf<Int>()
        while (true) {
            val request = session.nextSentenceReview ?: break
            sizes += request.messages.size
            assertEquals("Synthetic partner line", request.messages.first().precedingPartner)
            session = session.applySentenceReviews(natural(request).records(request)!!).must()
        }
        assertEquals(listOf(4, 4, 1), sizes)
        assertEquals(9, session.summaryLines.size)
        val restored = AppJson.decodeFromString<PracticeSession>(AppJson.encodeToString(session))
        assertEquals(session.sentenceReviews, restored.sentenceReviews)
        assertNull(restored.nextSentenceReview)
        assertNotNull(restored.copy(sentenceReviews = null).nextSentenceReview)
        assertNull("Only a finished rehearsal is reviewed", restored.copy(sentenceReviews = null, phase = PracticeSession.Phase.SPEAKING).nextSentenceReview)
    }

    @Test
    fun staleForeignAndMalformedResultsCannotAttachToAnotherOrChangedMessage() {
        val old = conversation()
        val message = old.learnerMessages[0]
        val review = SentenceReviewRecord(message.id, message.text, "I was driving straight.", "我在直行。", "保留意思")
        var session = old.applySentenceReviews(listOf(review)).must()
        assertEquals(session.sentenceReviews, old.mergeSentenceReviews(session).sentenceReviews)
        session = session.copy(phase = PracticeSession.Phase.SPEAKING).liveTranscript(message.id, Role.USER, "Different final transcript").must()
        assertNull(session.sentenceReview(session.learnerMessages[0]))
        assertNull(session.applySentenceReviews(listOf(review)))
        assertNull(session.applySentenceReviews(listOf(SentenceReviewRecord(UUID.randomUUID(), "Other account", "", "", ""))))

        val request = conversation().nextSentenceReview!!
        val item = SentenceReviewResponse.Item(request.messages[0].messageId, "", "", "")
        assertNull(SentenceReviewResponse(request.requestId, listOf(item)).records(request))
        assertNull(SentenceReviewResponse(request.requestId, List(4) { item }).records(request))
        assertNull(SentenceReviewResponse(UUID.randomUUID(), emptyList()).records(request))
        // A rewrite needs its meaning and note; "no change" must be entirely empty.
        val half = natural(request).let { it.copy(items = it.items.mapIndexed { index, value -> if (index == 0) value.copy(revised = "Better.") else value }) }
        assertNull(half.records(request))
    }
}
