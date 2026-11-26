package com.qcy.lingdaily.core.realtime

import java.util.Base64
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import com.qcy.lingdaily.core.model.AIFeedback
import com.qcy.lingdaily.core.model.AILearningItem
import com.qcy.lingdaily.core.model.AIPracticeRequest
import com.qcy.lingdaily.core.model.PartnerTemperament
import com.qcy.lingdaily.core.model.PracticeMessage
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.ReviewTarget
import com.qcy.lingdaily.core.model.SavedExpression
import com.qcy.lingdaily.core.model.prefix
import com.qcy.lingdaily.core.network.AIProviderKind
import com.qcy.lingdaily.core.network.DirectAI

@Serializable
data class LiveTokenRequest(
    val scenario: AIPracticeRequest.Scenario,
    val goal: String,
    val context: String,
    val stepIndex: Int,
    val messages: List<Message>,
    val model: String? = null,
    val pauseMs: Int? = null,
    val level: String? = null,
    val attitude: String? = null,
    val temperament: PartnerTemperament? = null,
    val reviewItems: List<ReviewTarget>? = null,
) {
    @Serializable
    data class Message(val role: PracticeMessage.Role, val text: String)

    companion object {
        fun from(session: PracticeSession): LiveTokenRequest = LiveTokenRequest(
            scenario = AIPracticeRequest.Scenario(session.scenario),
            goal = session.personalGoal, context = session.context, stepIndex = session.stepIndex,
            messages = session.messages.filter { it.text.isNotBlank() }.takeLast(12)
                .map { Message(it.role, it.text.trim().prefix(2000)) },
            level = session.level, attitude = session.requestAttitude,
            temperament = session.requestTemperament, reviewItems = session.reviewItems,
        )
    }
}

data class LiveConnectionConfig(
    val provider: AIProviderKind,
    val apiKey: String,
    val baseURL: String,
    val model: String,
    val systemInstruction: String,
    val geminiVoice: String,
    val openAIVoice: String,
    val pauseMs: Int,
) {
    fun webSocketURL(): String = try {
        when (provider) {
            AIProviderKind.GEMINI -> DirectAI.geminiLiveWebSocketURL(baseURL, apiKey)
            AIProviderKind.OPENAI -> DirectAI.openAIRealtimeWebSocketURL(baseURL, model)
        }
    } catch (_: Exception) {
        throw LiveProtocolException.invalid()
    }
}

class LiveProtocolException(val kind: Kind) : Exception(kind.name) {
    enum class Kind { INVALID, OVERLOADED }

    companion object {
        fun invalid() = LiveProtocolException(Kind.INVALID)
        fun overloaded() = LiveProtocolException(Kind.OVERLOADED)
    }
}

private fun JsonElement?.asString(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonElement?.isTrue(): Boolean = (this as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true

sealed interface LiveToolAction {
    data class Correction(val original: String, val feedback: AIFeedback) : LiveToolAction
    data class Items(val items: List<AILearningItem>) : LiveToolAction
    data class Complete(val taskIndex: Int) : LiveToolAction
}

data class LiveToolCall(val id: String, val name: String, val arguments: JsonObject) {
    fun validated(): LiveToolAction? {
        if (id.isEmpty() || id.toByteArray().size > 128 || name.toByteArray().size > 80
            || arguments.toString().toByteArray().size > 8192) return null
        fun value(key: String, max: Int, from: JsonObject = arguments): String? =
            from[key].asString()?.takeIf { it.isNotBlank() && it.length <= max }
        return when (name) {
            "record_language_correction" -> {
                if (arguments.keys != setOf("original", "corrected", "explanation", "category")) return null
                val original = value("original", 2000) ?: return null
                val corrected = value("corrected", 800) ?: return null
                val explanation = value("explanation", 500) ?: return null
                val category = value("category", 40) ?: return null
                if (category !in setOf("grammar", "word_choice", "naturalness", "other")) return null
                LiveToolAction.Correction(original, AIFeedback(revised = corrected, meaning = "", note = explanation))
            }
            "record_unfamiliar_learning_items" -> {
                if (arguments.keys != setOf("items")) return null
                val raw = (arguments["items"] as? JsonArray)?.map { it as? JsonObject ?: return null } ?: return null
                if (raw.isEmpty() || raw.size > 20) return null
                val items = mutableListOf<AILearningItem>()
                for (item in raw) {
                    if (item.keys != setOf("text", "type", "meaning")) return null
                    val text = value("text", 80, item) ?: return null
                    val type = item["type"].asString() ?: return null
                    val meaning = value("meaning", 120, item) ?: return null
                    if (type !in setOf("word", "phrase", "grammar", "other")) return null
                    if (items.none { SavedExpression.key(it.text) == SavedExpression.key(text) }) {
                        items += AILearningItem(text, type, meaning)
                    }
                }
                LiveToolAction.Items(items)
            }
            "mark_task_complete" -> {
                if (arguments.keys != setOf("taskIndex")) return null
                val number = (arguments["taskIndex"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull ?: return null
                if (number != Math.floor(number) || number < 0 || number > 2) return null
                LiveToolAction.Complete(number.toInt())
            }
            else -> null
        }
    }
}

sealed interface LiveEvent {
    data object SetupComplete : LiveEvent
    data object Interrupted : LiveEvent
    data object TurnComplete : LiveEvent
    data object GoAway : LiveEvent
    /** Internal protocol signal when OpenAI Realtime finishes a tool-only turn and needs `response.create`. */
    data object RequestContinuation : LiveEvent
    data class Transcription(
        val role: PracticeMessage.Role,
        val text: String,
        val finished: Boolean,
        val replace: Boolean = false,
    ) : LiveEvent
    class Audio(val pcm: ByteArray) : LiveEvent
    data class Tool(val call: LiveToolCall) : LiveEvent
    data class CancelledTools(val ids: List<String>) : LiveEvent
    data class Usage(val usage: LiveUsage) : LiveEvent
}

private fun buildToolDeclarations(uppercaseTypes: Boolean): JsonArray {
    val objType = if (uppercaseTypes) "OBJECT" else "object"
    val strType = if (uppercaseTypes) "STRING" else "string"
    val arrType = if (uppercaseTypes) "ARRAY" else "array"
    val intType = if (uppercaseTypes) "INTEGER" else "integer"

    fun fn(name: String, description: String, parameters: JsonObject): JsonObject = buildJsonObject {
        if (!uppercaseTypes) put("type", "function")
        put("name", name)
        put("description", description)
        put("parameters", parameters)
    }

    return buildJsonArray {
        add(fn(
            name = "record_language_correction",
            description = "Coach a specific learner sentence. original must exactly quote the learner transcript, never the partner.",
            parameters = buildJsonObject {
                put("type", objType)
                putJsonObject("properties") {
                    putJsonObject("original") { put("type", strType) }
                    putJsonObject("corrected") { put("type", strType) }
                    putJsonObject("explanation") { put("type", strType); put("description", "简短中文解释") }
                    putJsonObject("category") {
                        put("type", strType)
                        putJsonArray("enum") {
                            for (v in listOf("grammar", "word_choice", "naturalness", "other")) add(JsonPrimitive(v))
                        }
                    }
                }
                putJsonArray("required") {
                    for (k in listOf("original", "corrected", "explanation", "category")) add(JsonPrimitive(k))
                }
            },
        ))
        add(fn(
            name = "record_unfamiliar_learning_items",
            description = "Record only expressions the learner lacked, asked about or got wrong. Never collect fluent correct expressions.",
            parameters = buildJsonObject {
                put("type", objType)
                putJsonObject("properties") {
                    putJsonObject("items") {
                        put("type", arrType)
                        putJsonObject("items") {
                            put("type", objType)
                            putJsonObject("properties") {
                                putJsonObject("text") { put("type", strType) }
                                putJsonObject("type") {
                                    put("type", strType)
                                    putJsonArray("enum") {
                                        for (v in listOf("word", "phrase", "grammar", "other")) add(JsonPrimitive(v))
                                    }
                                }
                                putJsonObject("meaning") { put("type", strType) }
                            }
                            putJsonArray("required") {
                                for (k in listOf("text", "type", "meaning")) add(JsonPrimitive(k))
                            }
                        }
                    }
                }
                putJsonArray("required") { add(JsonPrimitive("items")) }
            },
        ))
        add(fn(
            name = "mark_task_complete",
            description = "Mark every task up to and including taskIndex (zero-based 0,1,2) complete. Call it as soon as the learner has addressed the current task, BEFORE moving on to the next one, and with taskIndex 2 before any closing remark or goodbye.",
            parameters = buildJsonObject {
                put("type", objType)
                putJsonObject("properties") {
                    putJsonObject("taskIndex") { put("type", intType) }
                }
                putJsonArray("required") { add(JsonPrimitive("taskIndex")) }
            },
        ))
    }
}

object LiveCodec {
    const val MAX_MESSAGE_BYTES = 512 * 1024

    val LIVE_TOOLS: JsonArray = buildJsonArray {
        add(buildJsonObject { put("functionDeclarations", buildToolDeclarations(uppercaseTypes = true)) })
    }

    /** Full client-side setup frame for Gemini Live direct BYOK sessions. */
    fun setup(
        model: String,
        systemInstruction: String,
        voiceName: String = DirectAI.DEFAULT_GEMINI_VOICE,
        pauseMs: Int = LivePause.STANDARD,
    ): String {
        val cleanModel = model.trim().removePrefix("models/")
        if (cleanModel.isEmpty()) throw LiveProtocolException.invalid()
        return buildJsonObject {
            putJsonObject("setup") {
                put("model", "models/$cleanModel")
                putJsonObject("generationConfig") {
                    putJsonArray("responseModalities") { add(JsonPrimitive("AUDIO")) }
                    putJsonObject("speechConfig") {
                        putJsonObject("voiceConfig") {
                            putJsonObject("prebuiltVoiceConfig") { put("voiceName", voiceName) }
                        }
                    }
                }
                putJsonObject("systemInstruction") {
                    putJsonArray("parts") { add(buildJsonObject { put("text", systemInstruction) }) }
                }
                put("tools", LIVE_TOOLS)
                putJsonObject("inputAudioTranscription") {}
                putJsonObject("outputAudioTranscription") {}
                putJsonObject("realtimeInputConfig") {
                    putJsonObject("automaticActivityDetection") {
                        put("disabled", false)
                        put("startOfSpeechSensitivity", "START_SENSITIVITY_LOW")
                        put("prefixPaddingMs", 300)
                        put("endOfSpeechSensitivity", "END_SENSITIVITY_LOW")
                        put("silenceDurationMs", LivePause.valid(pauseMs))
                    }
                }
            }
        }.toString()
    }

    fun audio(pcm: ByteArray): String {
        if (pcm.isEmpty() || pcm.size > 3200 || pcm.size % 2 != 0) throw LiveProtocolException.invalid()
        return buildJsonObject {
            putJsonObject("realtimeInput") {
                putJsonObject("audio") {
                    put("mimeType", "audio/pcm;rate=16000")
                    put("data", Base64.getEncoder().encodeToString(pcm))
                }
            }
        }.toString()
    }

    fun audioEnd(): String = buildJsonObject {
        putJsonObject("realtimeInput") { put("audioStreamEnd", true) }
    }.toString()

    fun text(text: String): String {
        if (text.isEmpty() || text.length > 2000) throw LiveProtocolException.invalid()
        return buildJsonObject {
            putJsonObject("clientContent") {
                putJsonArray("turns") {
                    add(buildJsonObject {
                        put("role", "user")
                        putJsonArray("parts") { add(buildJsonObject { put("text", text) }) }
                    })
                }
                put("turnComplete", true)
            }
        }.toString()
    }

    fun toolResponse(call: LiveToolCall, accepted: Boolean): String = buildJsonObject {
        putJsonObject("toolResponse") {
            put("functionResponses", buildJsonArray {
                add(buildJsonObject {
                    put("id", call.id)
                    put("name", call.name)
                    putJsonObject("response") { put("status", if (accepted) "accepted" else "rejected") }
                })
            })
        }
    }.toString()

    fun parse(message: String): List<LiveEvent> {
        if (message.length > MAX_MESSAGE_BYTES) throw LiveProtocolException.invalid()
        val root = try {
            Json.parseToJsonElement(message) as? JsonObject
        } catch (_: SerializationException) {
            null
        } ?: throw LiveProtocolException.invalid()
        if ("error" in root) throw LiveProtocolException.invalid()
        val events = mutableListOf<LiveEvent>()
        if ("setupComplete" in root) events += LiveEvent.SetupComplete
        (root["serverContent"] as? JsonObject)?.let { content ->
            // Invalidation always precedes audio in the same envelope.
            val interrupted = content["interrupted"].isTrue()
            if (interrupted) events += LiveEvent.Interrupted
            for ((key, role) in listOf("inputTranscription" to PracticeMessage.Role.USER,
                "outputTranscription" to PracticeMessage.Role.PARTNER)) {
                val transcription = content[key] as? JsonObject ?: continue
                val text = transcription["text"].asString().orEmpty()
                val finished = transcription["finished"].isTrue()
                if (text.isEmpty() && !finished) continue
                if (text.length > 8000) throw LiveProtocolException.overloaded()
                events += LiveEvent.Transcription(role, text, finished)
            }
            val parts = ((content["modelTurn"] as? JsonObject)?.get("parts") as? JsonArray).orEmpty()
            if (!interrupted) {
                for (part in parts) {
                    val inline = (part as? JsonObject)?.get("inlineData") as? JsonObject ?: continue
                    if (inline["mimeType"].asString()?.startsWith("audio/pcm") != true) continue
                    val raw = inline["data"].asString() ?: continue
                    val pcm = try {
                        Base64.getDecoder().decode(raw)
                    } catch (_: IllegalArgumentException) {
                        continue
                    }
                    if (pcm.size % 2 != 0 || pcm.size > 240_000) throw LiveProtocolException.invalid()
                    events += LiveEvent.Audio(pcm)
                }
            }
            if (content["turnComplete"].isTrue()) events += LiveEvent.TurnComplete
        }
        ((root["toolCall"] as? JsonObject)?.get("functionCalls") as? JsonArray)?.let { calls ->
            if (calls.size > 20) throw LiveProtocolException.overloaded()
            for (call in calls) {
                val fields = call as? JsonObject ?: throw LiveProtocolException.invalid()
                val id = fields["id"].asString() ?: throw LiveProtocolException.invalid()
                val name = fields["name"].asString() ?: throw LiveProtocolException.invalid()
                if (id.toByteArray().size > 128 || name.toByteArray().size > 80) throw LiveProtocolException.invalid()
                events += LiveEvent.Tool(LiveToolCall(id, name, fields["args"] as? JsonObject ?: JsonObject(emptyMap())))
            }
        }
        ((root["toolCallCancellation"] as? JsonObject)?.get("ids") as? JsonArray)?.let { raw ->
            val ids = raw.map { it.asString() ?: throw LiveProtocolException.invalid() }
            if (ids.size > 20 || ids.any { it.toByteArray().size > 128 }) throw LiveProtocolException.invalid()
            events += LiveEvent.CancelledTools(ids)
        }
        (root["usageMetadata"] as? JsonObject)?.let { metadata ->
            LiveUsage.from(metadata)?.let { events += LiveEvent.Usage(it) }
        }
        if ("goAway" in root) events += LiveEvent.GoAway
        return events
    }
}

object OpenAIRealtimeCodec {
    val TOOLS: JsonArray = buildToolDeclarations(uppercaseTypes = false)

    private val BENIGN_ERROR_CODES = setOf(
        "input_audio_buffer_commit_empty",
        "response_cancel_not_active",
        "conversation_already_has_active_response",
    )

    /** Learner speech transcription inside the GA Realtime session (the beta `OpenAI-Beta: realtime=v1` interface was shut down on 2026-05-12). */
    const val TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe"

    fun sessionUpdate(instructions: String, voice: String, pauseMs: Int = LivePause.STANDARD): String = buildJsonObject {
        put("type", "session.update")
        putJsonObject("session") {
            put("type", "realtime")
            putJsonArray("output_modalities") { add(JsonPrimitive("audio")) }
            put("instructions", instructions)
            putJsonObject("audio") {
                putJsonObject("input") {
                    putJsonObject("format") {
                        put("type", "audio/pcm")
                        put("rate", 24000)
                    }
                    putJsonObject("transcription") { put("model", TRANSCRIPTION_MODEL) }
                    putJsonObject("turn_detection") {
                        put("type", "server_vad")
                        put("threshold", 0.6)
                        put("prefix_padding_ms", 300)
                        put("silence_duration_ms", LivePause.valid(pauseMs))
                        put("create_response", true)
                        put("interrupt_response", true)
                    }
                }
                putJsonObject("output") {
                    putJsonObject("format") {
                        put("type", "audio/pcm")
                        put("rate", 24000)
                    }
                    put("voice", voice)
                }
            }
            put("tools", TOOLS)
            put("tool_choice", "auto")
        }
    }.toString()

    fun audioAppend(pcm24k: ByteArray): String {
        if (pcm24k.isEmpty() || pcm24k.size > 4800 || pcm24k.size % 2 != 0) throw LiveProtocolException.invalid()
        return buildJsonObject {
            put("type", "input_audio_buffer.append")
            put("audio", Base64.getEncoder().encodeToString(pcm24k))
        }.toString()
    }

    fun textMessages(text: String): List<String> {
        if (text.isEmpty() || text.length > 2000) throw LiveProtocolException.invalid()
        val itemCreate = buildJsonObject {
            put("type", "conversation.item.create")
            putJsonObject("item") {
                put("type", "message")
                put("role", "user")
                putJsonArray("content") {
                    add(buildJsonObject {
                        put("type", "input_text")
                        put("text", text)
                    })
                }
            }
        }.toString()
        return listOf(itemCreate, responseCreate())
    }

    fun responseCreate(): String = """{"type":"response.create"}"""

    fun responseCancel(): String = """{"type":"response.cancel"}"""

    fun toolResponse(call: LiveToolCall, accepted: Boolean): String = buildJsonObject {
        put("type", "conversation.item.create")
        putJsonObject("item") {
            put("type", "function_call_output")
            put("call_id", call.id)
            put("output", if (accepted) """{"status":"accepted"}""" else """{"status":"rejected"}""")
        }
    }.toString()

    fun parse(message: String, callNames: MutableMap<String, String> = mutableMapOf()): List<LiveEvent> {
        if (message.length > LiveCodec.MAX_MESSAGE_BYTES) throw LiveProtocolException.invalid()
        val root = try {
            Json.parseToJsonElement(message) as? JsonObject
        } catch (_: SerializationException) {
            null
        } ?: throw LiveProtocolException.invalid()
        val type = root["type"].asString() ?: throw LiveProtocolException.invalid()
        return when (type) {
            "session.updated" -> listOf(LiveEvent.SetupComplete)
            "input_audio_buffer.speech_started" -> listOf(LiveEvent.Interrupted)
            "conversation.item.input_audio_transcription.delta" -> {
                val delta = root["delta"].asString().orEmpty()
                if (delta.length > 8000) throw LiveProtocolException.overloaded()
                if (delta.isEmpty()) emptyList()
                else listOf(LiveEvent.Transcription(PracticeMessage.Role.USER, delta, finished = false))
            }
            "conversation.item.input_audio_transcription.completed" -> {
                val transcript = root["transcript"].asString().orEmpty().trim()
                if (transcript.length > 8000) throw LiveProtocolException.overloaded()
                listOf(LiveEvent.Transcription(PracticeMessage.Role.USER, transcript, finished = true, replace = true))
            }
            "response.audio.delta", "response.output_audio.delta" -> {
                val raw = root["delta"].asString().orEmpty()
                if (raw.isEmpty()) return emptyList()
                val pcm = try {
                    Base64.getDecoder().decode(raw)
                } catch (_: IllegalArgumentException) {
                    throw LiveProtocolException.invalid()
                }
                if (pcm.isEmpty()) return emptyList()
                if (pcm.size % 2 != 0 || pcm.size > 240_000) throw LiveProtocolException.invalid()
                listOf(LiveEvent.Audio(pcm))
            }
            "response.audio_transcript.delta", "response.output_audio_transcript.delta" -> {
                val delta = root["delta"].asString().orEmpty()
                if (delta.length > 8000) throw LiveProtocolException.overloaded()
                if (delta.isEmpty()) emptyList()
                else listOf(LiveEvent.Transcription(PracticeMessage.Role.PARTNER, delta, finished = false))
            }
            "response.audio_transcript.done", "response.output_audio_transcript.done" -> {
                val transcript = root["transcript"].asString().orEmpty().trim()
                if (transcript.length > 8000) throw LiveProtocolException.overloaded()
                listOf(LiveEvent.Transcription(PracticeMessage.Role.PARTNER, transcript, finished = true, replace = true))
            }
            "response.output_item.added" -> {
                val item = root["item"] as? JsonObject
                if (item?.get("type").asString() == "function_call") {
                    val callId = item?.get("call_id").asString()
                    val name = item?.get("name").asString()
                    if (!callId.isNullOrEmpty() && !name.isNullOrEmpty() && callNames.size < 256) {
                        callNames[callId] = name
                    }
                }
                emptyList()
            }
            "response.function_call_arguments.done" -> {
                val callId = root["call_id"].asString() ?: throw LiveProtocolException.invalid()
                val name = root["name"].asString() ?: callNames[callId] ?: throw LiveProtocolException.invalid()
                if (callId.toByteArray().size > 128 || name.toByteArray().size > 80) throw LiveProtocolException.invalid()
                val rawArgs = root["arguments"].asString().orEmpty()
                val args = runCatching { Json.parseToJsonElement(rawArgs) as? JsonObject }.getOrNull() ?: JsonObject(emptyMap())
                listOf(LiveEvent.Tool(LiveToolCall(callId, name, args)))
            }
            "response.done" -> {
                val output = ((root["response"] as? JsonObject)?.get("output") as? JsonArray).orEmpty()
                val hasFunctionCall = output.any { (it as? JsonObject)?.get("type").asString() == "function_call" }
                val hasMessage = output.any { (it as? JsonObject)?.get("type").asString() == "message" }
                if (hasFunctionCall && !hasMessage) listOf(LiveEvent.RequestContinuation)
                else listOf(LiveEvent.TurnComplete)
            }
            "error" -> {
                val code = (root["error"] as? JsonObject)?.get("code").asString()
                if (code in BENIGN_ERROR_CODES) emptyList() else throw LiveProtocolException.invalid()
            }
            else -> emptyList()
        }
    }
}

/**
 * Stateful 16 kHz -> 24 kHz (2:3) linear-interpolating resampler for mono signed PCM16 LE.
 * Every 2 input samples produce 3 evenly-spaced output samples (320 -> 480 samples per 20 ms frame),
 * keeping the previous sample across frame boundaries so consecutive frames join seamlessly.
 */
class Pcm16Resampler16To24 {
    private var hasPrevious = false
    private var previousSample = 0
    private var hasLeftover = false
    private var leftoverSample = 0

    fun resample(pcm16k: ByteArray): ByteArray {
        if (pcm16k.size % 2 != 0) throw LiveProtocolException.invalid()
        if (pcm16k.isEmpty()) return ByteArray(0)
        val incomingCount = pcm16k.size / 2
        val totalSamples = incomingCount + (if (hasLeftover) 1 else 0)
        val pairs = totalSamples / 2
        val out = ByteArray(pairs * 6)

        fun sampleAt(index: Int): Int {
            val actual = if (hasLeftover) {
                if (index == 0) return leftoverSample
                index - 1
            } else index
            val low = pcm16k[actual * 2].toInt() and 0xFF
            val high = pcm16k[actual * 2 + 1].toInt()
            return ((high shl 8) or low).toShort().toInt()
        }

        fun writeSample(byteOffset: Int, value: Int) {
            val clamped = value.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            out[byteOffset] = (clamped and 0xFF).toByte()
            out[byteOffset + 1] = ((clamped shr 8) and 0xFF).toByte()
        }

        for (pair in 0 until pairs) {
            val a = sampleAt(pair * 2)
            val b = sampleAt(pair * 2 + 1)
            val prev = if (hasPrevious) previousSample else a
            writeSample(pair * 6, (2 * prev + a) / 3)
            writeSample(pair * 6 + 2, a)
            writeSample(pair * 6 + 4, (a + 2 * b) / 3)
            previousSample = b
            hasPrevious = true
        }

        if (totalSamples % 2 == 1) {
            leftoverSample = sampleAt(totalSamples - 1)
            hasLeftover = true
        } else {
            hasLeftover = false
        }
        return out
    }

    fun reset() {
        hasPrevious = false
        previousSample = 0
        hasLeftover = false
        leftoverSample = 0
    }
}

/** Late callbacks from an old connection or an interrupted reply carry an old generation. */
class LiveGenerations {
    var connection = 0L
        private set
    var playback = 0L
        private set

    fun reconnect() {
        connection++
        playback++
    }

    fun interrupt() {
        playback++
    }

    fun accepts(connection: Long): Boolean = connection == this.connection
    fun accepts(connection: Long, playback: Long): Boolean = connection == this.connection && playback == this.playback
}

/** Frames exactly 20 ms of 16 kHz mono PCM16, keeping leftover bytes across reads. */
class LivePCMFramer {
    private var remainder = ByteArray(0)

    fun append(bytes: ByteArray): List<ByteArray> {
        if (bytes.size % 2 != 0 || bytes.size > 32_000) throw LiveProtocolException.invalid()
        val data = remainder + bytes
        val frames = (0 until data.size / FRAME_BYTES).map { data.copyOfRange(it * FRAME_BYTES, (it + 1) * FRAME_BYTES) }
        remainder = data.copyOfRange(frames.size * FRAME_BYTES, data.size)
        return frames
    }

    fun reset() {
        remainder = ByteArray(0)
    }

    companion object {
        const val FRAME_BYTES = 640
    }
}

/**
 * Streaming text is a delta; identical deltas can be intentional repetitions.
 * Only a full final snapshot replaces previous text. An interrupted turnComplete
 * belongs to the cancelled model turn, not the learner's barge-in.
 */
class LiveTranscriptReducer {
    data class Segment(val id: UUID, val text: String, val finalized: Boolean)

    private val segments = mutableMapOf<PracticeMessage.Role, Segment>()
    private var interrupted = false
    private var inputTurnBoundary = false

    fun update(role: PracticeMessage.Role, text: String, finished: Boolean, replace: Boolean = false): Segment {
        var segment = segments[role] ?: Segment(UUID.randomUUID(), "", false)
        if (role == PracticeMessage.Role.USER && inputTurnBoundary && !finished && text.isNotBlank()) {
            // Older model variants may omit finished. A non-final delta after
            // normal turnComplete starts the next input turn; a late explicit
            // final marker still updates the preceding bubble.
            segment = Segment(UUID.randomUUID(), "", false)
        } else if (segment.finalized) {
            // A new learner utterance can precede the interrupted notification.
            // Do not silently discard its first words while the partner speaks.
            if (role == PracticeMessage.Role.USER && text.isNotBlank() && (!finished || (!replace && !segment.text.startsWith(text)))) {
                segment = Segment(UUID.randomUUID(), "", false)
            } else {
                return segment
            }
        }
        val merged = when {
            replace -> if (text.isNotEmpty()) text else segment.text
            finished && text.startsWith(segment.text) -> text
            else -> segment.text + text
        }
        if (merged.length > 8000) throw LiveProtocolException.overloaded()
        segment = segment.copy(text = merged, finalized = finished)
        segments[role] = segment
        if (role == PracticeMessage.Role.USER) inputTurnBoundary = false
        return segment
    }

    fun finishPartner() {
        segments.remove(PracticeMessage.Role.PARTNER)
        if (segments[PracticeMessage.Role.USER]?.finalized == true) segments.remove(PracticeMessage.Role.USER)
        interrupted = true
        inputTurnBoundary = false
    }

    fun finishTurn() {
        segments.remove(PracticeMessage.Role.PARTNER)
        // Retain unfinished user text for a late final marker. An interrupted
        // turnComplete must never mark a boundary in the learner's barge-in.
        inputTurnBoundary = !interrupted
        if (segments[PracticeMessage.Role.USER]?.finalized == true) segments.remove(PracticeMessage.Role.USER)
        interrupted = false
    }

    fun reset() {
        segments.clear()
        interrupted = false
        inputTurnBoundary = false
    }
}

/**
 * Reservations include audio not yet handed to the player and audio already written to
 * it but not yet heard, so both the hand-off backlog and the player backlog are bounded.
 * Not thread-safe: the audio controller guards it with its own lock.
 */
class LivePlaybackBuffer(private val maxBytes: Int = MAX_BYTES, private val maxChunks: Int = MAX_CHUNKS) {
    companion object {
        /**
         * Two minutes of 24 kHz speech. The model streams a reply faster than it plays, so a
         * long answer arrives in a burst; a smaller bound used to drop the end of it.
         */
        const val MAX_BYTES = 24_000 * 2 * 120
        const val MAX_CHUNKS = 8_192
    }

    class Chunk(val data: ByteArray, val generation: Long)

    var generation = 0L
        private set
    var reservedBytes = 0
        private set
    private var reservedChunks = 0
    private val pending = ArrayDeque<ByteArray>()
    private val scheduled = ArrayDeque<Int>()

    fun reserve(bytes: Int): Long? {
        if (bytes <= 0 || bytes % 2 != 0 || reservedBytes + bytes > maxBytes || reservedChunks >= maxChunks) return null
        reservedBytes += bytes
        reservedChunks++
        return generation
    }

    fun enqueue(data: ByteArray, generation: Long): Boolean {
        if (generation != this.generation) return false
        pending.addLast(data)
        return true
    }

    /** The next chunk to hand to the player; it stays reserved until `complete`. */
    fun next(): Chunk? {
        val data = pending.removeFirstOrNull() ?: return null
        scheduled.addLast(data.size)
        return Chunk(data, generation)
    }

    /** The oldest chunk handed to the player has been heard. */
    fun complete(bytes: Int, generation: Long): Boolean {
        if (generation != this.generation || !scheduled.remove(bytes)) return false
        reservedBytes = maxOf(0, reservedBytes - bytes)
        reservedChunks = maxOf(0, reservedChunks - 1)
        return true
    }

    fun invalidate() {
        generation++
        pending.clear()
        scheduled.clear()
        reservedBytes = 0
        reservedChunks = 0
    }
}

/**
 * Drain the entire bounded backlog per wakeup, rather than pacing one frame
 * after each sleep. A 20 ms frame is a unit of data, not a scheduler deadline.
 */
object LiveUploadBatch {
    fun take(maximum: Int = 50, nextFrame: () -> ByteArray?): List<ByteArray> {
        val batch = mutableListOf<ByteArray>()
        while (batch.size < maximum) batch += nextFrame() ?: break
        return batch
    }

    /**
     * Frames already waiting together go out as one message of up to 100 ms
     * (the codec's limit), instead of one WebSocket message per 20 ms frame.
     * Nothing waits for more audio, so latency is unchanged.
     */
    fun messages(frames: List<ByteArray>, framesPerMessage: Int = 5): List<Pair<ByteArray, Int>> =
        frames.chunked(maxOf(1, framesPerMessage)).map { group ->
            group.fold(ByteArray(0)) { all, frame -> all + frame } to group.size
        }
}

/**
 * A batch can already have left the capture queue when mute occurs. Its epoch
 * must be rejected too, including after a quick mute/unmute in one connection.
 */
class LiveInputGate {
    var generation = 0L
        private set
    var isOpen = false
        private set

    fun open() {
        generation++
        isOpen = true
    }

    fun close() {
        generation++
        isOpen = false
    }

    fun accepts(epoch: Long): Boolean = isOpen && epoch == generation
}

/** At most `capacity` frames (one second by default); the oldest audio is dropped under pressure. */
class LiveInputBuffer(capacity: Int = 50) {
    val capacity = maxOf(1, capacity)
    private val frames = ArrayDeque<ByteArray>()
    var droppedFrames = 0
        private set
    val count: Int get() = frames.size

    fun append(incoming: List<ByteArray>) {
        frames.addAll(incoming)
        while (frames.size > capacity) {
            frames.removeFirst()
            droppedFrames++
        }
    }

    fun take(): ByteArray? = frames.removeFirstOrNull()
    fun clear() = frames.clear()
}

/**
 * Tool calls and input transcription have no guaranteed relative order.
 * Keep bounded, cancellable effects until their quoted/user sentence exists.
 */
class LivePendingTools {
    private val pending = mutableListOf<Pair<String, LiveToolAction>>()
    val count: Int get() = pending.size

    /** The session after what could be applied now, and the vocabulary to collect. */
    fun apply(call: LiveToolCall, session: PracticeSession): Pair<PracticeSession, List<AILearningItem>> {
        val action = call.validated() ?: return session to emptyList()
        if (action is LiveToolAction.Items) return session to action.items
        val (updated, done) = attempt(action, session)
        if (!done && pending.size < 20) pending += call.id to action
        return updated to emptyList()
    }

    fun flush(session: PracticeSession): PracticeSession {
        var current = session
        pending.removeAll { (_, action) ->
            val (updated, done) = attempt(action, current)
            current = updated
            done
        }
        return current
    }

    fun cancel(ids: Collection<String>) {
        val cancelled = ids.toSet()
        pending.removeAll { it.first in cancelled }
    }

    fun reset() = pending.clear()

    private fun attempt(action: LiveToolAction, session: PracticeSession): Pair<PracticeSession, Boolean> = when (action) {
        is LiveToolAction.Correction ->
            session.liveCorrection(action.original, action.feedback)?.let { it to true } ?: (session to false)
        is LiveToolAction.Complete -> {
            // Obsolete requests are discarded. A later index completes the tasks in
            // between only if the learner already spoke in the current one; it is
            // never queued to advance without a new model decision.
            if (session.phase == PracticeSession.Phase.COMPLETED || action.taskIndex < session.stepIndex) session to true
            else session.liveComplete(action.taskIndex)?.let { it to true } ?: (session to (action.taskIndex > session.stepIndex))
        }
        is LiveToolAction.Items -> session to true
    }
}
