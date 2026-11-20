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
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import com.qcy.lingdaily.core.model.AIPracticeRequest
import com.qcy.lingdaily.core.model.AIPracticeResponse
import com.qcy.lingdaily.core.model.AIScenarioRequest
import com.qcy.lingdaily.core.model.AIScenarioResponse
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.ScenarioCatalogResponse
import com.qcy.lingdaily.core.model.SentenceReviewRecord
import com.qcy.lingdaily.core.model.SentenceReviewRequest
import com.qcy.lingdaily.core.model.SentenceReviewResponse
import com.qcy.lingdaily.core.model.TodayEpisode
import com.qcy.lingdaily.core.model.TodayResponse
import com.qcy.lingdaily.core.model.Uuid
import com.qcy.lingdaily.core.model.prefix
import com.qcy.lingdaily.core.persistence.SyncChanges
import com.qcy.lingdaily.core.persistence.SyncSnapshot
import com.qcy.lingdaily.core.realtime.AIUsageSummary
import com.qcy.lingdaily.core.realtime.LivePause
import com.qcy.lingdaily.core.realtime.LiveSuggestion
import com.qcy.lingdaily.core.realtime.LiveSuggestionRequest
import com.qcy.lingdaily.core.realtime.LiveToken
import com.qcy.lingdaily.core.realtime.LiveTokenRequest
import com.qcy.lingdaily.core.realtime.LiveUsageReport

class PracticeNetworkException(val kind: Kind, message: String) : Exception(message) {
    enum class Kind { NOT_CONFIGURED, SIGNED_OUT, AI_CONSENT_REQUIRED, INVALID_REPLY, UNAVAILABLE, SERVER }

    companion object {
        fun notConfigured() = PracticeNetworkException(Kind.NOT_CONFIGURED,
            "本机开发服务配置无效。请重新运行 npm run ios:dev 和 adb reverse tcp:8000 tcp:8000，再重新安装 Debug 版。")
        fun signedOut() = PracticeNetworkException(Kind.SIGNED_OUT, "请先在「我的」登录，再开始对话。")
        fun aiConsentRequired() = PracticeNetworkException(Kind.AI_CONSENT_REQUIRED,
            "请先阅读并允许 AI 数据使用，再重试。也可以继续查看已有记录。")
        fun invalidReply() = PracticeNetworkException(Kind.INVALID_REPLY, "AI 回复不完整，请重试。你的回答已保留。")
        fun unavailable() = PracticeNetworkException(Kind.UNAVAILABLE, "暂时连不上服务，请检查网络后重试。")
        fun server(message: String) = PracticeNetworkException(Kind.SERVER, message)
    }
}

/** Production service. All AI calls go through it after signing in. */
object LingDailyService {
    const val BASE_URL = "https://lingdaily.yasobi.xyz"
}

/** The AI calls practice features make; screens and controllers take one injected instance. */
interface PracticeServing {
    suspend fun respond(request: AIPracticeRequest): AIPracticeResponse
    suspend fun reviewSentences(request: SentenceReviewRequest): List<SentenceReviewRecord>
    suspend fun createScenario(description: String): PracticeScenario
    suspend fun translate(text: String): String
    suspend fun suggest(session: PracticeSession): LiveSuggestion
    suspend fun liveToken(session: PracticeSession): LiveToken
    suspend fun scenarioIdeas(avoiding: List<String>): List<String>
    suspend fun reportLiveUsage(report: LiveUsageReport)
    suspend fun usageSummary(): AIUsageSummary
    suspend fun modelCatalog(): AIModelCatalog

    /** One line read aloud, as MP3, in the partner's voice when a partner is named. */
    suspend fun speech(text: String, partner: String?): ByteArray

    /** The words in a short WAV recording (16 kHz mono PCM16); empty when nothing was said. */
    suspend fun transcribe(wav: ByteArray): String
}

@Serializable
private data class ServerFailure(val message: String)

@Serializable
private data class TranslateRequest(val requestId: Uuid, val text: String, val model: String? = null)

@Serializable
private data class TranslateResponse(val requestId: Uuid, val translation: String)

@Serializable
private data class SuggestResponse(val requestId: Uuid, val suggestion: LiveSuggestion)

@Serializable
private data class IdeasRequest(val requestId: Uuid, val avoid: List<String>)

@Serializable
private data class IdeasResponse(val requestId: Uuid, val ideas: List<String>)

@Serializable
private data class Recorded(val recorded: Boolean)

@Serializable
private data class SpeechRequest(val text: String, val partner: String? = null)

@Serializable
private data class Transcript(val text: String)

@Serializable
private data class PodcastList(val episodes: List<TodayEpisode> = emptyList())

@Serializable
private data class Deleted(val deleted: Boolean)

class PracticeApiClient(
    /** Debug-only local pairing from `npm run ios:dev`; null means the production service. */
    val configuration: DevConnection? = null,
    private val accountSession: () -> AccountSession? = { null },
    private val aiConsent: () -> Boolean = { false },
    private val modelPreference: (AIModelFeature) -> String? = { null },
    private val pauseMs: () -> Int = { LivePause.STANDARD },
    /** The production service rejected the stored session: the device signs out. */
    private val onSessionRejected: () -> Unit = {},
    /** An AI call was attempted without permission: the app offers the consent page. */
    private val onConsentRequired: () -> Unit = {},
    private val baseURL: String = LingDailyService.BASE_URL,
    private val http: OkHttpClient = sharedClient,
    private val syncHttp: OkHttpClient = sharedSyncClient,
) : PracticeServing {

    /** True when this build talks to a local development server and needs no account. */
    val usesLocalDevelopment: Boolean get() = configuration != null

    /** Exchanges the account's email and password for a LingDaily app session. */
    suspend fun signIn(email: String, password: String): AccountSession {
        val response = send("api/android/auth/password", encode(PasswordCredentials.serializer(), PasswordCredentials(email, password)),
            AccountSignInResponse.serializer(), baseURL, bearer = null)
        return response.session() ?: throw PracticeNetworkException.invalidReply()
    }

    /** Creates an account. Null means the address must be confirmed by email before signing in. */
    suspend fun register(email: String, password: String): AccountSession? {
        val response = send("api/android/auth/register", encode(PasswordCredentials.serializer(), PasswordCredentials(email, password)),
            AccountSignInResponse.serializer(), baseURL, bearer = null)
        if (response.confirmationRequired) return null
        return response.session() ?: throw PracticeNetworkException.invalidReply()
    }

    /** Uploads pending local changes and returns the account's cloud copy. */
    suspend fun sync(changes: SyncChanges): SyncSnapshot {
        if (configuration != null) throw PracticeNetworkException.notConfigured()
        val account = accountSession()?.takeIf { it.isUsable() } ?: throw PracticeNetworkException.signedOut()
        return send("api/ios/sync", encode(SyncChanges.serializer(), changes), SyncSnapshot.serializer(), baseURL,
            bearer = account.token, maxBytes = 64 * 1024 * 1024, client = syncHttp)
    }

    /** Permanently deletes the account and its cloud data (web and iOS data included). */
    suspend fun deleteAccount(password: String) {
        val account = accountSession()?.takeIf { it.isUsable() } ?: throw PracticeNetworkException.signedOut()
        val result = send("api/android/account/delete", encode(PasswordConfirmation.serializer(), PasswordConfirmation(password)),
            Deleted.serializer(), baseURL, bearer = account.token)
        if (!result.deleted) throw PracticeNetworkException.invalidReply()
    }

    override suspend fun respond(request: AIPracticeRequest): AIPracticeResponse {
        val body = request.copy(model = modelPreference(AIModelFeature.PRACTICE))
        val result = post("api/ios/practice", encode(AIPracticeRequest.serializer(), body), AIPracticeResponse.serializer())
        if (result.requestId != body.requestId || !result.data.isValid(body.action)) throw PracticeNetworkException.invalidReply()
        return result
    }

    override suspend fun reviewSentences(request: SentenceReviewRequest): List<SentenceReviewRecord> {
        val body = request.copy(model = modelPreference(AIModelFeature.PRACTICE))
        val result = post("api/ios/review", encode(SentenceReviewRequest.serializer(), body),
            SentenceReviewResponse.serializer(), maxBytes = 256 * 1024)
        return result.records(body) ?: throw PracticeNetworkException.invalidReply()
    }

    /** Generates a three-step scenario from the learner's own description of an upcoming conversation. */
    override suspend fun createScenario(description: String): PracticeScenario {
        val body = AIScenarioRequest(UUID.randomUUID(), description.prefix(300))
        val result = post("api/ios/scenario", encode(AIScenarioRequest.serializer(), body), AIScenarioResponse.serializer())
        if (result.requestId != body.requestId) throw PracticeNetworkException.invalidReply()
        return result.makeScenario() ?: throw PracticeNetworkException.invalidReply()
    }

    /** Chinese gloss for one partner line, fetched when the learner taps 中文. */
    override suspend fun translate(text: String): String {
        val body = TranslateRequest(UUID.randomUUID(), text.trim().prefix(1000), modelPreference(AIModelFeature.TRANSLATE))
        val result = post("api/ios/translate", encode(TranslateRequest.serializer(), body), TranslateResponse.serializer())
        if (result.requestId != body.requestId || result.translation.isEmpty()) throw PracticeNetworkException.invalidReply()
        return result.translation
    }

    /** Chinese-first reply idea for the learner's next line in a Live call. */
    override suspend fun suggest(session: PracticeSession): LiveSuggestion {
        val body = LiveSuggestionRequest.from(session)?.copy(model = modelPreference(AIModelFeature.SUGGEST))
            ?: throw PracticeNetworkException.invalidReply()
        val result = post("api/ios/suggest", encode(LiveSuggestionRequest.serializer(), body), SuggestResponse.serializer())
        if (result.requestId != body.requestId || result.suggestion.hint.isEmpty()) throw PracticeNetworkException.invalidReply()
        return result.suggestion
    }

    override suspend fun liveToken(session: PracticeSession): LiveToken {
        val body = LiveTokenRequest.from(session).copy(model = modelPreference(AIModelFeature.LIVE), pauseMs = LivePause.valid(pauseMs()))
        return post("api/ios/live-token", encode(LiveTokenRequest.serializer(), body), LiveToken.serializer())
    }

    /** "换一批": three fresh one-line scenario ideas, avoiding ones already shown. */
    override suspend fun scenarioIdeas(avoiding: List<String>): List<String> {
        val body = IdeasRequest(UUID.randomUUID(), avoiding.takeLast(30).map { it.prefix(120) })
        val result = post("api/ios/scenario-ideas", encode(IdeasRequest.serializer(), body), IdeasResponse.serializer())
        if (result.requestId != body.requestId || result.ideas.size != 3) throw PracticeNetworkException.invalidReply()
        return result.ideas
    }

    /** Token usage of one Live connection, summed on device. */
    override suspend fun reportLiveUsage(report: LiveUsageReport) {
        post("api/ios/usage", encode(LiveUsageReport.serializer(), report), Recorded.serializer())
    }

    /** The learner's own token usage over the last 30 days. */
    override suspend fun usageSummary(): AIUsageSummary = post("api/ios/usage", null, AIUsageSummary.serializer())

    /** Models the learner may choose per feature. */
    override suspend fun modelCatalog(): AIModelCatalog = post("api/ios/models", null, AIModelCatalog.serializer())

    override suspend fun speech(text: String, partner: String?): ByteArray {
        val body = encode(SpeechRequest.serializer(), SpeechRequest(text.trim().prefix(1000), partner?.trim()?.prefix(60)?.ifEmpty { null }))
        return postBytes("api/ios/speech", body.toRequestBody(JSON), maxBytes = 2 * 1024 * 1024)
    }

    override suspend fun transcribe(wav: ByteArray): String {
        val bytes = postBytes("api/ios/transcribe", wav.toRequestBody(WAV), maxBytes = 24 * 1024)
        return try {
            AppJson.decodeFromString(Transcript.serializer(), bytes.decodeToString()).text.trim()
        } catch (_: SerializationException) {
            throw PracticeNetworkException.invalidReply()
        }
    }

    /** Recent daily podcasts, newest first. Public like the web's podcast page. */
    suspend fun podcasts(): List<TodayEpisode> =
        post("api/ios/podcasts", null, PodcastList.serializer(), maxBytes = 512 * 1024, requiresAccount = false).episodes

    /** Built-in scenarios. Public editorial content, so it also loads before signing in. */
    suspend fun scenarioCatalog(): List<PracticeScenario> {
        val response = post("api/ios/scenarios", null, ScenarioCatalogResponse.serializer(), maxBytes = 512 * 1024, requiresAccount = false)
        return response.validScenarios.ifEmpty { throw PracticeNetworkException.invalidReply() }
    }

    /** The latest daily podcast and a rehearsal about it; null when there is no recent episode. */
    suspend fun today(): TodayEpisode? = post("api/ios/today", null, TodayResponse.serializer(), maxBytes = 128 * 1024).today

    private fun <T> encode(serializer: SerializationStrategy<T>, value: T): String = AppJson.encodeToString(serializer, value)

    /** `body` null sends a GET. */
    private suspend fun <R> post(path: String, body: String?, reply: DeserializationStrategy<R>,
                                 maxBytes: Int = 24 * 1024, requiresAccount: Boolean = true): R {
        val bytes = postBytes(path, body?.toRequestBody(JSON), maxBytes, requiresAccount)
        return decode(reply, bytes)
    }

    /** The development pairing when this build has one, else the signed-in account, else (public routes) nobody. */
    private suspend fun postBytes(path: String, body: RequestBody?, maxBytes: Int, requiresAccount: Boolean = true): ByteArray {
        configuration?.let { config ->
            if (!config.isValid) throw PracticeNetworkException.notConfigured()
            return send(path, body, config.baseURL.removeSuffix("/"), config.accessToken, maxBytes)
        }
        if (!requiresAccount) return send(path, body, baseURL, bearer = null, maxBytes = maxBytes)
        val account = accountSession()?.takeIf { it.isUsable() } ?: throw PracticeNetworkException.signedOut()
        return send(path, body, baseURL, account.token, maxBytes)
    }

    private fun <R> decode(reply: DeserializationStrategy<R>, bytes: ByteArray): R = try {
        AppJson.decodeFromString(reply, bytes.decodeToString())
    } catch (_: SerializationException) {
        throw PracticeNetworkException.invalidReply()
    }

    private suspend fun <R> send(path: String, body: String?, reply: DeserializationStrategy<R>, baseURL: String,
                                 bearer: String?, maxBytes: Int = 24 * 1024, client: OkHttpClient = http): R =
        decode(reply, send(path, body?.toRequestBody(JSON), baseURL, bearer, maxBytes, client))

    private suspend fun send(path: String, body: RequestBody?, baseURL: String, bearer: String?,
                             maxBytes: Int, client: OkHttpClient = http): ByteArray {
        // Account, sync, usage and model-list requests do not send content to Gemini.
        if (path in AI_PATHS && !aiConsent()) {
            onConsentRequired()
            throw PracticeNetworkException.aiConsentRequired()
        }
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
        if (result.code == 401 && configuration == null && bearer != null) {
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
        private val AI_PATHS = setOf("api/ios/practice", "api/ios/review", "api/ios/scenario", "api/ios/scenario-ideas",
            "api/ios/translate", "api/ios/suggest", "api/ios/live-token", "api/ios/speech", "api/ios/transcribe")

        private fun client(callTimeoutSeconds: Long): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(35, TimeUnit.SECONDS)
            .writeTimeout(35, TimeUnit.SECONDS)
            .callTimeout(callTimeoutSeconds, TimeUnit.SECONDS)
            // A redirect could carry the session or pairing token to another origin.
            .followRedirects(false)
            .followSslRedirects(false)
            .build()

        /** Shared by every client so requests reuse warm connections (and TLS sessions) to the server. */
        val sharedClient: OkHttpClient by lazy { client(40) }

        /**
         * Sync uploads the local archive and downloads the cloud copy; both can be large
         * on a slow uplink, so only the overall limit is longer. Shares the connection pool.
         */
        val sharedSyncClient: OkHttpClient by lazy {
            sharedClient.newBuilder().callTimeout(120, TimeUnit.SECONDS).build()
        }
    }
}
