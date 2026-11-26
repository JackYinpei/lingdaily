package com.qcy.lingdaily.core.network

import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import com.qcy.lingdaily.core.realtime.LiveCodec
import com.qcy.lingdaily.core.realtime.LiveConnectionConfig
import com.qcy.lingdaily.core.realtime.LiveEvent
import com.qcy.lingdaily.core.realtime.LiveInputGate
import com.qcy.lingdaily.core.realtime.LiveProtocolException
import com.qcy.lingdaily.core.realtime.LiveUploadBatch
import com.qcy.lingdaily.core.realtime.OpenAIRealtimeCodec
import com.qcy.lingdaily.core.realtime.Pcm16Resampler16To24

/**
 * One socket, one upload pump, supporting both Google Gemini Live and OpenAI Realtime.
 * The URL (it can carry the API key) never escapes this boundary.
 * Every late callback carries its connection generation, so an old socket can never
 * affect a new call. Events are delivered in order on `deliverOn`.
 */
class LiveWebSocketClient(
    /** Where events and failures are delivered; the app passes the main thread. */
    private val deliverOn: Executor,
    private val http: OkHttpClient = defaultClient,
) {
    data class FailureDiagnostics(val stage: String, val closeCode: Int = 0, val transport: Transport? = null) {
        val message: String
            get() = when {
                closeCode == 401 || closeCode == 403 ->
                    "语音接口认证失败（$closeCode），请检查 API Key 和模型权限。已有内容已保留。"
                closeCode == 404 ->
                    "找不到实时语音模型或接口地址（404），请检查接口设置。已有内容已保留。"
                stage == "setupTimeout" || transport == Transport.TIMEOUT ->
                    "手机连接语音服务超时，请检查网络或接口地址后重新连接。已有内容已保留。"
                transport == Transport.UNREACHABLE ->
                    "手机与语音服务的网络连接已断开，请检查网络后重试。已有内容已保留。"
                closeCode > 0 -> "语音服务已关闭连接（$closeCode），请重新连接。已有内容已保留。"
                stage == "protocol" -> "语音服务返回了无法处理的消息，请检查实时语音模型设置后重新连接。已有内容已保留。"
                else -> "语音连接已断开，请重新连接。已有内容已保留。"
            }
    }

    enum class Transport { TIMEOUT, UNREACHABLE }

    data class UploadStatistics(val sentFrames: Int, val droppedFrames: Int)

    private val lock = Any()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var socket: WebSocket? = null
    private var activeProvider: AIProviderKind = AIProviderKind.GEMINI
    private var generation = 0L
    private var ready = false
    private val inputGate = LiveInputGate()
    private val resampler = Pcm16Resampler16To24()
    private val seenTools = mutableSetOf<String>()
    private val openAICallNames = mutableMapOf<String, String>()
    private var sentAudioFrames = 0
    private var droppedAudioFrames = 0
    private var uploader: Job? = null
    private var timeout: Job? = null
    private var handler: ((LiveEvent, Long) -> Unit)? = null
    private var failure: ((Long, FailureDiagnostics) -> Unit)? = null

    fun connect(
        config: LiveConnectionConfig,
        generation: Long,
        handler: (LiveEvent, Long) -> Unit,
        failure: (Long, FailureDiagnostics) -> Unit,
    ) {
        val url = config.webSocketURL()
        val request = Request.Builder().url(url).apply {
            if (config.provider == AIProviderKind.OPENAI) {
                header("Authorization", "Bearer ${config.apiKey.trim()}")
            }
        }.build()
        synchronized(lock) {
            if (generation < this.generation) throw CancellationException("A newer call replaced this one")
            reset()
            this.generation = generation
            this.activeProvider = config.provider
            this.handler = handler
            this.failure = failure
            socket = http.newWebSocket(request, Listener(generation, config))
            timeout = scope.launch {
                delay(SETUP_TIMEOUT_MS)
                val waiting = synchronized(lock) { this@LiveWebSocketClient.generation == generation && !ready }
                if (waiting) fail(generation, "setupTimeout")
            }
        }
    }

    private inner class Listener(
        private val current: Long,
        private val config: LiveConnectionConfig,
    ) : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            try {
                val frame = when (config.provider) {
                    AIProviderKind.GEMINI -> LiveCodec.setup(
                        model = config.model,
                        systemInstruction = config.systemInstruction,
                        voiceName = config.geminiVoice,
                        pauseMs = config.pauseMs,
                    )
                    AIProviderKind.OPENAI -> OpenAIRealtimeCodec.sessionUpdate(
                        instructions = config.systemInstruction,
                        voice = config.openAIVoice,
                        pauseMs = config.pauseMs,
                    )
                }
                synchronized(lock) {
                    if (generation == current && socket === webSocket) webSocket.send(frame)
                }
            } catch (_: LiveProtocolException) {
                fail(current, "protocol")
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) = receive(webSocket, current, text)

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            if (bytes.size > LiveCodec.MAX_MESSAGE_BYTES) fail(current, "protocol") else receive(webSocket, current, bytes.utf8())
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, null)
            fail(current, "receive", closeCode = code)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = fail(current, "receive", closeCode = code)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            val transport = when {
                response != null -> null
                t is SocketTimeoutException || (t is InterruptedIOException && t.message == "timeout") -> Transport.TIMEOUT
                t is java.io.IOException -> Transport.UNREACHABLE
                else -> null
            }
            // A refused handshake (for example a rejected key or model) reports its HTTP status.
            fail(current, "receive", closeCode = response?.code ?: 0, transport = transport)
        }
    }

    private fun receive(source: WebSocket, current: Long, message: String) {
        val events = mutableListOf<LiveEvent>()
        val callback: ((LiveEvent, Long) -> Unit)?
        try {
            synchronized(lock) {
                if (generation != current || socket !== source) return
                callback = handler
                val parsed = when (activeProvider) {
                    AIProviderKind.GEMINI -> LiveCodec.parse(message)
                    AIProviderKind.OPENAI -> OpenAIRealtimeCodec.parse(message, openAICallNames)
                }
                for (event in parsed) {
                    when (event) {
                        is LiveEvent.SetupComplete -> {
                            if (ready) continue
                            ready = true
                            inputGate.open()
                            timeout?.cancel()
                        }
                        is LiveEvent.Tool -> {
                            val accepted = event.call.validated() != null
                            val duplicate = event.call.id in seenTools
                            if (seenTools.size >= 512) throw LiveProtocolException.overloaded()
                            // Acknowledge BEFORE scheduling any UI or persistence work.
                            val ack = when (activeProvider) {
                                AIProviderKind.GEMINI -> LiveCodec.toolResponse(event.call, accepted)
                                AIProviderKind.OPENAI -> OpenAIRealtimeCodec.toolResponse(event.call, accepted)
                            }
                            source.send(ack)
                            if (!accepted || duplicate) continue
                            seenTools += event.call.id
                        }
                        is LiveEvent.RequestContinuation -> {
                            if (activeProvider == AIProviderKind.OPENAI) {
                                source.send(OpenAIRealtimeCodec.responseCreate())
                            }
                            continue
                        }
                        else -> Unit
                    }
                    events += event
                }
            }
        } catch (_: LiveProtocolException) {
            fail(current, "protocol")
            return
        }
        if (callback != null) for (event in events) deliverOn.execute { callback(event, current) }
    }

    /**
     * Starts sending microphone frames. `setupComplete` opened the input once; a mute
     * that happened before this pump starts stays closed rather than being undone here.
     */
    fun startUpload(generation: Long, nextFrame: () -> ByteArray?) {
        synchronized(lock) {
            if (!ready || generation != this.generation || uploader != null) return
            uploader = scope.launch {
                while (isActive) {
                    val (epoch, batch) = synchronized(lock) {
                        if (!ready || this@LiveWebSocketClient.generation != generation) return@launch
                        inputGate.generation to if (inputGate.isOpen) LiveUploadBatch.take(nextFrame = nextFrame) else emptyList()
                    }
                    for ((pcm, frames) in LiveUploadBatch.messages(batch)) upload(pcm, frames, generation, epoch)
                    delay(UPLOAD_INTERVAL_MS)
                }
            }
        }
    }

    private fun upload(pcm: ByteArray, frames: Int, current: Long, epoch: Long) {
        synchronized(lock) {
            val socket = socket ?: return
            if (!ready || generation != current || !inputGate.accepts(epoch)) return
            // On a stalled uplink audio is dropped, never queued without bound; control messages still go out.
            if (socket.queueSize() > MAX_QUEUED_AUDIO_BYTES) {
                droppedAudioFrames += frames
                return
            }
            val payload = when (activeProvider) {
                AIProviderKind.GEMINI -> LiveCodec.audio(pcm)
                AIProviderKind.OPENAI -> OpenAIRealtimeCodec.audioAppend(resampler.resample(pcm))
            }
            if (socket.send(payload)) sentAudioFrames += frames
        }
    }

    fun endInput(generation: Long) {
        synchronized(lock) {
            if (!ready || generation != this.generation) return
            inputGate.close()
            resampler.reset()
            // OpenAI server_vad rejects empty input_audio_buffer.commit; only Gemini uses audioStreamEnd.
            if (activeProvider == AIProviderKind.GEMINI) {
                socket?.send(LiveCodec.audioEnd())
            }
        }
    }

    fun resumeInput(generation: Long) {
        synchronized(lock) {
            if (ready && generation == this.generation && !inputGate.isOpen) {
                resampler.reset()
                inputGate.open()
            }
        }
    }

    fun cancelResponse(generation: Long) {
        synchronized(lock) {
            if (!ready || generation != this.generation) return
            if (activeProvider == AIProviderKind.OPENAI) {
                socket?.send(OpenAIRealtimeCodec.responseCancel())
            }
        }
    }

    fun sendText(text: String, generation: Long) {
        synchronized(lock) {
            val socket = socket
            if (!ready || generation != this.generation || socket == null) {
                throw LiveProtocolException.invalid()
            }
            val messages = when (activeProvider) {
                AIProviderKind.GEMINI -> listOf(LiveCodec.text(text))
                AIProviderKind.OPENAI -> OpenAIRealtimeCodec.textMessages(text)
            }
            for (frame in messages) {
                if (!socket.send(frame)) throw LiveProtocolException.invalid()
            }
        }
    }

    fun uploadStatistics(): UploadStatistics = synchronized(lock) { UploadStatistics(sentAudioFrames, droppedAudioFrames) }

    fun close(expectedGeneration: Long? = null) {
        synchronized(lock) {
            if (expectedGeneration != null && expectedGeneration != generation) return
            generation++
            reset()
        }
    }

    private fun fail(current: Long, stage: String, closeCode: Int = 0, transport: Transport? = null) {
        val callback: ((Long, FailureDiagnostics) -> Unit)?
        synchronized(lock) {
            if (generation != current) return
            callback = failure
            generation++
            reset()
        }
        if (callback != null) deliverOn.execute { callback(current, FailureDiagnostics(stage, closeCode, transport)) }
    }

    private fun reset() {
        ready = false
        inputGate.close()
        resampler.reset()
        uploader?.cancel()
        timeout?.cancel()
        uploader = null
        timeout = null
        socket?.close(1000, null)
        socket = null
        handler = null
        failure = null
        seenTools.clear()
        openAICallNames.clear()
        sentAudioFrames = 0
        droppedAudioFrames = 0
    }

    companion object {
        private const val SETUP_TIMEOUT_MS = 20_000L
        private const val UPLOAD_INTERVAL_MS = 20L
        /** About one second of base64 microphone audio. */
        private const val MAX_QUEUED_AUDIO_BYTES = 64 * 1024L

        /**
         * While muted and the partner is silent nothing moves on the socket, and carrier
         * middleboxes treat that as dead. A ping every 10 s keeps it open.
         */
        val defaultClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .pingInterval(10, TimeUnit.SECONDS)
                .followRedirects(false)
                .followSslRedirects(false)
                .build()
        }
    }
}
