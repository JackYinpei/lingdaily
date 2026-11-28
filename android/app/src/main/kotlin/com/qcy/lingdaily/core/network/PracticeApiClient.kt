package com.qcy.lingdaily.core.network

import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.SerializationStrategy
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import com.qcy.lingdaily.core.audio.wavFile
import com.qcy.lingdaily.core.model.AIPracticeAction
import com.qcy.lingdaily.core.model.AIPracticeRequest
import com.qcy.lingdaily.core.model.AIPracticeResponse
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.PracticeMessage
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.ScenarioCatalog
import com.qcy.lingdaily.core.model.SentenceReviewRecord
import com.qcy.lingdaily.core.model.SentenceReviewRequest
import com.qcy.lingdaily.core.model.TodayEpisode
import com.qcy.lingdaily.core.model.parseScenarioCatalog
import com.qcy.lingdaily.core.model.prefix
import com.qcy.lingdaily.core.persistence.SyncChanges
import com.qcy.lingdaily.core.persistence.SyncSnapshot
import com.qcy.lingdaily.core.realtime.LiveConnectionConfig
import com.qcy.lingdaily.core.realtime.LivePause
import com.qcy.lingdaily.core.realtime.LiveSuggestion
import com.qcy.lingdaily.core.realtime.LiveSuggestionRequest
import com.qcy.lingdaily.core.realtime.LiveTokenRequest

class PracticeNetworkException(val kind: Kind, message: String) : Exception(message) {
    enum class Kind { NOT_CONFIGURED, SIGNED_OUT, INVALID_REPLY, UNAVAILABLE, SERVER }

    companion object {
        fun notConfigured(message: String = "请先在「我的 → 接口设置」填写 API Key 和模型名称。") =
            PracticeNetworkException(Kind.NOT_CONFIGURED, message)
        fun signedOut() = PracticeNetworkException(Kind.SIGNED_OUT, "请先在「我的」登录账号。")
        fun invalidReply(message: String = "AI 回复不完整，请重试。你的回答已保留。") =
            PracticeNetworkException(Kind.INVALID_REPLY, message)
        fun unavailable(message: String = "暂时连不上服务，请检查网络或接口地址后重试。") =
            PracticeNetworkException(Kind.UNAVAILABLE, message)
        fun server(message: String) = PracticeNetworkException(Kind.SERVER, message)
    }
}

/** Production service used for optional account auth/sync, built-in scenario catalog and daily podcasts. */
object LingDailyService {
    const val BASE_URL = "https://lingdaily.yasobi.xyz"
}

/** The AI calls practice features make; screens and controllers take one injected instance. */
interface PracticeServing {
    suspend fun respond(request: AIPracticeRequest): AIPracticeResponse
    suspend fun reviewSentences(request: SentenceReviewRequest): List<SentenceReviewRecord>
    suspend fun createScenario(description: String): PracticeScenario
    suspend fun createNewsScenario(episode: TodayEpisode): PracticeScenario
    suspend fun translate(text: String): String
    suspend fun suggest(session: PracticeSession): LiveSuggestion
    suspend fun scenarioIdeas(avoiding: List<String>, interests: List<String>): List<String>
    fun liveConnection(session: PracticeSession): LiveConnectionConfig

    /** Fallback read-aloud audio (WAV or MP3) when local device TTS is unavailable. */
    suspend fun speech(text: String, partner: String?): ByteArray

    /** The words in a short WAV recording (16 kHz mono PCM16); empty when nothing was said. */
    suspend fun transcribe(wav: ByteArray): String
}

@Serializable
private data class ServerFailure(val message: String)

@Serializable
private data class PodcastList(val episodes: List<TodayEpisode> = emptyList())

@Serializable
private data class Deleted(val deleted: Boolean)

class PracticeApiClient(
    private val accountSession: () -> AccountSession? = { null },
    private val aiSettings: () -> AISettings = { AISettings() },
    private val pauseMs: () -> Int = { LivePause.STANDARD },
    /** The production service rejected the stored session: the device signs out. */
    private val onSessionRejected: () -> Unit = {},
    private val baseURL: String = LingDailyService.BASE_URL,
    private val http: OkHttpClient = sharedClient,
    private val syncHttp: OkHttpClient = sharedSyncClient,
) : PracticeServing {

    // ---- Account, cloud sync & public editorial content ----

    /** Exchanges the account's email and password for a LingDaily app session. */
    suspend fun signIn(email: String, password: String): AccountSession {
        val response = sendLingDaily("api/android/auth/password",
            encode(PasswordCredentials.serializer(), PasswordCredentials(email, password)),
            AccountSignInResponse.serializer(), bearer = null)
        return response.session() ?: throw PracticeNetworkException.invalidReply()
    }

    /** Creates an account. Null means the address must be confirmed by email before signing in. */
    suspend fun register(email: String, password: String): AccountSession? {
        val response = sendLingDaily("api/android/auth/register",
            encode(PasswordCredentials.serializer(), PasswordCredentials(email, password)),
            AccountSignInResponse.serializer(), bearer = null)
        if (response.confirmationRequired) return null
        return response.session() ?: throw PracticeNetworkException.invalidReply()
    }

    /** Phone number (no SMS verification) and password → app session; `autoRegister` creates a missing account. */
    suspend fun signInWithPhone(phone: String, password: String, autoRegister: Boolean): AccountSession {
        val response = sendLingDaily("api/android/auth/phone",
            encode(PhoneCredentials.serializer(), PhoneCredentials(phone, password, autoRegister)),
            AccountSignInResponse.serializer(), bearer = null)
        return response.session() ?: throw PracticeNetworkException.invalidReply()
    }

    /** Uploads pending local changes and returns the account's cloud copy. */
    suspend fun sync(changes: SyncChanges): SyncSnapshot {
        val account = accountSession()?.takeIf { it.isUsable() } ?: throw PracticeNetworkException.signedOut()
        return sendLingDaily("api/ios/sync", encode(SyncChanges.serializer(), changes), SyncSnapshot.serializer(),
            bearer = account.token, maxBytes = 64 * 1024 * 1024, client = syncHttp)
    }

    /** Permanently deletes the account and its cloud data (web and iOS data included). */
    suspend fun deleteAccount(password: String) {
        val account = accountSession()?.takeIf { it.isUsable() } ?: throw PracticeNetworkException.signedOut()
        val result = sendLingDaily("api/android/account/delete",
            encode(PasswordConfirmation.serializer(), PasswordConfirmation(password)),
            Deleted.serializer(), bearer = account.token)
        if (!result.deleted) throw PracticeNetworkException.invalidReply()
    }

    /** Recent daily podcasts, newest first. Public like the web's podcast page. */
    suspend fun podcasts(): List<TodayEpisode> =
        sendLingDaily("api/ios/podcasts", null, PodcastList.serializer(), maxBytes = 512 * 1024, bearer = null).episodes

    /** Built-in scenarios. Public editorial content, so it loads without an account. */
    suspend fun scenarioCatalog(): ScenarioCatalog {
        val response = sendLingDaily("api/ios/scenarios", null, JsonElement.serializer(), maxBytes = 512 * 1024, bearer = null)
        val catalog = parseScenarioCatalog(response.toString())
        if (catalog.scenarios.isEmpty()) throw PracticeNetworkException.invalidReply()
        return catalog
    }

    // ---- Direct BYOK AI calls ----

    private fun requireTextProvider(): ResolvedProvider =
        aiSettings().resolvedText ?: throw PracticeNetworkException.notConfigured("请先在「我的 → 接口设置」配置文字模型与 API Key。")

    override fun liveConnection(session: PracticeSession): LiveConnectionConfig {
        val resolved = aiSettings().resolvedVoice
            ?: throw PracticeNetworkException.notConfigured("请先在「我的 → 接口设置」配置实时语音模型与 API Key。")
        val pause = LivePause.valid(pauseMs())
        val request = LiveTokenRequest.from(session)
        return LiveConnectionConfig(
            provider = resolved.provider,
            apiKey = resolved.apiKey,
            baseURL = resolved.baseURL,
            model = resolved.liveModel,
            systemInstruction = DirectAI.buildLiveInstruction(request),
            geminiVoice = DirectAI.voiceForPartner(session.scenario.partner),
            openAIVoice = DirectAI.openAIVoiceForPartner(session.scenario.partner),
            pauseMs = pause,
        )
    }

    override suspend fun respond(request: AIPracticeRequest): AIPracticeResponse {
        validatePracticeRequest(request)
        val context = DirectAI.buildPracticeContext(request)
        val retryContext = JsonObject(context + ("formatReminder" to JsonPrimitive(
            "The previous attempt was invalid. Rewrite ONLY learnerLatestAnswer in feedback.revised; do not put the role-play partner reply there. Follow every required field and length limit."
        )))
        val latestAnswer = request.messages.lastOrNull {
            it.role == PracticeMessage.Role.USER && it.stepIndex == request.stepIndex
        }?.text.orEmpty()
        val (modelName, turn) = generateStructured(
            systemInstruction = DirectAI.practiceInstruction(request.level, request.attitude, request.temperament, request.reviewItems),
            responseSchema = DirectAI.RESPONSE_SCHEMA,
            jsonContract = DirectAI.PRACTICE_JSON_CONTRACT,
            payload = context,
            retryPayload = retryContext,
            temperature = 0.65,
            maxOutputTokens = 1800,
            invalidMessage = "AI 这次的表达建议不完整，请重试。",
        ) { raw -> DirectAI.parsePracticeTurn(raw, request.action, latestAnswer) }
        return AIPracticeResponse(requestId = request.requestId, model = modelName, data = turn)
    }

    override suspend fun reviewSentences(request: SentenceReviewRequest): List<SentenceReviewRecord> {
        if (request.messages.isEmpty() || request.messages.size > 4) throw PracticeNetworkException.invalidReply()
        val payload = buildJsonObject {
            put("scenario", AppJson.encodeToJsonElement(AIPracticeRequest.Scenario.serializer(), request.scenario))
            put("learnerMessages", AppJson.encodeToJsonElement(
                kotlinx.serialization.builtins.ListSerializer(SentenceReviewRequest.Message.serializer()), request.messages))
        }
        val retryPayload = JsonObject(payload + ("formatReminder" to JsonPrimitive(
            "Return exactly one item for EVERY provided messageId. Empty strings mean no improvement needed. Preserve learner meaning and perspective."
        )))
        val (_, records) = generateStructured(
            systemInstruction = DirectAI.SENTENCE_REVIEW_INSTRUCTION,
            responseSchema = DirectAI.SENTENCE_REVIEW_SCHEMA,
            jsonContract = DirectAI.SENTENCE_REVIEW_JSON_CONTRACT,
            payload = payload,
            retryPayload = retryPayload,
            temperature = 0.2,
            maxOutputTokens = 8192,
            invalidMessage = "这次的表达建议不完整，请重试。",
            maxResponseBytes = 256 * 1024,
        ) { raw -> DirectAI.parseSentenceReview(raw, request.messages) }
        return records
    }

    /** Generates a three-step scenario from the learner's own description of an upcoming conversation. */
    override suspend fun createScenario(description: String): PracticeScenario {
        val trimmed = description.trim().prefix(300)
        if (trimmed.isEmpty()) throw PracticeNetworkException.invalidReply("请先描述想练习的对话场景。")
        val payload = buildJsonObject { put("learnerDescription", trimmed) }
        val retryPayload = JsonObject(payload + ("formatReminder" to JsonPrimitive(
            "The previous attempt was invalid. Return exactly 3 steps and respect every field length."
        )))
        val (_, draft) = generateStructured(
            systemInstruction = DirectAI.SCENARIO_INSTRUCTION,
            responseSchema = DirectAI.SCENARIO_RESPONSE_SCHEMA,
            jsonContract = DirectAI.SCENARIO_JSON_CONTRACT,
            payload = payload,
            retryPayload = retryPayload,
            temperature = 0.8,
            maxOutputTokens = 2400,
            invalidMessage = "AI 这次没能生成完整的场景，请重试。",
        ) { raw -> DirectAI.parseScenarioDraft(raw) }
        val id = "custom-${UUID.randomUUID().toString().uppercase()}"
        return draft.practiceScenario(id) ?: throw PracticeNetworkException.invalidReply("AI 这次没能生成完整的场景，请重试。")
    }

    override suspend fun createNewsScenario(episode: TodayEpisode): PracticeScenario {
        val payload = DirectAI.newsScenarioPayload(episode)
        val retryPayload = JsonObject(payload + ("formatReminder" to JsonPrimitive(
            "The previous attempt was invalid. Return exactly 3 steps and respect every field length."
        )))
        val (_, draft) = generateStructured(
            systemInstruction = DirectAI.NEWS_SCENARIO_INSTRUCTION,
            responseSchema = DirectAI.SCENARIO_RESPONSE_SCHEMA,
            jsonContract = DirectAI.SCENARIO_JSON_CONTRACT,
            payload = payload,
            retryPayload = retryPayload,
            temperature = 0.6,
            maxOutputTokens = 2400,
            invalidMessage = "这期播客的话题还没生成好，请再试一次。",
        ) { raw -> DirectAI.parseScenarioDraft(raw) }
        return draft.practiceScenario("news-${episode.date}")
            ?: throw PracticeNetworkException.invalidReply("这期播客的话题还没生成好，请再试一次。")
    }

    /** Chinese gloss for one partner line, fetched when the learner taps 中文. */
    override suspend fun translate(text: String): String {
        val line = text.trim().prefix(1000)
        if (line.isEmpty()) throw PracticeNetworkException.invalidReply()
        val payload = buildJsonObject { put("line", line) }
        val retryPayload = JsonObject(payload + ("formatReminder" to JsonPrimitive("Return {\"translation\": \"...\"} only.")))
        val (_, translated) = generateStructured(
            systemInstruction = DirectAI.TRANSLATION_INSTRUCTION,
            responseSchema = DirectAI.TRANSLATION_RESPONSE_SCHEMA,
            jsonContract = DirectAI.TRANSLATION_JSON_CONTRACT,
            payload = payload,
            retryPayload = retryPayload,
            temperature = 0.2,
            maxOutputTokens = 1200,
            invalidMessage = "这句翻译不完整，请重试。",
        ) { raw -> DirectAI.parseTranslation(raw) }
        return translated
    }

    /** Chinese-first reply idea for the learner's next line in a Live call. */
    override suspend fun suggest(session: PracticeSession): LiveSuggestion {
        val body = LiveSuggestionRequest.from(session) ?: throw PracticeNetworkException.invalidReply()
        val payload = DirectAI.buildSuggestionPayload(body)
        val retryPayload = JsonObject(payload + ("formatReminder" to JsonPrimitive(
            "Return hint, keywords, reply and meaning only, within the length limits."
        )))
        val (_, suggestion) = generateStructured(
            systemInstruction = DirectAI.suggestionInstruction(body.reviewItems),
            responseSchema = DirectAI.suggestionResponseSchema(body.level),
            jsonContract = DirectAI.suggestionJsonContract(body.level),
            payload = payload,
            retryPayload = retryPayload,
            temperature = 0.5,
            maxOutputTokens = 1500,
            invalidMessage = "这次的建议不完整，请再点一次。",
        ) { raw -> DirectAI.parseSuggestion(raw) }
        return suggestion
    }

    /** "换一批": three fresh one-line scenario ideas, avoiding ones already shown. */
    override suspend fun scenarioIdeas(avoiding: List<String>, interests: List<String>): List<String> {
        val payload = DirectAI.buildIdeasPayload(avoiding, interests)
        val retryPayload = JsonObject(payload + ("formatReminder" to JsonPrimitive(
            "Return exactly 3 ideas, each at most 30 Chinese characters."
        )))
        val (_, ideas) = generateStructured(
            systemInstruction = DirectAI.IDEAS_INSTRUCTION,
            responseSchema = DirectAI.IDEAS_RESPONSE_SCHEMA,
            jsonContract = DirectAI.IDEAS_JSON_CONTRACT,
            payload = payload,
            retryPayload = retryPayload,
            temperature = 1.0,
            maxOutputTokens = 1200,
            invalidMessage = "这一批没生成好，请再点一次。",
        ) { raw -> DirectAI.parseIdeas(raw) }
        return ideas
    }

    override suspend fun speech(text: String, partner: String?): ByteArray {
        val line = text.trim().prefix(1000)
        if (line.isEmpty()) throw PracticeNetworkException.invalidReply()
        val settings = aiSettings()
        val resolved = settings.resolvedText ?: settings.resolvedVoice
            ?: throw PracticeNetworkException.notConfigured("本机缺少英语语音引擎，请先配置模型接口以使用在线朗读。")
        return when (resolved.provider) {
            AIProviderKind.OPENAI -> {
                val body = buildJsonObject {
                    put("model", "tts-1")
                    put("voice", DirectAI.openAIVoiceForPartner(partner))
                    put("input", line)
                }.toString().toRequestBody(JSON)
                val request = Request.Builder()
                    .url(DirectAI.openAISpeechURL(resolved.baseURL))
                    .header("Authorization", "Bearer ${resolved.apiKey}")
                    .post(body)
                    .build()
                executeDirect(request, model = "tts-1", maxBytes = 4 * 1024 * 1024)
            }
            AIProviderKind.GEMINI -> {
                val model = resolved.textModel.ifEmpty { resolved.liveModel }
                val body = DirectAI.buildGeminiSpeechBody(line, DirectAI.voiceForPartner(partner)).toRequestBody(JSON)
                val request = Request.Builder()
                    .url(DirectAI.geminiGenerateContentURL(resolved.baseURL, model))
                    .header("x-goog-api-key", resolved.apiKey)
                    .post(body)
                    .build()
                val responseBytes = executeDirect(request, model = model, maxBytes = 8 * 1024 * 1024)
                val pcm = DirectAI.extractGeminiAudioPcm(responseBytes.decodeToString())
                wavFile(pcm, sampleRate = 24_000)
            }
        }
    }

    override suspend fun transcribe(wav: ByteArray): String {
        val resolved = requireTextProvider()
        return try {
            when (resolved.provider) {
                AIProviderKind.GEMINI -> {
                    val body = DirectAI.buildGeminiTranscribeBody(resolved.textModel, wav).toRequestBody(JSON)
                    val request = Request.Builder()
                        .url(DirectAI.geminiGenerateContentURL(resolved.baseURL, resolved.textModel))
                        .header("x-goog-api-key", resolved.apiKey)
                        .post(body)
                        .build()
                    val reply = executeDirect(request, model = resolved.textModel, maxBytes = 64 * 1024).decodeToString()
                    DirectAI.parseTranscript(DirectAI.extractGeminiText(reply))
                }
                AIProviderKind.OPENAI -> {
                    val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
                        .addFormDataPart("file", "speech.wav", wav.toRequestBody(WAV))
                        .addFormDataPart("model", "whisper-1")
                        .build()
                    val request = Request.Builder()
                        .url(DirectAI.openAITranscriptionsURL(resolved.baseURL))
                        .header("Authorization", "Bearer ${resolved.apiKey}")
                        .post(multipart)
                        .build()
                    val reply = executeDirect(request, model = "whisper-1", maxBytes = 64 * 1024).decodeToString()
                    DirectAI.parseTranscript(reply)
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: PracticeNetworkException) {
            throw error
        } catch (_: Exception) {
            throw PracticeNetworkException.invalidReply("没能听清楚，请再说一次或打字输入。")
        }
    }

    private fun validatePracticeRequest(body: AIPracticeRequest) {
        val last = body.messages.lastOrNull()
        if (body.action == AIPracticeAction.START && (body.messages.isNotEmpty() || body.stepIndex != 0)) {
            throw PracticeNetworkException.invalidReply()
        }
        if (body.action == AIPracticeAction.ANSWER && (last == null || last.role != PracticeMessage.Role.USER || last.stepIndex != body.stepIndex)) {
            throw PracticeNetworkException.invalidReply()
        }
        if (body.action == AIPracticeAction.ADVANCE && (last == null || body.stepIndex == 0)) {
            throw PracticeNetworkException.invalidReply()
        }
        if (body.messages.any { it.stepIndex > body.stepIndex }) {
            throw PracticeNetworkException.invalidReply()
        }
    }

    private suspend fun <T> generateStructured(
        systemInstruction: String,
        responseSchema: JsonObject,
        jsonContract: String,
        payload: JsonObject,
        retryPayload: JsonObject,
        temperature: Double,
        maxOutputTokens: Int,
        invalidMessage: String,
        maxResponseBytes: Int = 128 * 1024,
        parse: (String) -> T,
    ): Pair<String, T> {
        val resolved = requireTextProvider()
        val model = resolved.textModel
        for (attempt in 0..1) {
            val currentPayload = (if (attempt == 0) payload else retryPayload).toString()
            val currentTemp = if (attempt == 0) temperature else 0.2
            val rawText = when (resolved.provider) {
                AIProviderKind.GEMINI -> {
                    val body = DirectAI.buildGeminiGenerateContentBody(
                        model = model,
                        systemInstruction = systemInstruction,
                        userPayloadJson = currentPayload,
                        responseSchema = responseSchema,
                        temperature = currentTemp,
                        maxOutputTokens = maxOutputTokens,
                    ).toRequestBody(JSON)
                    val request = Request.Builder()
                        .url(DirectAI.geminiGenerateContentURL(resolved.baseURL, model))
                        .header("x-goog-api-key", resolved.apiKey)
                        .post(body)
                        .build()
                    val responseBytes = executeDirect(request, model = model, maxBytes = maxResponseBytes)
                    DirectAI.extractGeminiText(responseBytes.decodeToString())
                }
                AIProviderKind.OPENAI -> {
                    val body = DirectAI.buildOpenAIChatCompletionBody(
                        model = model,
                        systemInstruction = systemInstruction,
                        jsonContract = jsonContract,
                        userPayloadJson = currentPayload,
                        temperature = currentTemp,
                    ).toRequestBody(JSON)
                    val request = Request.Builder()
                        .url(DirectAI.openAIChatCompletionsURL(resolved.baseURL))
                        .header("Authorization", "Bearer ${resolved.apiKey}")
                        .post(body)
                        .build()
                    val responseBytes = executeDirect(request, model = model, maxBytes = maxResponseBytes)
                    DirectAI.extractOpenAIText(responseBytes.decodeToString())
                }
            }
            val parsed = try {
                parse(rawText)
            } catch (_: Exception) {
                if (attempt == 0) continue
                throw PracticeNetworkException.invalidReply(invalidMessage)
            }
            return model to parsed
        }
        throw PracticeNetworkException.invalidReply(invalidMessage)
    }

    private suspend fun executeDirect(request: Request, model: String?, maxBytes: Int): ByteArray {
        val result = try {
            http.newCall(request).await(maxBytes)
        } catch (error: CancellationException) {
            throw error
        } catch (_: IOException) {
            throw PracticeNetworkException.unavailable()
        }
        val bytes = result.body ?: throw PracticeNetworkException.invalidReply()
        if (result.code in 200..299) return bytes
        throw DirectAI.mapHttpError(result.code, model, bytes.take(4096).toByteArray().decodeToString())
    }

    private fun <T> encode(serializer: SerializationStrategy<T>, value: T): String = AppJson.encodeToString(serializer, value)

    private fun <R> decode(reply: DeserializationStrategy<R>, bytes: ByteArray): R = try {
        AppJson.decodeFromString(reply, bytes.decodeToString())
    } catch (_: SerializationException) {
        throw PracticeNetworkException.invalidReply()
    }

    private suspend fun <R> sendLingDaily(
        path: String,
        body: String?,
        reply: DeserializationStrategy<R>,
        bearer: String?,
        maxBytes: Int = 24 * 1024,
        client: OkHttpClient = http,
    ): R = decode(reply, sendLingDailyBytes(path, body?.toRequestBody(JSON), bearer, maxBytes, client))

    private suspend fun sendLingDailyBytes(
        path: String,
        body: RequestBody?,
        bearer: String?,
        maxBytes: Int,
        client: OkHttpClient = http,
    ): ByteArray {
        val request = Request.Builder().url("$baseURL/$path").apply {
            if (bearer != null) header("Authorization", "Bearer $bearer")
            if (body != null) post(body) else get()
        }.build()
        val result = try {
            client.newCall(request).await(maxBytes)
        } catch (error: CancellationException) {
            throw error
        } catch (_: IOException) {
            throw PracticeNetworkException.unavailable()
        }
        val bytes = result.body ?: throw PracticeNetworkException.invalidReply()
        if (result.code == 200) return bytes
        if (result.code == 401 && bearer != null) {
            // The production session expired or was rejected: sign out on this device.
            onSessionRejected()
            throw PracticeNetworkException.signedOut()
        }
        val failure = try {
            AppJson.decodeFromString(ServerFailure.serializer(), bytes.decodeToString())
        } catch (_: SerializationException) {
            null
        }
        if (failure != null && failure.message.isNotBlank() && failure.message.length <= 200) {
            throw PracticeNetworkException.server(failure.message)
        }
        throw PracticeNetworkException.unavailable()
    }

    /** Status and body; the body is null when it is larger than the caller allows. */
    private class Reply(val code: Int, val body: ByteArray?)

    private suspend fun Call.await(maxBytes: Int): Reply = suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                val reply = try {
                    response.use {
                        val source = it.body.source()
                        val tooLarge = source.request(maxBytes + 1L)
                        Reply(it.code, if (tooLarge) null else source.readByteArray())
                    }
                } catch (error: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(error)
                    return
                }
                if (continuation.isActive) continuation.resume(reply)
            }
        })
    }

    companion object {
        private val JSON = "application/json".toMediaType()
        private val WAV = "audio/wav".toMediaType()

        private fun client(callTimeoutSeconds: Long): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(45, TimeUnit.SECONDS)
            .callTimeout(callTimeoutSeconds, TimeUnit.SECONDS)
            // A redirect could carry the session token or an API key to another origin.
            .followRedirects(false)
            .followSslRedirects(false)
            .build()

        /** Shared by every client so requests reuse warm connections (and TLS sessions) to the server. */
        val sharedClient: OkHttpClient by lazy { client(55) }

        /**
         * Sync uploads the local archive and downloads the cloud copy; both can be large
         * on a slow uplink, so only the overall limit is longer. Shares the connection pool.
         */
        val sharedSyncClient: OkHttpClient by lazy {
            sharedClient.newBuilder().callTimeout(120, TimeUnit.SECONDS).build()
        }
    }
}
