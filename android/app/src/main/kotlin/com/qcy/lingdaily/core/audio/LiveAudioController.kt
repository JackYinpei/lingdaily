package com.qcy.lingdaily.core.audio

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AudioEffect
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min
import com.qcy.lingdaily.core.realtime.LiveEchoGate
import com.qcy.lingdaily.core.realtime.LiveInputBuffer
import com.qcy.lingdaily.core.realtime.LivePCMFramer
import com.qcy.lingdaily.core.realtime.LivePlaybackBuffer
import com.qcy.lingdaily.core.realtime.LiveProtocolException

/**
 * Audio for a Live call: 16 kHz mono PCM16 from the microphone, 24 kHz mono PCM16 from the model.
 *
 * One thread reads the microphone and one feeds the speaker; neither does JSON, Base64,
 * network or file work. The speaker thread never lets the track run dry (it writes silence
 * between replies), so the track's played-frame counter is a reliable clock for "the
 * partner has finished speaking". Pressure drops bounded audio and never hangs up the call.
 * Public methods are called on the main thread; callbacks are delivered there.
 */
class LiveAudioController(context: Context) {
    enum class StopReason(val message: String) {
        INTERRUPTION("通话被系统音频打断，已有内容已保留。请重新连接。"),
        ROUTE_UNAVAILABLE("当前音频设备已断开，已有内容已保留。请重新连接。"),
        CAPTURE("麦克风音频处理失败，已有内容已保留。请重新连接。"),
        PLAYBACK("对方声音播放失败，已有内容已保留。请重新连接。"),
    }

    var onStopRequired: ((StopReason) -> Unit)? = null
    var onBufferPressure: (() -> Unit)? = null
    var onPlaying: ((Boolean, Long) -> Unit)? = null

    /** The output moved between the phone's own speaker and a headset. */
    var onRouteChanged: ((Boolean) -> Unit)? = null

    private val audioManager = context.applicationContext.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val lock = Any()

    // Guarded by `lock`.
    private val playback = LivePlaybackBuffer()
    private val input = LiveInputBuffer()
    private var echoGate = LiveEchoGate()
    private var speakerOutput = true
    private var flushRequested = false
    /** Bumped by every prepare and stop; a thread of an earlier call sees it and exits. */
    private var session = 0

    @Volatile private var muted = false
    private var headsetInUse = false
    private var track: AudioTrack? = null
    private var record: AudioRecord? = null
    private var effects: List<AudioEffect> = emptyList()
    private var playbackThread: Thread? = null
    private var captureThread: Thread? = null
    private var focusRequest: AudioFocusRequest? = null
    private var previousMode = AudioManager.MODE_NORMAL

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        // A phone call or another app took the audio. Ducking for a notification sound is not a loss.
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            if (track != null) onStopRequired?.invoke(StopReason.INTERRUPTION)
        }
    }

    private val deviceCallback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = refreshRoute()
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = refreshRoute()
    }

    val hasOutput: Boolean get() = synchronized(lock) { playback.reservedBytes > 0 }

    /** True when the partner plays through the phone itself, where talking over them needs 打断. */
    val usesSpeaker: Boolean get() = synchronized(lock) { speakerOutput }

    fun acceptsPlayback(epoch: Long): Boolean = synchronized(lock) { epoch == playback.generation }

    /**
     * Opens the speaker path. Called before the token is requested, so the partner's first
     * words always have somewhere to go. Calling it again during the same call does nothing.
     */
    fun prepareOutput() {
        if (track != null) return
        try {
            openOutput()
        } catch (error: RuntimeException) {
            releaseSystemAudio()
            throw error
        }
    }

    private fun openOutput() {
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener(focusListener, main)
            .build()
        check(audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "Audio focus denied" }
        focusRequest = request
        previousMode = audioManager.mode
        // Communication mode is what makes the platform's echo canceller follow this output.
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION

        val minimum = AudioTrack.getMinBufferSize(OUTPUT_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "No output format" }
        val created = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(OUTPUT_RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(max(minimum, OUTPUT_RATE * 2 / 10))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        if (created.state != AudioTrack.STATE_INITIALIZED) {
            created.release()
            error("Output unavailable")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Resume after any gap as soon as a little audio is queued, not only on a full buffer.
            runCatching { created.setStartThresholdInFrames(IDLE_FRAMES / 2) }
        }
        created.play()
        track = created
        val id = synchronized(lock) {
            echoGate = LiveEchoGate()
            flushRequested = false
            ++session
        }
        playbackThread = thread(name = "lingdaily-live-playback") { playbackLoop(created, id) }
        headsetInUse = false
        // Reports the devices already connected right away, which picks the first route.
        audioManager.registerAudioDeviceCallback(deviceCallback, main)
        refreshRoute()
    }

    /** Never called before setupComplete. The caller has checked the microphone permission. */
    @SuppressLint("MissingPermission")
    fun startCapture() {
        check(track != null && record == null) { "Capture needs a prepared call" }
        val minimum = AudioRecord.getMinBufferSize(INPUT_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "No input format" }
        val created = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(INPUT_RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
            .setBufferSizeInBytes(max(minimum, LivePCMFramer.FRAME_BYTES * 10))
            .build()
        if (created.state != AudioRecord.STATE_INITIALIZED) {
            created.release()
            error("Microphone unavailable")
        }
        effects = listOfNotNull(
            if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(created.audioSessionId) else null,
            if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(created.audioSessionId) else null,
        ).onEach { runCatching { it.enabled = true } }
        created.startRecording()
        if (created.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            created.release()
            releaseEffects()
            error("Microphone busy")
        }
        muted = false
        record = created
        val id = synchronized(lock) {
            input.clear()
            session
        }
        captureThread = thread(name = "lingdaily-live-capture") { captureLoop(created, id) }
    }

    /** The next 20 ms microphone frame for upload, or null when none is waiting. */
    fun takeFrame(): ByteArray? = synchronized(lock) {
        val frame = input.take() ?: return null
        val suppress = echoGate.suppressesMicrophone(playback.reservedBytes > 0, speakerOutput, SystemClock.elapsedRealtime())
        // Silence keeps the stream timing, so Gemini sees the learner as quiet rather than gone.
        if (suppress) ByteArray(frame.size) else frame
    }

    /** 打断: stop the partner and give the learner an open microphone until the partner's next reply. */
    fun learnerTakesFloor() {
        interruptPlayback()
        synchronized(lock) { echoGate.learnerTookFloor() }
    }

    fun setMuted(value: Boolean) {
        muted = value
        synchronized(lock) { input.clear() }
    }

    fun play(pcm: ByteArray) {
        if (pcm.isEmpty()) return
        val queued = synchronized(lock) {
            if (playback.reservedBytes == 0) echoGate.partnerStartedReply()
            val epoch = playback.reserve(pcm.size)
            epoch != null && playback.enqueue(pcm, epoch)
        }
        if (!queued) onBufferPressure?.invoke()
    }

    fun interruptPlayback() {
        val epoch = synchronized(lock) {
            playback.invalidate()
            flushRequested = true
            playback.generation
        }
        onPlaying?.invoke(false, epoch)
    }

    fun stop() {
        val endedTrack = track
        val endedRecord = record
        val endedEffects = effects
        val threads = listOfNotNull(captureThread, playbackThread)
        track = null
        record = null
        effects = emptyList()
        captureThread = null
        playbackThread = null
        val epoch = synchronized(lock) {
            session++
            playback.invalidate()
            input.clear()
            flushRequested = false
            playback.generation
        }
        if (endedTrack == null) return
        onPlaying?.invoke(false, epoch)
        audioManager.unregisterAudioDeviceCallback(deviceCallback)
        // Stopping the recorder makes the blocked microphone read return.
        runCatching { endedRecord?.stop() }
        thread(name = "lingdaily-live-teardown") {
            threads.forEach { runCatching { it.join(1000) } }
            endedEffects.forEach { runCatching { it.release() } }
            runCatching { endedRecord?.release() }
            runCatching {
                endedTrack.pause()
                endedTrack.flush()
            }
            runCatching { endedTrack.release() }
        }
        releaseSystemAudio()
    }

    private fun releaseSystemAudio() {
        val request = focusRequest ?: return
        focusRequest = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching { audioManager.clearCommunicationDevice() }
        } else {
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = false
        }
        audioManager.mode = previousMode
        audioManager.abandonAudioFocusRequest(request)
        headsetInUse = false
    }

    // ---- Route ----

    /** Headset when one is connected, otherwise the loudspeaker (never the quiet earpiece). */
    private fun refreshRoute() {
        if (track == null) return
        val headset: Boolean
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val devices = runCatching { audioManager.availableCommunicationDevices }.getOrDefault(emptyList())
            val target = devices.firstOrNull { it.type in HEADSET_TYPES }
                ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            if (target != null && audioManager.communicationDevice?.id != target.id) {
                runCatching { audioManager.setCommunicationDevice(target) }
            }
            headset = target != null && target.type in HEADSET_TYPES
        } else {
            headset = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in WIRED_TYPES }
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = !headset
        }
        val wasHeadset = headsetInUse
        headsetInUse = headset
        val changed = synchronized(lock) {
            val different = speakerOutput == headset
            speakerOutput = !headset
            different
        }
        if (changed) onRouteChanged?.invoke(!headset)
        // The headset the learner was talking through is gone: do not blast the call out of the speaker.
        if (wasHeadset && !headset) onStopRequired?.invoke(StopReason.ROUTE_UNAVAILABLE)
    }

    // ---- Threads ----

    private class Scheduled(val endFrame: Long, val bytes: Int, val generation: Long)

    private fun playbackLoop(track: AudioTrack, id: Int) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        val silence = ByteArray(OUTPUT_RATE * 2 / 100)
        val scheduled = ArrayDeque<Scheduled>()
        var written = 0L
        var playingEpoch: Long? = null
        var lastPlayed = -1L
        var lastProgressAt = SystemClock.elapsedRealtime()

        // A streaming track only starts once its buffer has been filled; a short reply
        // would otherwise sit unheard. One buffer of silence starts it for good.
        fun prime(): Boolean {
            val bytes = ByteArray(track.bufferSizeInFrames * 2)
            val count = track.write(bytes, 0, bytes.size, AudioTrack.WRITE_NON_BLOCKING)
            if (count < 0) return false
            written = count / 2L
            lastPlayed = -1
            lastProgressAt = SystemClock.elapsedRealtime()
            return true
        }
        try {
            if (!prime()) return requestStop(StopReason.PLAYBACK, id)
            while (true) {
                var chunk: LivePlaybackBuffer.Chunk? = null
                var flush = false
                synchronized(lock) {
                    if (session != id) return
                    if (flushRequested) {
                        flushRequested = false
                        flush = true
                    } else {
                        chunk = playback.next()
                    }
                }
                if (flush) {
                    // Drop what the learner chose not to hear; the played-frame counter restarts at zero.
                    track.pause()
                    track.flush()
                    track.play()
                    scheduled.clear()
                    playingEpoch = null
                    if (!prime()) return requestStop(StopReason.PLAYBACK, id)
                    continue
                }
                var played = track.playbackHeadPosition.toLong() and 0xFFFFFFFFL
                val audio = chunk
                if (audio != null) {
                    if (playingEpoch != audio.generation) {
                        playingEpoch = audio.generation
                        main.post { onPlaying?.invoke(true, audio.generation) }
                    }
                    var offset = 0
                    while (offset < audio.data.size) {
                        // Short writes keep 打断 and hang-up responsive.
                        val cancelled = synchronized(lock) { session != id || flushRequested }
                        if (cancelled) break
                        val count = track.write(audio.data, offset, min(WRITE_BYTES, audio.data.size - offset))
                        if (count < 0) return requestStop(StopReason.PLAYBACK, id)
                        offset += count
                    }
                    written += offset / 2
                    scheduled.addLast(Scheduled(written, audio.data.size, audio.generation))
                } else if (written - played < IDLE_FRAMES) {
                    val count = track.write(silence, 0, silence.size)
                    if (count < 0) return requestStop(StopReason.PLAYBACK, id)
                    written += count / 2
                } else {
                    Thread.sleep(4)
                }
                played = track.playbackHeadPosition.toLong() and 0xFFFFFFFFL
                val now = SystemClock.elapsedRealtime()
                if (played != lastPlayed) {
                    lastPlayed = played
                    lastProgressAt = now
                } else if (now - lastProgressAt > STALL_MS) {
                    // Never leave "the partner is speaking" (and the echo gate) stuck on a device
                    // whose counter stopped: treat everything handed over as heard.
                    played = Long.MAX_VALUE
                }
                var finished: Long? = null
                synchronized(lock) {
                    while (scheduled.isNotEmpty() && scheduled.first().endFrame <= played) {
                        val done = scheduled.removeFirst()
                        if (playback.complete(done.bytes, done.generation) && playback.reservedBytes == 0) finished = done.generation
                    }
                }
                finished?.let { epoch ->
                    playingEpoch = null
                    main.post { onPlaying?.invoke(false, epoch) }
                }
            }
        } catch (_: IllegalStateException) {
            requestStop(StopReason.PLAYBACK, id)
        } catch (_: InterruptedException) {
            // Only teardown interrupts this thread.
        }
    }

    private fun captureLoop(record: AudioRecord, id: Int) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        val framer = LivePCMFramer()
        val buffer = ByteArray(LivePCMFramer.FRAME_BYTES)
        try {
            while (true) {
                if (synchronized(lock) { session != id }) return
                val count = record.read(buffer, 0, buffer.size)
                if (count < 0) return requestStop(StopReason.CAPTURE, id)
                if (count == 0) continue
                if (muted) {
                    // Keep reading so the stream stays live, but nothing said while muted is kept.
                    framer.reset()
                    continue
                }
                val frames = framer.append(buffer.copyOf(count))
                val pressure = synchronized(lock) {
                    if (session != id || muted) return@synchronized false
                    val dropped = input.droppedFrames
                    input.append(frames)
                    input.droppedFrames > dropped
                }
                if (pressure) main.post { onBufferPressure?.invoke() }
            }
        } catch (_: LiveProtocolException) {
            requestStop(StopReason.CAPTURE, id)
        } catch (_: IllegalStateException) {
            requestStop(StopReason.CAPTURE, id)
        }
    }

    private fun requestStop(reason: StopReason, id: Int) {
        main.post {
            if (synchronized(lock) { session == id }) onStopRequired?.invoke(reason)
        }
    }

    private fun releaseEffects() {
        effects.forEach { runCatching { it.release() } }
        effects = emptyList()
    }

    private companion object {
        const val INPUT_RATE = 16_000
        const val OUTPUT_RATE = 24_000

        /** 20 ms of output per write. */
        const val WRITE_BYTES = OUTPUT_RATE * 2 / 50

        /** Silence kept queued between replies, so the track never runs dry: 40 ms. */
        const val IDLE_FRAMES = OUTPUT_RATE / 25

        /** Played-frame counter not moving for this long means the device stopped reporting. */
        const val STALL_MS = 1_000L

        val WIRED_TYPES = setOf(AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_USB_HEADSET)
        val HEADSET_TYPES = WIRED_TYPES + setOf(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET,
            AudioDeviceInfo.TYPE_HEARING_AID)
    }
}
