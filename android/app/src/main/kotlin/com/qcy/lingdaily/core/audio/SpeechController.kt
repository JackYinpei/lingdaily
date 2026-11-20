package com.qcy.lingdaily.core.audio

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.Locale
import java.util.UUID
import kotlin.math.max
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import com.qcy.lingdaily.core.model.prefix

/**
 * Text-mode dictation and read-aloud, using the phone's own speech services. Live calls
 * never go through here: their audio goes straight to and from the model.
 * One instance serves every screen; all of it runs on the main thread.
 */
class SpeechController(
    context: Context,
    private val scope: CoroutineScope,
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
    var isFinalizing by mutableStateOf(false)
        private set
    var transcript by mutableStateOf("")
        private set
    var errorMessage by mutableStateOf<String?>(null)

    private val context = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val audioManager = this.context.getSystemService(AudioManager::class.java)

    // Dictation
    private var recognizer: SpeechRecognizer? = null
    private var generation = 0
    private var committed = ""
    private var limit = 800
    private var timeout: Job? = null
    private var finishing: CompletableDeferred<Unit>? = null

    // Read-aloud
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: String? = null
    private var activeUtterance: String? = null
    private var focusRequest: AudioFocusRequest? = null

    // ---- Dictation ----

    suspend fun startRecording(maxCharacters: Int = 800) {
        if (isRecording || isRequestingPermission || isFinalizing) return
        stopAll()
        pausePodcast()
        errorMessage = null
        val current = ++generation
        isRequestingPermission = true
        try {
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                errorMessage = "这台设备没有可用的英语听写服务。可以先打字体验完整流程。"
                return
            }
            val allowed = requestMicrophone()
            if (generation != current) return
            if (!allowed) {
                errorMessage = "尚未允许麦克风。可以继续打字，或在系统设置中开启。"
                return
            }
        } finally {
            if (generation == current) isRequestingPermission = false
        }
        limit = max(1, maxCharacters)
        committed = ""
        transcript = ""
        try {
            // On-device recognition where the phone offers it: the audio then stays on the phone.
            val created = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
                SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            } else {
                SpeechRecognizer.createSpeechRecognizer(context)
            }
            recognizer = created
            created.setRecognitionListener(Listener(current))
            created.startListening(recognitionIntent)
            isRecording = true
            timeout = scope.launch {
                delay(MAX_DICTATION_MS)
                if (generation == current) finishRecording()
            }
        } catch (_: RuntimeException) {
            stopRecording()
            errorMessage = "麦克风暂时无法启动，可以继续打字体验。"
        }
    }

    private val recognitionIntent: Intent
        get() = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)

    /**
     * The recogniser ends a result at each pause. While the learner is still dictating it is
     * started again and its results are appended, so a long answer with pauses is kept whole.
     */
    private inner class Listener(private val current: Int) : RecognitionListener {
        private fun heard(results: Bundle?): String =
            results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty().trim()

        private fun show(latest: String) {
            val merged = listOf(committed, latest).filter { it.isNotEmpty() }.joinToString(" ")
            transcript = merged.prefix(limit)
            if (merged.length >= limit) {
                stopRecording()
                errorMessage = "这一段较长，听写已停止。请检查已保留的内容，发送后再继续。"
            }
        }

        private fun continueOrFinish() {
            if (isFinalizing) {
                finishing?.complete(Unit)
            } else if (isRecording) {
                runCatching { recognizer?.startListening(recognitionIntent) }.onFailure { stopRecording() }
            }
        }

        override fun onPartialResults(partialResults: Bundle?) {
            if (generation == current) show(heard(partialResults))
        }

        override fun onResults(results: Bundle?) {
            if (generation != current) return
            show(heard(results))
            if (generation != current) return
            committed = transcript
            continueOrFinish()
        }

        override fun onError(error: Int) {
            if (generation != current) return
            when (error) {
                // Nothing was said in this window: keep listening until the learner stops.
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> continueOrFinish()
                else -> {
                    val finalizing = isFinalizing
                    stopRecording()
                    if (!finalizing && transcript.isEmpty()) {
                        errorMessage = if (error == ERROR_LANGUAGE_NOT_SUPPORTED || error == ERROR_LANGUAGE_UNAVAILABLE) {
                            "系统听写还不能识别英语。可以在系统设置里下载英语语音包，或继续打字。"
                        } else {
                            "没能听清楚，请重新尝试或打字输入。"
                        }
                    }
                }
            }
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    /**
     * Ends dictation gracefully, allowing the recogniser's last result to arrive.
     * Leaving the page, going to the background and mode changes use `stopAll` at once.
     */
    suspend fun finishRecording(): String {
        if (!isRecording) return transcript
        val current = generation
        timeout?.cancel()
        timeout = null
        isRecording = false
        isFinalizing = true
        val done = CompletableDeferred<Unit>()
        finishing = done
        runCatching { recognizer?.stopListening() }
        withTimeoutOrNull(FINAL_RESULT_MS) { done.await() }
        val result = transcript
        if (generation == current) stopRecording()
        return result
    }

    fun stopRecording() {
        generation++
        timeout?.cancel()
        timeout = null
        recognizer?.let {
            runCatching { it.cancel() }
            runCatching { it.destroy() }
        }
        recognizer = null
        isRecording = false
        isRequestingPermission = false
        isFinalizing = false
        finishing?.complete(Unit)
        finishing = null
    }

    // ---- Read-aloud ----

    fun speak(text: String) {
        stopAll()
        pausePodcast()
        errorMessage = null
        if (text.isBlank()) return
        isSpeaking = true
        val engine = tts
        if (engine != null && ttsReady) {
            speakNow(engine, text)
            return
        }
        pendingSpeech = text
        if (engine == null) {
            tts = TextToSpeech(context) { status -> main.post { engineStarted(status) } }
        }
    }

    private fun engineStarted(status: Int) {
        val engine = tts ?: return
        val language = if (status == TextToSpeech.SUCCESS) engine.setLanguage(Locale.US) else TextToSpeech.LANG_NOT_SUPPORTED
        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
            // Try again from scratch next time: the learner may install a voice meanwhile.
            runCatching { engine.shutdown() }
            tts = null
            if (pendingSpeech != null) speechFailed()
            pendingSpeech = null
            return
        }
        // The best installed US English voice that works offline.
        runCatching {
            engine.voices?.filter { it.locale == Locale.US && !it.isNetworkConnectionRequired && "notInstalled" !in it.features }
                ?.maxByOrNull { it.quality }?.let { engine.voice = it }
        }
        engine.setAudioAttributes(AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) = finished(utteranceId, failed = false)
            override fun onStop(utteranceId: String?, interrupted: Boolean) = finished(utteranceId, failed = false)
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = finished(utteranceId, failed = true)
            override fun onError(utteranceId: String?, errorCode: Int) = finished(utteranceId, failed = true)
        })
        ttsReady = true
        pendingSpeech?.let { speakNow(engine, it) }
        pendingSpeech = null
    }

    private fun speakNow(engine: TextToSpeech, text: String) {
        val id = UUID.randomUUID().toString()
        activeUtterance = id
        engine.setSpeechRate(if (slowSpeech()) 0.72f else 0.92f)
        requestFocus()
        if (engine.speak(text.prefix(TextToSpeech.getMaxSpeechInputLength()), TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
            activeUtterance = null
            speechFailed()
        }
    }

    /** Called on the speech engine's thread. An utterance replaced by a newer one changes nothing. */
    private fun finished(utteranceId: String?, failed: Boolean) {
        main.post {
            if (utteranceId == null || utteranceId != activeUtterance) return@post
            activeUtterance = null
            if (failed) speechFailed() else {
                isSpeaking = false
                abandonFocus()
            }
        }
    }

    private fun speechFailed() {
        isSpeaking = false
        abandonFocus()
        errorMessage = "朗读暂时不可用，文字内容仍可正常查看。"
    }

    private fun requestFocus() {
        if (focusRequest != null) return
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .build()
        if (audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) focusRequest = request
    }

    private fun abandonFocus() {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null
    }

    fun stopAll() {
        activeUtterance = null
        pendingSpeech = null
        if (ttsReady) runCatching { tts?.stop() }
        isSpeaking = false
        abandonFocus()
        stopRecording()
    }

    /** A screen starts with no leftover transcript or message from the previous one. */
    fun reset() {
        stopAll()
        transcript = ""
        errorMessage = null
    }

    private companion object {
        const val MAX_DICTATION_MS = 45_000L
        const val FINAL_RESULT_MS = 1_000L

        // SpeechRecognizer.ERROR_LANGUAGE_* were added in API 31; the values are fixed.
        const val ERROR_LANGUAGE_NOT_SUPPORTED = 12
        const val ERROR_LANGUAGE_UNAVAILABLE = 13
    }
}
