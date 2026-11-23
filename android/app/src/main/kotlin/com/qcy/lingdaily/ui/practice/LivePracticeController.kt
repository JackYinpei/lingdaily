package com.qcy.lingdaily.ui.practice

import android.Manifest
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import com.qcy.lingdaily.app.AppContainer
import com.qcy.lingdaily.app.LiveCallService
import com.qcy.lingdaily.core.audio.LiveAudioController
import com.qcy.lingdaily.core.model.PracticeMessage
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.network.LiveWebSocketClient
import com.qcy.lingdaily.core.network.PracticeNetworkException
import com.qcy.lingdaily.core.realtime.LiveEvent
import com.qcy.lingdaily.core.realtime.LiveGenerations
import com.qcy.lingdaily.core.realtime.LiveKickoff
import com.qcy.lingdaily.core.realtime.LivePendingTools
import com.qcy.lingdaily.core.realtime.LiveProtocolException
import com.qcy.lingdaily.core.realtime.LiveStuckPolicy
import com.qcy.lingdaily.core.realtime.LiveSuggestion
import com.qcy.lingdaily.core.realtime.LiveTranscriptReducer
import com.qcy.lingdaily.core.realtime.LiveUsage
import com.qcy.lingdaily.core.realtime.LiveUsageReport

/**
 * One Gemini Live call for the rehearsal on screen: connection, audio, subtitles, the
 * model's tool calls and the "stuck?" help. Used on the main thread. Everything that can
 * arrive late (socket events, audio callbacks, timers) carries the connection generation
 * it belongs to and is ignored once the call has ended or been replaced.
 */
class LivePracticeController(private val app: AppContainer) {
    enum class State { DISCONNECTED, CONNECTING, ACTIVE }

    var state by mutableStateOf(State.DISCONNECTED)
        private set
    var muted by mutableStateOf(false)
        private set

    /** The partner plays through the phone itself, so talking over them needs 打断. */
    var usesSpeaker by mutableStateOf(false)
        private set
    var playing by mutableStateOf(false)
        private set
    /** The partner's current turn has been fully transcribed (its subtitle will not change). */
    var turnFinished by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set
    var hasStarted by mutableStateOf(false)
        private set

    /** Reply idea shown when the learner seems stuck (or asks for help). */
    var suggestion by mutableStateOf<LiveSuggestion?>(null)
        private set
    var suggesting by mutableStateOf(false)
        private set
    var suggestionError by mutableStateOf<String?>(null)
        private set

    /** The call has its foreground service, so leaving the app does not have to end it. */
    var continuesInBackground = false
        private set

    private val api = app.api
    private val store = app.store
    private val scope = app.scope
    private val audio = LiveAudioController(app.context)
    private val client = LiveWebSocketClient(ContextCompat.getMainExecutor(app.context))
    private val generations = LiveGenerations()
    private val transcript = LiveTranscriptReducer()
    private val pendingTools = LivePendingTools()
    private val cancelledTools = mutableSetOf<String>()
    private var model: PracticeViewModel? = null
    private var connectJob: Job? = null
    private var pendingSave: Job? = null
    private var stuckJob: Job? = null

    /** Idea generated in the background as soon as the partner finishes a line. */
    private var prefetched: Pair<UUID?, Deferred<LiveSuggestion?>>? = null
    private var suggestedLine: UUID? = null

    /** Token usage of the current connection, reported once at hang-up (the audio never passes our server). */
    private var usage = LiveUsage()
    private var usageModel: String? = null
    private var usageReportID = UUID.randomUUID()

    /** After 打断, the rest of the partner's current reply is dropped until the server ends that turn. */
    private var discardingPartnerTurn = false

    val status: String
        get() = when (state) {
            State.CONNECTING -> "连接中"
            State.DISCONNECTED -> if (hasStarted) "已断开" else ""
            State.ACTIVE -> when {
                playing -> "${model?.session?.scenario?.partner ?: "对方"} 正在说"
                muted -> "麦克风已静音"
                else -> "在听"
            }
        }

    private fun moveTo(next: State) {
        state = next
        // Cloud sync holds its uploads while a call needs the bandwidth.
        app.sync.liveCallChanged(next != State.DISCONNECTED)
    }

    fun start(model: PracticeViewModel) {
        if (state != State.DISCONNECTED || model.session.phase == PracticeSession.Phase.COMPLETED) return
        app.podcast.pause()
        this.model = model
        hasStarted = true
        generations.reconnect()
        val current = generations.connection
        transcript.reset()
        pendingTools.reset()
        cancelledTools.clear()
        turnFinished = false
        errorMessage = null
        muted = false
        playing = false
        moveTo(State.CONNECTING)
        usage = LiveUsage()
        usageModel = null
        usageReportID = UUID.randomUUID()
        model.enterLive()

        audio.onStopRequired = { reason ->
            if (generations.accepts(current) && state != State.DISCONNECTED) stop(reason.message)
        }
        audio.onBufferPressure = {
            if (generations.accepts(current) && state == State.ACTIVE) errorMessage = "音频缓冲繁忙，部分声音可能略过；通话会继续。"
        }
        audio.onPlaying = { isPlaying, epoch ->
            if (generations.accepts(current) && audio.acceptsPlayback(epoch) && state != State.DISCONNECTED) {
                playing = isPlaying
                if (!isPlaying) watchForStuck()
            }
        }
        audio.onRouteChanged = { speaker -> if (generations.accepts(current)) usesSpeaker = speaker }

        val snapshot = model.session
        connectJob = scope.launch {
            if (!app.requestPermission(Manifest.permission.RECORD_AUDIO)) {
                if (generations.accepts(current)) stop("麦克风权限被拒。可在系统设置中允许麦克风，或切回文字模式。")
                return@launch
            }
            if (!generations.accepts(current)) return@launch
            // From here on the call may continue while another app is on screen.
            app.hangUpCall = { stop() }
            continuesInBackground = LiveCallService.start(app.context, model.session.scenario.partner)
            try {
                // The speaker path is open before the token is asked for, so no reply can arrive before it.
                audio.prepareOutput()
            } catch (_: RuntimeException) {
                stop("暂时无法准备音频，请重新连接或使用文字模式。")
                return@launch
            }
            usesSpeaker = audio.usesSpeaker
            try {
                val token = api.liveToken(snapshot)
                if (!generations.accepts(current)) return@launch
                model.updateLive(model.session.beginLive(model = token.model))
                usageModel = token.model
                client.connect(token, current,
                    handler = { event, generation -> receive(event, generation) },
                    failure = { generation, diagnostics -> if (generations.accepts(generation)) stop(diagnostics.message) })
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (generations.accepts(current)) {
                    stop((error as? PracticeNetworkException)?.message ?: "暂时无法连接语音服务，请重试或使用文字模式。")
                }
            }
        }
    }

    private fun receive(event: LiveEvent, current: Long) {
        val model = model ?: return
        if (!generations.accepts(current) || state == State.DISCONNECTED) return
        when (event) {
            is LiveEvent.SetupComplete -> {
                if (state != State.CONNECTING) return
                try {
                    // turnComplete on clientContent interrupts live generation, so the kickoff
                    // goes out BEFORE any microphone audio. When the partner's last line is
                    // unanswered, nothing is sent: the learner speaks first.
                    LiveKickoff.text(model.session)?.let { client.sendText(it, current) }
                    audio.startCapture()
                    moveTo(State.ACTIVE)
                    client.startUpload(current) { audio.takeFrame() }
                } catch (_: RuntimeException) {
                    stop("无法启动麦克风，请重试或使用文字模式。")
                } catch (_: LiveProtocolException) {
                    stop("无法启动麦克风，请重试或使用文字模式。")
                }
            }
            is LiveEvent.Audio -> {
                if (event.pcm.isEmpty() || discardingPartnerTurn) return
                turnFinished = false
                audio.play(event.pcm)
                clearSuggestion()
            }
            is LiveEvent.Interrupted -> {
                generations.interrupt()
                audio.interruptPlayback()
                playing = false
                discardingPartnerTurn = false
                // Keep the input subtitle until it is final; the next partner output gets a new ID.
                transcript.finishPartner()
            }
            is LiveEvent.Transcription -> {
                // Lines the learner chose not to hear after 打断 are not shown as said.
                if (event.role == PracticeMessage.Role.PARTNER && discardingPartnerTurn) return
                try {
                    val segment = transcript.update(event.role, event.text, event.finished)
                    if (segment.text.isBlank()) return
                    val session = model.session.liveTranscript(segment.id, event.role, segment.text) ?: throw LiveProtocolException.overloaded()
                    if (event.role == PracticeMessage.Role.USER) clearSuggestion()
                    model.updateLive(pendingTools.flush(session))
                    if (event.finished) scheduleSave()
                } catch (_: LiveProtocolException) {
                    stop("这次对话内容已达到上限，请结束后开始新练习。")
                }
            }
            is LiveEvent.TurnComplete -> {
                turnFinished = true
                discardingPartnerTurn = false
                transcript.finishTurn()
                model.updateLive(pendingTools.flush(model.session))
                scheduleSave()
                prefetchSuggestion()
            }
            is LiveEvent.Tool -> {
                // The acknowledgement was sent by the protocol client first. The work is
                // deferred to a later main-thread turn, with the generation guards again.
                scope.launch {
                    yield()
                    if (!generations.accepts(current) || event.call.id in cancelledTools || state == State.DISCONNECTED
                        || event.call.validated() == null) return@launch
                    val (applied, collected) = pendingTools.apply(event.call, model.session)
                    val session = pendingTools.flush(applied).recordCollected(collected)
                    model.updateLive(session)
                    if (collected.isEmpty()) scheduleSave() else {
                        pendingSave?.cancel()
                        pendingSave = null
                        store.save(session, collecting = collected)
                    }
                }
            }
            is LiveEvent.CancelledTools -> {
                if (cancelledTools.size + event.ids.size > 512) {
                    stop("工具调用已达到上限，请重新连接。")
                    return
                }
                cancelledTools += event.ids
                pendingTools.cancel(event.ids)
            }
            is LiveEvent.GoAway -> stop("本次连接即将到期，请重新连接。已有内容已保留。")
            is LiveEvent.Usage -> usage += event.usage
        }
    }

    private fun scheduleSave() {
        if (pendingSave != null) return
        val current = generations.connection
        pendingSave = scope.launch {
            delay(400)
            if (!generations.accepts(current)) return@launch
            pendingSave = null
            model?.let { store.save(it.session) }
        }
    }

    /** Best effort with one retry; the report ID makes a repeated upload harmless. */
    private fun reportUsage() {
        val report = usageModel?.let { LiveUsageReport.create(usageReportID, it, usage) }
        usage = LiveUsage()
        usageModel = null
        if (report == null || app.account.usesLocalDevelopment) return
        scope.launch {
            repeat(2) { attempt ->
                try {
                    api.reportLiveUsage(report)
                    return@launch
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    if (attempt == 0) delay(3000)
                }
            }
        }
    }

    /**
     * 打断: stop the partner now and open the microphone for the learner. On the
     * loudspeaker this is how the learner talks over the partner without echo.
     */
    fun interruptPartner() {
        if (state != State.ACTIVE || !playing) return
        // The server often finishes a reply before it has all played; only drop
        // what is still to come for a turn the server has not closed yet.
        discardingPartnerTurn = !turnFinished
        generations.interrupt()
        audio.learnerTakesFloor()
        playing = false
        transcript.finishPartner()
        if (muted) toggleMute()
    }

    /** "卡住了" button (or the silence timer): show the reply idea, prefetched when possible. */
    fun requestSuggestion(automatic: Boolean = false) {
        val model = model ?: return
        if (state != State.ACTIVE || suggesting) return
        stuckJob?.cancel()
        stuckJob = null
        val line = LiveStuckPolicy.awaitedLine(model.session)
        suggestedLine = line
        if (line == null || prefetched?.first != line) prefetched = line to fetchSuggestion(model.session)
        val task = prefetched?.second ?: return
        suggesting = true
        suggestionError = null
        val current = generations.connection
        scope.launch {
            try {
                val idea = task.await()
                if (!generations.accepts(current) || state != State.ACTIVE) return@launch
                if (idea == null) {
                    // Both attempts failed: forget it so the next tap tries again.
                    if (prefetched?.first == line) prefetched = null
                    if (!automatic) suggestionError = "暂时拿不到建议，请再点一次。"
                    return@launch
                }
                if (LiveStuckPolicy.awaitedLine(model.session) == suggestedLine) suggestion = idea
            } finally {
                suggesting = false
            }
        }
    }

    /** Start generating help for the partner's latest line before the learner needs it. */
    private fun prefetchSuggestion() {
        val model = model ?: return
        if (state != State.ACTIVE) return
        val line = LiveStuckPolicy.awaitedLine(model.session) ?: return
        if (prefetched?.first != line) prefetched = line to fetchSuggestion(model.session)
    }

    /** One automatic retry: a suggestion is only useful if it is ready when the learner pauses. */
    private fun fetchSuggestion(session: PracticeSession): Deferred<LiveSuggestion?> = scope.async {
        repeat(2) { attempt ->
            try {
                return@async api.suggest(session)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (attempt == 0) delay(1500)
            }
        }
        null
    }

    fun dismissSuggestion() = clearSuggestion()

    /** After the partner finishes a line, offer help if the learner stays silent. */
    private fun watchForStuck() {
        stuckJob?.cancel()
        stuckJob = null
        prefetchSuggestion()
        val model = model ?: return
        if (state != State.ACTIVE || muted || suggestion != null) return
        val line = LiveStuckPolicy.awaitedLine(model.session) ?: return
        if (line == suggestedLine) return
        val current = generations.connection
        stuckJob = scope.launch {
            delay(LiveStuckPolicy.SILENCE_MS)
            if (generations.accepts(current) && state == State.ACTIVE && !muted && !playing
                && LiveStuckPolicy.awaitedLine(model.session) == line) requestSuggestion(automatic = true)
        }
    }

    private fun clearSuggestion() {
        stuckJob?.cancel()
        stuckJob = null
        suggestion = null
        suggestionError = null
    }

    /** Muting only closes the microphone; the partner can still be heard. */
    fun toggleMute() {
        if (state != State.ACTIVE) return
        muted = !muted
        audio.setMuted(muted)
        val current = generations.connection
        if (muted) client.endInput(current) else client.resumeInput(current)
    }

    fun stop(message: String? = null) {
        if (state == State.DISCONNECTED) return
        val closing = generations.connection
        pendingSave?.cancel()
        pendingSave = null
        generations.reconnect()
        connectJob?.cancel()
        connectJob = null
        audio.stop()
        LiveCallService.stop(app.context)
        app.hangUpCall = null
        continuesInBackground = false
        moveTo(State.DISCONNECTED)
        playing = false
        muted = false
        clearSuggestion()
        suggestedLine = null
        discardingPartnerTurn = false
        reportUsage()
        prefetched?.second?.cancel()
        prefetched = null
        errorMessage = message
        model?.let {
            val session = pendingTools.flush(it.session).endLive()
            it.updateLive(session)
            store.save(session)
        }
        client.close(expectedGeneration = closing)
    }
}
