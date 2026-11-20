package com.qcy.lingdaily

import java.util.Base64
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import com.qcy.lingdaily.core.model.AIFeedback
import com.qcy.lingdaily.core.model.AIPracticeAction
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.IsoMillisSerializer
import com.qcy.lingdaily.core.model.PracticeArchive
import com.qcy.lingdaily.core.model.PracticeMessage.Role
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.PracticeSession.Phase
import com.qcy.lingdaily.core.realtime.LiveCodec
import com.qcy.lingdaily.core.realtime.LiveEchoGate
import com.qcy.lingdaily.core.realtime.LiveEvent
import com.qcy.lingdaily.core.realtime.LiveInputBuffer
import com.qcy.lingdaily.core.realtime.LiveInputGate
import com.qcy.lingdaily.core.realtime.LiveKickoff
import com.qcy.lingdaily.core.realtime.LivePCMFramer
import com.qcy.lingdaily.core.realtime.LivePendingTools
import com.qcy.lingdaily.core.realtime.LivePlaybackBuffer
import com.qcy.lingdaily.core.realtime.LiveProtocolException
import com.qcy.lingdaily.core.realtime.LiveStuckPolicy
import com.qcy.lingdaily.core.realtime.LiveSuggestionRequest
import com.qcy.lingdaily.core.realtime.LiveToken
import com.qcy.lingdaily.core.realtime.LiveTokenRequest
import com.qcy.lingdaily.core.realtime.LiveToolCall
import com.qcy.lingdaily.core.realtime.LiveTranscriptReducer
import com.qcy.lingdaily.core.realtime.LiveUploadBatch
import com.qcy.lingdaily.core.realtime.LiveUsage
import com.qcy.lingdaily.core.realtime.LiveUsageReport

class LiveCoreTest {
    private val scenario = testScenario(steps = 3, id = "live-test")
    private fun parse(json: String) = Json.parseToJsonElement(json).jsonObject
    private fun call(name: String, arguments: JsonObject, id: String = "tool") = LiveToolCall(id, name, arguments)
    private fun completion(id: String, index: Int) = call("mark_task_complete", buildJsonObject { put("taskIndex", index) }, id)
    private fun liveSession() = PracticeSession.start(scenario, useAI = true).beginLive()

    // ---- Wire format ----

    @Test
    fun setupDoesNotSendClientSystemInstruction() {
        val setup = parse(LiveCodec.setup("test-model")).getValue("setup").jsonObject
        assertEquals(mapOf("model" to JsonPrimitive("models/test-model")), setup)
        val payload = parse(LiveCodec.audio(byteArrayOf(0, 1))).getValue("realtimeInput").jsonObject.getValue("audio").jsonObject
        assertEquals("audio/pcm;rate=16000", payload.getValue("mimeType").jsonPrimitive.content)
        assertArrayEquals(byteArrayOf(0, 1), Base64.getDecoder().decode(payload.getValue("data").jsonPrimitive.content))
        assertThrows(LiveProtocolException::class.java) { LiveCodec.audio(byteArrayOf(1)) }
        assertThrows(LiveProtocolException::class.java) { LiveCodec.audio(ByteArray(3202)) }
        assertEquals("""{"realtimeInput":{"audioStreamEnd":true}}""", LiveCodec.audioEnd())
        assertEquals("""{"clientContent":{"turns":[{"role":"user","parts":[{"text":"Hi \"there\""}]}],"turnComplete":true}}""",
            LiveCodec.text("Hi \"there\""))
    }

    @Test
    fun allEventsAndAudioPartsAreParsedInOrder() {
        val events = LiveCodec.parse("""
            {"setupComplete":{},"serverContent":{"inputTranscription":{"text":"Hello","finished":true},
            "outputTranscription":{"text":"Hi"},"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AAA="}},
            {"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQA="}}]},"turnComplete":true},
            "toolCall":{"functionCalls":[{"id":"t1","name":"mark_task_complete","args":{"taskIndex":0}}]}}
        """.trimIndent())
        assertEquals(7, events.size)
        assertEquals(LiveEvent.SetupComplete, events[0])
        assertEquals(LiveEvent.Transcription(Role.USER, "Hello", true), events[1])
        assertEquals(LiveEvent.Transcription(Role.PARTNER, "Hi", false), events[2])
        assertArrayEquals(byteArrayOf(0, 0), (events[3] as LiveEvent.Audio).pcm)
        assertArrayEquals(byteArrayOf(1, 0), (events[4] as LiveEvent.Audio).pcm)
        assertEquals(LiveEvent.TurnComplete, events[5])
        assertNotNull((events[6] as LiveEvent.Tool).call.validated())
    }

    @Test
    fun interruptedEnvelopeNeverQueuesItsOldAudio() {
        val events = LiveCodec.parse("""{"serverContent":{"interrupted":true,"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm","data":"AAA="}}]},"turnComplete":true}}""")
        assertEquals(listOf(LiveEvent.Interrupted, LiveEvent.TurnComplete), events)
        assertThrows(LiveProtocolException::class.java) { LiveCodec.parse("""{"error":{"message":"synthetic upstream failure"}}""") }
        assertThrows(LiveProtocolException::class.java) { LiveCodec.parse("not json") }
        assertThrows(LiveProtocolException::class.java) { LiveCodec.parse("[1]") }
        assertEquals(listOf(LiveEvent.CancelledTools(listOf("t1")), LiveEvent.GoAway),
            LiveCodec.parse("""{"toolCallCancellation":{"ids":["t1"]},"goAway":{}}"""))
        // Odd-length audio would shift every following sample by one byte.
        assertThrows(LiveProtocolException::class.java) {
            LiveCodec.parse("""{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm","data":"AA=="}}]}}}""")
        }
    }

    @Test
    fun toolWhitelistLengthTypesAndAcknowledgement() {
        fun args(vararg pairs: Pair<String, Any>) = buildJsonObject {
            for ((key, value) in pairs) when (value) {
                is Boolean -> put(key, value)
                is Number -> put(key, value)
                else -> put(key, value.toString())
            }
        }
        assertNull(call("execute_code", args()).validated())
        assertNull(call("mark_task_complete", args("taskIndex" to true)).validated())
        assertNull(call("mark_task_complete", args("taskIndex" to 0.5)).validated())
        assertNull(call("mark_task_complete", args("taskIndex" to 3)).validated())
        assertNull(call("mark_task_complete", args("taskIndex" to "1")).validated())
        assertNull(call("mark_task_complete", args("taskIndex" to 0, "extra" to "no")).validated())
        assertNotNull(call("mark_task_complete", args("taskIndex" to 0)).validated())
        assertNotNull(call("record_language_correction", args("original" to "I go yesterday", "corrected" to "I went yesterday.",
            "explanation" to "昨天用过去时。", "category" to "grammar")).validated())
        assertNull(call("record_language_correction", args("original" to "x".repeat(2001))).validated())
        assertNull(call("record_language_correction", args("original" to "a b", "corrected" to "a c",
            "explanation" to "x", "category" to "insult")).validated())
        val item = buildJsonObject { put("text", "went"); put("type", "word"); put("meaning", "去的过去式") }
        fun items(vararg values: JsonObject) = JsonObject(mapOf("items" to buildJsonArray { values.forEach(::add) }))
        val collected = call("record_unfamiliar_learning_items", items(item, item)).validated()
        assertEquals(1, (collected as com.qcy.lingdaily.core.realtime.LiveToolAction.Items).items.size)
        assertNull(call("record_unfamiliar_learning_items", items(*Array(21) { item })).validated())
        assertNull(call("record_unfamiliar_learning_items",
            items(buildJsonObject { put("text", "x"); put("type", "code"); put("meaning", "x") })).validated())
        assertTrue(LiveCodec.toolResponse(completion("t", 0), accepted = true).contains("\"status\":\"accepted\""))
        assertTrue(LiveCodec.toolResponse(call("unknown", args()), accepted = false).contains("rejected"))
    }

    @Test
    fun clientAllowsOnlyExactEndpointsAndEncodesCredentialSeparately() {
        val expiry = IsoMillisSerializer.format(System.currentTimeMillis() + 60_000)
        assertThrows(LiveProtocolException::class.java) { LiveToken("synthetic", "test", "wss://evil.test", expiry).connectionURL() }
        assertThrows(LiveProtocolException::class.java) {
            LiveToken("synthetic", "test", LiveToken.ENDPOINT, "2000-01-01T00:00:00Z").connectionURL()
        }
        for (endpoint in listOf(LiveToken.ENDPOINT, LiveToken.RELAY_ENDPOINT, LiveToken.LEGACY_RELAY_ENDPOINT)) {
            val url = LiveToken("synthetic/value+&", "test", endpoint, expiry).connectionURL()
            assertEquals("$endpoint?access_token=synthetic%2Fvalue%2B%26", url)
        }
        for (endpoint in listOf(LiveToken.RELAY_ENDPOINT + "?extra=1", LiveToken.RELAY_ENDPOINT + "#fragment",
            LiveToken.RELAY_ENDPOINT.replace("wss:", "ws:"), LiveToken.RELAY_ENDPOINT.replace("yasobi.xyz", "yasobi.xyz.evil.test"),
            LiveToken.RELAY_ENDPOINT.replace("wss://", "wss://user@"), LiveToken.RELAY_ENDPOINT.replace("/ws/", ":8443/ws/"))) {
            assertThrows(LiveProtocolException::class.java) { LiveToken("synthetic", "test", endpoint, expiry).connectionURL() }
        }
        // The same endpoints the server may hand out (app/lib/ios/liveEndpoint.mjs).
        assertEquals("wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained",
            LiveToken.ENDPOINT)
    }

    @Test
    fun usageIsParsedPerTurnAndSummedForAConnection() {
        // Captured shape from a real two-turn Gemini Live session.
        val first = """{"usageMetadata":{"promptTokenCount":162,"responseTokenCount":42,"totalTokenCount":204,"promptTokensDetails":[{"modality":"TEXT","tokenCount":139}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":42}]}}"""
        val second = """{"usageMetadata":{"promptTokenCount":235,"responseTokenCount":71,"totalTokenCount":306,"promptTokensDetails":[{"modality":"TEXT","tokenCount":154},{"modality":"AUDIO","tokenCount":42}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":71}]}}"""
        var total = LiveUsage()
        for (raw in listOf(first, second)) for (event in LiveCodec.parse(raw)) total += (event as LiveEvent.Usage).usage
        assertEquals(LiveUsage(input = 397, output = 113, inputAudio = 42, outputAudio = 113, total = 510), total)
        val report = LiveUsageReport.create(UUID.randomUUID(), "gemini-3.1-flash-live-preview", total)!!
        assertEquals("Matches the server's strict schema",
            setOf("reportId", "model", "inputTokens", "outputTokens", "inputAudioTokens", "outputAudioTokens", "totalTokens"),
            AppJson.encodeToJsonElement(LiveUsageReport.serializer(), report).jsonObject.keys)
        assertNull(LiveUsageReport.create(UUID.randomUUID(), "m", LiveUsage()))
        assertNull(LiveUsage.from(JsonObject(emptyMap())))
    }

    // ---- Audio bookkeeping ----

    @Test
    fun framerKeepsLeftoverBytesAndBatchesShareMessages() {
        val framer = LivePCMFramer()
        assertEquals(listOf(640), framer.append(ByteArray(1000) { 1 }).map { it.size })
        assertEquals(listOf(640, 640), framer.append(ByteArray(920) { 2 }).map { it.size })
        assertTrue(framer.append(ByteArray(0)).isEmpty())
        assertThrows(LiveProtocolException::class.java) { framer.append(ByteArray(3)) }

        val frames = (0 until 12).map { ByteArray(640) { _ -> it.toByte() } }
        val messages = LiveUploadBatch.messages(frames)
        assertEquals(listOf(5, 5, 2), messages.map { it.second })
        assertArrayEquals(frames.fold(ByteArray(0)) { all, frame -> all + frame }, messages.fold(ByteArray(0)) { all, part -> all + part.first })
        for ((pcm, _) in messages) LiveCodec.audio(pcm) // every message fits the codec's 100 ms limit
        assertEquals(listOf(1), LiveUploadBatch.messages(listOf(frames[0])).map { it.second })
    }

    @Test
    fun batchDrainsBacklogEvenWhenWakeupsOnlyRun36TimesPerSecond() {
        val buffer = LiveInputBuffer()
        var produced = 0
        var sent = 0
        // Three minutes at 50 frames/s with 36 wakeups/s.
        for (tick in 1..180 * 36) {
            val due = tick * 50 / 36
            while (produced < due) {
                buffer.append(listOf(ByteArray(640)))
                produced++
            }
            sent += LiveUploadBatch.take { buffer.take() }.size
            assertEquals(0, buffer.count)
        }
        assertEquals(9000, produced)
        assertEquals(9000, sent)
        assertEquals(0, buffer.droppedFrames)

        val small = LiveInputBuffer(capacity = 3)
        small.append((0 until 6).map { byteArrayOf(it.toByte(), 0) })
        assertEquals(3, small.droppedFrames)
        assertArrayEquals(byteArrayOf(3, 0), small.take())
    }

    @Test
    fun muteInvalidatesBatchAlreadyDrainedFromCaptureEvenAfterUnmute() {
        val gate = LiveInputGate()
        assertFalse(gate.accepts(gate.generation))
        gate.open()
        val oldBatch = gate.generation
        assertTrue(gate.accepts(oldBatch))
        gate.close()
        assertFalse(gate.accepts(oldBatch))
        gate.open()
        assertFalse(gate.accepts(oldBatch))
        assertTrue(gate.accepts(gate.generation))
    }

    @Test
    fun interruptionInvalidatesEveryQueuedReservationAndOverflowDoesNotPoisonPlayback() {
        val buffer = LivePlaybackBuffer(maxBytes = 8, maxChunks = 2)
        val first = buffer.reserve(4)!!
        assertTrue(buffer.enqueue(byteArrayOf(1, 0, 2, 0), first))
        assertArrayEquals(byteArrayOf(1, 0, 2, 0), buffer.next()?.data)
        val second = buffer.reserve(4)!!
        assertNull(buffer.reserve(2))
        buffer.invalidate()
        assertFalse(buffer.enqueue(byteArrayOf(3, 0, 4, 0), second))
        assertNull(buffer.next())
        val fresh = buffer.reserve(2)!!
        assertFalse("An old completion cannot alter new audio accounting", buffer.complete(4, first))
        assertEquals(2, buffer.reservedBytes)
        assertTrue(buffer.enqueue(byteArrayOf(5, 0), fresh))
        assertArrayEquals(byteArrayOf(5, 0), buffer.next()?.data)
        assertTrue(buffer.complete(2, fresh))
        assertEquals(0, buffer.reservedBytes)

        val large = LivePlaybackBuffer(maxBytes = 480_000)
        assertNull(large.reserve(0))
        assertNull(large.reserve(3))
        val epoch = large.reserve(480_000)!!
        large.enqueue(ByteArray(480_000), epoch)
        assertNull("The caller drops this chunk and keeps the call alive", large.reserve(24_000))
        assertEquals(480_000, large.next()?.data?.size)
        large.complete(480_000, epoch)
        assertNotNull(large.reserve(24_000))
    }

    @Test
    fun speakerSilencesMicrophoneWhilePartnerPlaysAndInterruptOpensIt() {
        val gate = LiveEchoGate()
        assertFalse(gate.suppressesMicrophone(partnerAudible = false, speakerOutput = true, now = 10_000))
        assertTrue(gate.suppressesMicrophone(partnerAudible = true, speakerOutput = true, now = 11_000))
        assertTrue(gate.suppressesMicrophone(partnerAudible = false, speakerOutput = true, now = 11_000 + LiveEchoGate.TAIL_MS - 10))
        assertFalse(gate.suppressesMicrophone(partnerAudible = false, speakerOutput = true, now = 11_000 + LiveEchoGate.TAIL_MS + 10))

        assertTrue(gate.suppressesMicrophone(partnerAudible = true, speakerOutput = true, now = 20_000))
        gate.learnerTookFloor()
        assertFalse("After 打断 the learner is heard immediately, even before queued audio drains",
            gate.suppressesMicrophone(partnerAudible = true, speakerOutput = true, now = 20_010))
        assertFalse(gate.suppressesMicrophone(partnerAudible = false, speakerOutput = true, now = 20_200))
        gate.partnerStartedReply()
        assertTrue(gate.suppressesMicrophone(partnerAudible = true, speakerOutput = true, now = 23_000))

        // Headphones keep voice barge-in, and leave no stale tail after unplugging.
        val headphones = LiveEchoGate()
        assertFalse(headphones.suppressesMicrophone(partnerAudible = true, speakerOutput = false, now = 1_000))
        assertTrue(headphones.suppressesMicrophone(partnerAudible = true, speakerOutput = true, now = 2_000))
        assertFalse(headphones.suppressesMicrophone(partnerAudible = false, speakerOutput = false, now = 2_100))
    }

    // ---- Transcript ----

    @Test
    fun emptyFinalMarkerSealsExistingInputAndNextUtteranceCanPrecedeInterruption() {
        val marker = LiveCodec.parse("""{"serverContent":{"inputTranscription":{"finished":true}}}""").single() as LiveEvent.Transcription
        val reducer = LiveTranscriptReducer()
        val first = reducer.update(Role.USER, "Thursday, please.", false)
        val final = reducer.update(Role.USER, marker.text, marker.finished)
        assertEquals(first.id, final.id)
        assertEquals(first.text, final.text)
        assertTrue(final.finalized)
        val next = reducer.update(Role.USER, "Actually", false)
        assertNotEquals(first.id, next.id)
        reducer.finishPartner()
        reducer.finishTurn()
        val rest = reducer.update(Role.USER, " Friday.", true)
        assertEquals(next.id, rest.id)
        assertEquals("Actually Friday.", rest.text)
    }

    @Test
    fun inputFinalAfterNormalModelTurnCompleteStaysInTheSameBubble() {
        val reducer = LiveTranscriptReducer()
        val first = reducer.update(Role.USER, "I need", false)
        reducer.update(Role.PARTNER, "Okay.", true)
        reducer.finishTurn()
        val final = reducer.update(Role.USER, " more time.", true)
        assertEquals(first.id, final.id)
        assertEquals("I need more time.", final.text)
    }

    @Test
    fun missingFinalFlagsDoNotMergeTwoDifferentLearnerTurns() {
        val reducer = LiveTranscriptReducer()
        val first = reducer.update(Role.USER, "Thursday, please.", false)
        reducer.finishTurn()
        val second = reducer.update(Role.USER, "Thanks.", false)
        assertNotEquals(first.id, second.id)
        assertEquals("Thanks.", second.text)
        assertEquals(second.id, reducer.update(Role.USER, "", true).id)
        val next = reducer.update(Role.USER, "Actually Friday.", true)
        assertNotEquals(second.id, next.id)
        assertEquals("Actually Friday.", next.text)
    }

    @Test
    fun repeatedWordsAndBargeInSurviveInterruptedTurnComplete() {
        val reducer = LiveTranscriptReducer()
        reducer.update(Role.PARTNER, "Let me explain", false)
        val user = reducer.update(Role.USER, " very", false)
        reducer.finishPartner()
        reducer.finishTurn() // End of the cancelled partner response, not of this user sentence.
        val next = reducer.update(Role.USER, " very important", false)
        assertEquals(user.id, next.id)
        assertEquals(" very very important", next.text)
        val final = reducer.update(Role.USER, ".", true)
        assertEquals(" very very important.", final.text)
        reducer.finishTurn()
        assertNotEquals(user.id, reducer.update(Role.USER, "Thanks", false).id)
        assertThrows(LiveProtocolException::class.java) { reducer.update(Role.PARTNER, "x".repeat(8001), false) }
    }

    // ---- Session effects ----

    @Test
    fun livePersistsFeedbackByUserIDProgressAndOldArchiveCompatibility() {
        var session = PracticeSession.start(scenario, useAI = true).beginLive(model = "synthetic-model")
        assertNull(session.pendingAIRequest)
        assertNull(session.liveComplete(0))
        val id = UUID.randomUUID()
        session = session.liveTranscript(id, Role.USER, "I go yesterday").must().liveTranscript(id, Role.USER, "I go yesterday.").must()
        assertEquals(1, session.userTurns)
        val feedback = AIFeedback("I went yesterday.", "", "用过去时。")
        assertNull(session.liveCorrection("A different sentence", feedback))
        session = session.liveCorrection("I go yesterday.", feedback).must()
        assertEquals(feedback, session.feedback(id))
        session = session.applyFeedbackMeaning(" 我昨天去了。 ", id).must()
        assertEquals("我昨天去了。", session.feedback(id)?.meaning)
        assertNull("A meaning is filled in once", session.applyFeedbackMeaning("别的", id))
        session = session.liveComplete(0).must()
        assertNull(session.liveComplete(0))
        assertEquals(1, session.stepIndex)
        session = session.endLive()
        val archive = PracticeArchive().upsert(session)
        val json = AppJson.encodeToJsonElement(PracticeArchive.serializer(), archive)
        assertEquals(archive, AppJson.decodeFromJsonElement(PracticeArchive.serializer(), json))
    }

    @Test
    fun correctionMatchesPunctuationQuoteInsideSentenceAndMinorSTTChanges() {
        val id = UUID.randomUUID()
        var session = liveSession().liveTranscript(id, Role.USER, "Well, I go yesterday. Could we move the deadline to Thursday?").must()
        val feedback = AIFeedback("I went yesterday.", "", "用过去时。")
        session = session.liveCorrection("I go yesterday", feedback).must()
        assertEquals(feedback, session.feedback(id))
        assertNotNull(session.liveCorrection("Could we move deadline to Thursday", feedback))
        assertNull(session.liveCorrection("Completely unrelated content", feedback))
    }

    @Test
    fun whitespaceNeverBecomesARequestAndTextAfterLiveAdvancesInsteadOfAnsweringOldTask() {
        var session = liveSession()
        assertNull(session.liveTranscript(UUID.randomUUID(), Role.USER, " \n "))
        assertTrue(LiveTokenRequest.from(session).messages.isEmpty())
        assertNull(LiveSuggestionRequest.from(session))
        assertEquals(AIPracticeAction.START, session.prepareText().pendingAIRequest?.action)

        session = session.liveTranscript(UUID.randomUUID(), Role.USER, "We need Thursday.").must().liveComplete(0).must().prepareText()
        val request = session.pendingAIRequest!!
        assertEquals(AIPracticeAction.ADVANCE, request.action)
        assertEquals(1, request.stepIndex)
        assertEquals(0, request.messages.last().stepIndex)
        assertEquals(Phase.SPEAKING, session.phase)
    }

    @Test
    fun taskToolBeforeTranscriptionWaitsAndCannotQueueFutureTasks() {
        var session = liveSession()
        val tools = LivePendingTools()
        session = tools.apply(completion("future", 1), session).first
        assertEquals(0, tools.count)
        session = tools.apply(completion("current", 0), session).first
        assertEquals(1, tools.count)
        assertEquals(0, session.stepIndex)
        session = tools.flush(session.liveTranscript(UUID.randomUUID(), Role.USER, "Could we move it to Thursday?").must())
        assertEquals(0, tools.count)
        assertEquals(1, session.stepIndex)
        assertEquals(listOf(0), tools.flush(session).live?.completedTasks)
    }

    @Test
    fun laterTaskIndexCompletesTasksInBetweenOnlyAfterTheLearnerSpoke() {
        val tools = LivePendingTools()
        var session = liveSession().liveTranscript(UUID.randomUUID(), Role.USER, "Explain the delay.").must()
        session = tools.apply(completion("first", 0), session).first
        assertEquals(1, session.stepIndex)
        // The partner wraps up early: one call with the final index closes the rest.
        session = tools.apply(completion("early", 2), session).first
        assertEquals(0, tools.count)
        assertEquals(1, session.stepIndex)
        session = session.liveTranscript(UUID.randomUUID(), Role.USER, "Do you have any other questions?").must()
        session = tools.apply(completion("wrap", 2), session).first
        assertEquals(Phase.COMPLETED, session.phase)
        assertEquals(listOf(0, 1, 2), session.live?.completedTasks)
    }

    @Test
    fun cancellationRemovesQueuedEffectsAndTheQueueStaysBounded() {
        var session = liveSession()
        val tools = LivePendingTools()
        session = tools.apply(completion("complete", 0), session).first
        session = tools.apply(call("record_language_correction", buildJsonObject {
            put("original", "I go yesterday"); put("corrected", "I went yesterday")
            put("explanation", "用过去时"); put("category", "grammar")
        }, id = "correction"), session).first
        tools.cancel(listOf("complete", "correction"))
        val id = UUID.randomUUID()
        session = tools.flush(session.liveTranscript(id, Role.USER, "I go yesterday").must())
        assertEquals(0, session.stepIndex)
        assertNull(session.feedback(id))

        for (i in 0 until 100) session = tools.apply(completion("call-$i", 0), session.copy(messages = emptyList())).first
        assertEquals(20, tools.count)
    }

    @Test
    fun kickoffDependsOnWhoSpokeLastAndStuckHelpWaitsForAnUnansweredLine() {
        val fresh = PracticeSession.start(scenario, useAI = true)
        assertEquals(LiveKickoff.fresh(scenario), LiveKickoff.text(fresh))
        assertTrue(LiveKickoff.text(fresh)!!.contains("You are Alex (Colleague); I am the learner"))
        assertNull(LiveStuckPolicy.awaitedLine(fresh))
        val scripted = PracticeSession.start(scenario) // opens with the partner's prompt
        assertNull("An unanswered partner line is not asked again", LiveKickoff.text(scripted))
        assertEquals(scripted.messages[0].id, LiveStuckPolicy.awaitedLine(scripted))
        val answered = scripted.submit("I need two more days.").must()
        assertEquals(LiveKickoff.replyToLearner(scenario), LiveKickoff.text(answered))
        assertNull(LiveStuckPolicy.awaitedLine(answered))
        val request = LiveSuggestionRequest.from(answered)!!
        assertEquals(listOf(Role.PARTNER, Role.USER), request.messages.map { it.role })
        assertEquals(setOf("requestId", "scenario", "goal", "context", "stepIndex", "messages"),
            AppJson.encodeToJsonElement(LiveSuggestionRequest.serializer(), request).jsonObject.keys)
    }

    @Test
    fun translationIsStoredOnlyOnPartnerLines() {
        var session = PracticeSession.start(scenario).submit("I need two more days.").must()
        val (partner, learner) = session.messages
        val later = System.currentTimeMillis() + 60_000
        session = session.applyTranslation(" 周五还能按时完成吗？ ", partner.id, now = later).must()
        assertEquals("周五还能按时完成吗？", session.messages[0].translation)
        assertEquals("A new translation must be synced", later, session.updatedAt)
        assertNull(session.applyTranslation("我还需要两天。", learner.id))
        assertNull(session.applyTranslation("  ", partner.id))
    }
}
