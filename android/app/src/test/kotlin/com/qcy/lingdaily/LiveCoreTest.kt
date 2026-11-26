package com.qcy.lingdaily

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
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
import com.qcy.lingdaily.core.model.PracticeArchive
import com.qcy.lingdaily.core.model.PracticeMessage.Role
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.PracticeSession.Phase
import com.qcy.lingdaily.core.network.AIProviderKind
import com.qcy.lingdaily.core.realtime.LiveCodec
import com.qcy.lingdaily.core.realtime.LiveConnectionConfig
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
import com.qcy.lingdaily.core.realtime.LiveTokenRequest
import com.qcy.lingdaily.core.realtime.LiveToolCall
import com.qcy.lingdaily.core.realtime.LiveTranscriptReducer
import com.qcy.lingdaily.core.realtime.LiveUploadBatch
import com.qcy.lingdaily.core.realtime.LiveUsage
import com.qcy.lingdaily.core.realtime.OpenAIRealtimeCodec
import com.qcy.lingdaily.core.realtime.Pcm16Resampler16To24

class LiveCoreTest {
    private val scenario = testScenario(steps = 3, id = "live-test")
    private fun parse(json: String) = Json.parseToJsonElement(json).jsonObject
    private fun call(name: String, arguments: JsonObject, id: String = "tool") = LiveToolCall(id, name, arguments)
    private fun completion(id: String, index: Int) = call("mark_task_complete", buildJsonObject { put("taskIndex", index) }, id)
    private fun liveSession() = PracticeSession.start(scenario, useAI = true).beginLive()

    // ---- Gemini Live & OpenAI Realtime wire format ----

    // ---- Wire format ----
    @Test
    fun geminiDirectSetupCarriesFullSystemInstructionVoiceToolsAndVad() {
        val setup = parse(LiveCodec.setup("models/gemini-2.5-flash-native-audio-latest", "Play Alex.", "Puck", 2500))
            .getValue("setup").jsonObject
        assertEquals("models/gemini-2.5-flash-native-audio-latest", setup.getValue("model").jsonPrimitive.content)
        val genConfig = setup.getValue("generationConfig").jsonObject
        assertEquals(listOf("AUDIO"), genConfig.getValue("responseModalities").jsonArray.map { it.jsonPrimitive.content })
        assertEquals("Puck", genConfig.getValue("speechConfig").jsonObject.getValue("voiceConfig").jsonObject
            .getValue("prebuiltVoiceConfig").jsonObject.getValue("voiceName").jsonPrimitive.content)
        assertEquals("Play Alex.", setup.getValue("systemInstruction").jsonObject.getValue("parts").jsonArray[0]
            .jsonObject.getValue("text").jsonPrimitive.content)
        val declarations = setup.getValue("tools").jsonArray[0].jsonObject.getValue("functionDeclarations").jsonArray
        assertEquals(setOf("record_language_correction", "record_unfamiliar_learning_items", "mark_task_complete"),
            declarations.map { it.jsonObject.getValue("name").jsonPrimitive.content }.toSet())
        assertTrue("inputAudioTranscription" in setup && "outputAudioTranscription" in setup)
        val aad = setup.getValue("realtimeInputConfig").jsonObject.getValue("automaticActivityDetection").jsonObject
        assertEquals(2500, aad.getValue("silenceDurationMs").jsonPrimitive.int)

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
    fun openAIRealtimeSessionUpdateAudioKickoffAndEventsFollowProtocol() {
        val update = parse(OpenAIRealtimeCodec.sessionUpdate("Play Sam.", "shimmer", 1500))
        assertEquals("session.update", update.getValue("type").jsonPrimitive.content)
        val sessionObj = update.getValue("session").jsonObject
        // GA Realtime shape; the beta interface (flat audio fields, `modalities`) was shut down on 2026-05-12.
        assertEquals("realtime", sessionObj.getValue("type").jsonPrimitive.content)
        assertEquals(listOf("audio"), sessionObj.getValue("output_modalities").jsonArray.map { it.jsonPrimitive.content })
        for (betaField in listOf("modalities", "voice", "input_audio_format", "output_audio_format", "input_audio_transcription", "turn_detection")) {
            assertFalse("Beta field $betaField must not be sent", betaField in sessionObj)
        }
        assertEquals("Play Sam.", sessionObj.getValue("instructions").jsonPrimitive.content)
        val audio = sessionObj.getValue("audio").jsonObject
        val input = audio.getValue("input").jsonObject
        val output = audio.getValue("output").jsonObject
        assertEquals("shimmer", output.getValue("voice").jsonPrimitive.content)
        for (format in listOf(input.getValue("format").jsonObject, output.getValue("format").jsonObject)) {
            assertEquals("audio/pcm", format.getValue("type").jsonPrimitive.content)
            assertEquals(24000, format.getValue("rate").jsonPrimitive.int)
        }
        assertEquals(OpenAIRealtimeCodec.TRANSCRIPTION_MODEL, input.getValue("transcription").jsonObject.getValue("model").jsonPrimitive.content)
        val vad = input.getValue("turn_detection").jsonObject
        assertEquals("server_vad", vad.getValue("type").jsonPrimitive.content)
        assertEquals(1500, vad.getValue("silence_duration_ms").jsonPrimitive.int)
        assertEquals(3, sessionObj.getValue("tools").jsonArray.size)
        assertEquals("auto", sessionObj.getValue("tool_choice").jsonPrimitive.content)

        val kickoff = OpenAIRealtimeCodec.textMessages("Hello!")
        assertEquals(2, kickoff.size)
        assertEquals("conversation.item.create", parse(kickoff[0]).getValue("type").jsonPrimitive.content)
        assertEquals("response.create", parse(kickoff[1]).getValue("type").jsonPrimitive.content)

        assertEquals(listOf(LiveEvent.SetupComplete), OpenAIRealtimeCodec.parse("""{"type":"session.updated"}"""))
        assertEquals(listOf(LiveEvent.Interrupted), OpenAIRealtimeCodec.parse("""{"type":"input_audio_buffer.speech_started"}"""))

        val audioEvents = OpenAIRealtimeCodec.parse("""{"type":"response.audio.delta","delta":"AQA="}""")
        assertArrayEquals(byteArrayOf(1, 0), (audioEvents.single() as LiveEvent.Audio).pcm)
        val outputAudioEvents = OpenAIRealtimeCodec.parse("""{"type":"response.output_audio.delta","delta":"AgA="}""")
        assertArrayEquals(byteArrayOf(2, 0), (outputAudioEvents.single() as LiveEvent.Audio).pcm)

        // Streaming delta + completed snapshot must replace cleanly without duplicating text.
        val reducer = LiveTranscriptReducer()
        val uDelta = OpenAIRealtimeCodec.parse("""{"type":"conversation.item.input_audio_transcription.delta","delta":"i need "}""").single() as LiveEvent.Transcription
        val uDone = OpenAIRealtimeCodec.parse("""{"type":"conversation.item.input_audio_transcription.completed","transcript":"I need two days.\n"}""").single() as LiveEvent.Transcription
        val s1 = reducer.update(uDelta.role, uDelta.text, uDelta.finished, uDelta.replace)
        val s2 = reducer.update(uDone.role, uDone.text, uDone.finished, uDone.replace)
        assertEquals(s1.id, s2.id)
        assertEquals("I need two days.", s2.text)
        assertTrue(s2.finalized)

        // Function call + response.done continuation vs message TurnComplete.
        val callNames = mutableMapOf<String, String>()
        OpenAIRealtimeCodec.parse("""{"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_1","name":"mark_task_complete"}}""", callNames)
        val toolEvent = OpenAIRealtimeCodec.parse("""{"type":"response.function_call_arguments.done","call_id":"call_1","arguments":"{\"taskIndex\":0}"}""", callNames).single() as LiveEvent.Tool
        assertNotNull(toolEvent.call.validated())
        val ack = parse(OpenAIRealtimeCodec.toolResponse(toolEvent.call, accepted = true))
        assertEquals("conversation.item.create", ack.getValue("type").jsonPrimitive.content)
        assertEquals("function_call_output", ack.getValue("item").jsonObject.getValue("type").jsonPrimitive.content)
        assertEquals("""{"status":"accepted"}""", ack.getValue("item").jsonObject.getValue("output").jsonPrimitive.content)

        assertEquals(listOf(LiveEvent.RequestContinuation),
            OpenAIRealtimeCodec.parse("""{"type":"response.done","response":{"output":[{"type":"function_call","call_id":"call_1"}]}}"""))
        assertEquals(listOf(LiveEvent.TurnComplete),
            OpenAIRealtimeCodec.parse("""{"type":"response.done","response":{"output":[{"type":"function_call","call_id":"call_1"},{"type":"message"}]}}"""))
        assertEquals(listOf(LiveEvent.TurnComplete),
            OpenAIRealtimeCodec.parse("""{"type":"response.done","response":{"output":[{"type":"message"}]}}"""))

        // Benign VAD/cancel errors are ignored; real errors fail cleanly.
        assertTrue(OpenAIRealtimeCodec.parse("""{"type":"error","error":{"code":"input_audio_buffer_commit_empty"}}""").isEmpty())
        assertTrue(OpenAIRealtimeCodec.parse("""{"type":"error","error":{"code":"response_cancel_not_active"}}""").isEmpty())
        assertThrows(LiveProtocolException::class.java) {
            OpenAIRealtimeCodec.parse("""{"type":"error","error":{"code":"invalid_api_key"}}""")
        }
    }

    @Test
    fun resampler16To24Converts320To480SamplesSeamlesslyAcrossFrameBoundaries() {
        val resampler = Pcm16Resampler16To24()
        // Single 20 ms 16 kHz frame (320 samples = 640 bytes) -> 480 samples = 960 bytes at 24 kHz.
        val oneFrame = ByteArray(640)
        val resampled = resampler.resample(oneFrame)
        assertEquals(960, resampled.size)
        OpenAIRealtimeCodec.audioAppend(resampled)

        // Batched 5 frames (3200 bytes) -> 4800 bytes.
        assertEquals(4800, resampler.resample(ByteArray(3200)).size)

        // Exact linear ramp `s[n] = 3 * n` across two frames: output must have constant step `2` after sample 0.
        resampler.reset()
        fun shortsToBytes(samples: IntArray): ByteArray {
            val buf = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
            for (s in samples) buf.putShort(s.toShort())
            return buf.array()
        }
        fun bytesToShorts(bytes: ByteArray): IntArray {
            val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            return IntArray(bytes.size / 2) { buf.short.toInt() }
        }
        val frameA = shortsToBytes(IntArray(320) { it * 3 })
        val frameB = shortsToBytes(IntArray(320) { (320 + it) * 3 })
        val outA = bytesToShorts(resampler.resample(frameA))
        val outB = bytesToShorts(resampler.resample(frameB))
        assertEquals(480, outA.size)
        assertEquals(480, outB.size)
        val combined = outA + outB
        for (i in 2 until combined.size) {
            assertEquals("Continuous linear slope across frame boundary at index $i", 2, combined[i] - combined[i - 1])
        }
    }

    @Test
    fun connectionConfigBuildsDirectProviderWebSocketURLs() {
        val gemini = LiveConnectionConfig(
            provider = AIProviderKind.GEMINI,
            apiKey = "key+1/2",
            baseURL = "",
            model = "gemini-2.5-flash-native-audio-latest",
            systemInstruction = "inst",
            geminiVoice = "Aoede",
            openAIVoice = "coral",
            pauseMs = 1500,
        )
        assertEquals(
            "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=key%2B1%2F2",
            gemini.webSocketURL(),
        )

        val openai = gemini.copy(
            provider = AIProviderKind.OPENAI,
            apiKey = "sk-test",
            baseURL = "https://my-proxy.example.com",
            model = "gpt-4o-realtime-preview",
        )
        assertEquals(
            "wss://my-proxy.example.com/v1/realtime?model=gpt-4o-realtime-preview",
            openai.webSocketURL(),
        )

        assertThrows(LiveProtocolException::class.java) {
            gemini.copy(baseURL = "http://public.example.com").webSocketURL()
        }
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
    fun usageIsParsedPerTurnAndSummedForAConnection() {
        // Captured shape from a real two-turn Gemini Live session.
        val first = """{"usageMetadata":{"promptTokenCount":162,"responseTokenCount":42,"totalTokenCount":204,"promptTokensDetails":[{"modality":"TEXT","tokenCount":139}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":42}]}}"""
        val second = """{"usageMetadata":{"promptTokenCount":235,"responseTokenCount":71,"totalTokenCount":306,"promptTokensDetails":[{"modality":"TEXT","tokenCount":154},{"modality":"AUDIO","tokenCount":42}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":71}]}}"""
        var total = LiveUsage()
        for (raw in listOf(first, second)) for (event in LiveCodec.parse(raw)) total += (event as LiveEvent.Usage).usage
        assertEquals(LiveUsage(input = 397, output = 113, inputAudio = 42, outputAudio = 113, total = 510), total)
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
        for ((pcm, _) in messages) LiveCodec.audio(pcm)
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
        reducer.finishTurn()
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
        val scripted = PracticeSession.start(scenario)
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
