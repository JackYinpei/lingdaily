package com.qcy.lingdaily.core.audio

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import kotlin.concurrent.thread
import kotlin.math.max
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.qcy.lingdaily.core.model.prefix
import com.qcy.lingdaily.core.network.PracticeNetworkException
import com.qcy.lingdaily.core.network.PracticeServing

/** A WAV file (RIFF, PCM16 mono) around raw samples: the format the transcription route accepts. */
fun wavFile(pcm: ByteArray, sampleRate: Int = 16_000): ByteArray {
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray(Charsets.US_ASCII)).putInt(36 + pcm.size).put("WAVEfmt ".toByteArray(Charsets.US_ASCII))
    header.putInt(16).putShort(1).putShort(1).putInt(sampleRate).putInt(sampleRate * 2).putShort(2).putShort(16)
    header.put("data".toByteArray(Charsets.US_ASCII)).putInt(pcm.size)
    return header.array() + pcm
}

/**
 * Text-mode dictation and read-aloud. Both go through the LingDaily service (Gemini), so
 * they work the same on every phone, whether or not it has an English speech service:
 * a line is fetched as MP3 and played; a recording is sent when the learner stops and
 * comes back as text. Live calls never go through here.
 * One instance serves every screen; all of it runs on the main thread.
 */
class SpeechController(
    context: Context,
    private val scope: CoroutineScope,
    private val api: PracticeServing,
    private val slowSpeech: () -> Boolean,
    private val requestMicrophone: suspend () -> Boolean,
    private val pausePodcast: () -> Unit,
) {
    var isRecording by mutableStateOf(false)
        private set
    var isSpeaking by mutableStateOf(false)
        private set
    var isRequestingPermission by mutableStateOf(false)
        private set

    /** The recording has ended and its words are on their way. */
    var isFinalizing by mutableStateOf(false)
        private set
    var transcript by mutableStateOf("")
        private set
    var errorMessage by mutableStateOf<String?>(null)

    private val context = context.applicationContext
    private val audioManager = this.context.getSystemService(AudioManager::class.java)
    private val cache = File(this.context.cacheDir, "speech")

    // Dictation
    private var generation = 0
    private var limit = 800
    private var record: AudioRecord? = null
    private var recorded: ByteArrayOutputStream? = null
    private var timeout: Job? = null
    private var finishing: Job? = null

    // Read-aloud
    private var speaking = 0
    private var player: MediaPlayer? = null
    private var focusRequest: AudioFocusRequest? = null

    // ---- Dictation ----

    @SuppressLint("MissingPermission")
    suspend fun startRecording(maxCharacters: Int = 800) {
        if (isRecording || isRequestingPermission || isFinalizing) return
        stopAll()
        pausePodcast()
        errorMessage = null
        val current = ++generation
        isRequestingPermission = true
        val allowed = try {
            requestMicrophone()
        } finally {
            if (generation == current) isRequestingPermission = false
        }
        if (generation != current) return
        if (!allowed) {
            errorMessage = "尚未允许麦克风。可以继续打字，或在系统设置中开启。"
            return
        }
        limit = max(1, maxCharacters)
        transcript = ""
        val minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val created = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, max(minimum, RATE)).takeIf { it.state == AudioRecord.STATE_INITIALIZED }
                ?.also { it.startRecording() }
        } catch (_: RuntimeException) {
            null
        }
        if (created == null || created.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            created?.release()
            errorMessage = "麦克风暂时无法启动，可以继续打字体验。"
            return
        }
        val buffer = ByteArrayOutputStream()
        record = created
        recorded = buffer
        isRecording = true
        thread(name = "lingdaily-dictation") {
            val chunk = ByteArray(3200)
            while (true) {
                val count = try {
                    created.read(chunk, 0, chunk.size)
                } catch (_: RuntimeException) {
                    -1
                }
                if (count <= 0) break
                synchronized(buffer) { if (buffer.size() < MAX_BYTES) buffer.write(chunk, 0, count) }
            }
        }
        timeout = scope.launch {
            delay(MAX_DICTATION_MS)
            if (generation == current) finishRecording()
        }
    }

    /**
     * Ends the recording and waits for its words. Leaving the page, going to the
     * background and mode changes use `stopAll` at once and discard the recording.
     */
    suspend fun finishRecording(): String {
        // A second caller (the send button after the stop button) waits for the same result.
        finishing?.let {
            it.join()
            return transcript
        }
        if (!isRecording) return transcript
        val current = generation
        timeout?.cancel()
        timeout = null
        val pcm = endCapture()
        isRecording = false
        if (pcm.size < MIN_BYTES) return transcript
        isFinalizing = true
        val job = scope.launch {
            try {
                val text = api.transcribe(withContext(Dispatchers.Default) { wavFile(pcm, RATE) })
                if (generation != current) return@launch
                transcript = text.prefix(limit)
                if (text.isEmpty()) errorMessage = "没能听清楚，请重新尝试或打字输入。"
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (generation == current) errorMessage = (error as? PracticeNetworkException)?.message ?: "没能听清楚，请重新尝试或打字输入。"
            } finally {
                if (generation == current) isFinalizing = false
            }
        }
        finishing = job
        try {
            job.join()
        } finally {
            if (finishing === job) finishing = null
        }
        return transcript
    }

    /** Stops the microphone and returns what it captured. */
    private fun endCapture(): ByteArray {
        val active = record
        val buffer = recorded
        record = null
        recorded = null
        active?.let {
            runCatching { it.stop() }
            runCatching { it.release() }
        }
        return buffer?.let { synchronized(it) { it.toByteArray() } } ?: ByteArray(0)
    }

    fun stopRecording() {
        generation++
        timeout?.cancel()
        timeout = null
        finishing?.cancel()
        finishing = null
        endCapture()
        isRecording = false
        isRequestingPermission = false
        isFinalizing = false
    }

    // ---- Read-aloud ----

    /** Reads `text` aloud; `partner` picks the voice that person has in a voice call. */
    fun speak(text: String, partner: String? = null) {
        stopAll()
        pausePodcast()
        errorMessage = null
        val line = text.trim().prefix(1000)
        if (line.isEmpty()) return
        val current = ++speaking
        isSpeaking = true
        scope.launch {
            try {
                val file = withContext(Dispatchers.IO) { cached(line, partner) }
                    ?: api.speech(line, partner).let { audio -> withContext(Dispatchers.IO) { store(line, partner, audio) } }
                if (speaking != current) return@launch
                play(file, current)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (speaking != current) return@launch
                isSpeaking = false
                // Asking for AI consent already explains itself on its own page.
                val known = error as? PracticeNetworkException
                errorMessage = if (known != null && known.kind != PracticeNetworkException.Kind.UNAVAILABLE) known.message
                else "朗读暂时不可用，文字内容仍可正常查看。"
            }
        }
    }

    private fun play(file: File, current: Int) {
        val created = MediaPlayer()
        try {
            created.setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            created.setDataSource(file.path)
            created.setOnCompletionListener { finished(current) }
            created.setOnErrorListener { _, _, _ ->
                finished(current, failed = true)
                true
            }
            created.prepare()
            if (slowSpeech()) created.playbackParams = created.playbackParams.setSpeed(0.8f)
            requestFocus()
            player = created
            created.start()
        } catch (_: Exception) {
            created.release()
            file.delete()
            finished(current, failed = true)
        }
    }

    private fun finished(current: Int, failed: Boolean = false) {
        if (speaking != current) return
        releasePlayer()
        isSpeaking = false
        if (failed) errorMessage = "朗读暂时不可用，文字内容仍可正常查看。"
    }

    private fun releasePlayer() {
        player?.let { runCatching { it.release() } }
        player = null
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null
    }

    private fun requestFocus() {
        if (focusRequest != null) return
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .build()
        if (audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) focusRequest = request
    }

    // A line already heard (a 词库 word, a scenario's opening) plays again without the network.
    private fun cacheFile(text: String, partner: String?): File {
        val digest = MessageDigest.getInstance("SHA-256").digest("${partner.orEmpty()}\u0000$text".toByteArray())
        return File(cache, digest.joinToString("") { "%02x".format(it) }.take(40) + ".mp3")
    }

    private fun cached(text: String, partner: String?): File? =
        cacheFile(text, partner).takeIf { it.isFile && it.length() > 0 }?.also { it.setLastModified(System.currentTimeMillis()) }

    private fun store(text: String, partner: String?, audio: ByteArray): File {
        cache.mkdirs()
        val file = cacheFile(text, partner)
        val temporary = File(cache, "${file.name}.tmp")
        temporary.writeBytes(audio)
        if (!temporary.renameTo(file)) temporary.copyTo(file, overwrite = true)
        // The least recently heard lines make room.
        cache.listFiles()?.sortedByDescending { it.lastModified() }?.drop(MAX_CACHED)?.forEach { it.delete() }
        return file
    }

    fun stopAll() {
        speaking++
        releasePlayer()
        isSpeaking = false
        stopRecording()
    }

    /** A screen starts with no leftover transcript or message from the previous one. */
    fun reset() {
        stopAll()
        transcript = ""
        errorMessage = null
    }

    private companion object {
        const val RATE = 16_000
        const val MAX_DICTATION_MS = 45_000L

        /** 45 s of 16 kHz PCM16, under the service's 2 MB limit. */
        const val MAX_BYTES = RATE * 2 * 45

        /** Less than a third of a second is a mis-tap, not speech. */
        const val MIN_BYTES = RATE * 2 / 3
        const val MAX_CACHED = 300
    }
}
