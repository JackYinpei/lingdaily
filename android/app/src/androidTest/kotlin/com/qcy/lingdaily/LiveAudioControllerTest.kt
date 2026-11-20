package com.qcy.lingdaily

import android.Manifest
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.PI
import kotlin.math.sin
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import com.qcy.lingdaily.core.audio.LiveAudioController

/**
 * The call's audio on a real device or emulator: the partner's reply is reported as
 * playing for as long as it is audible (that drives 打断, the echo gate and the "stuck?"
 * timer), and the microphone delivers 20 ms frames only while unmuted. No network.
 * Run with `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class LiveAudioControllerTest {
    @get:Rule
    val microphone: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.RECORD_AUDIO)

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private lateinit var audio: LiveAudioController
    private val playing = CopyOnWriteArrayList<Pair<Boolean, Long>>()
    private val stopped = AtomicReference<LiveAudioController.StopReason?>()

    private fun onMain(block: () -> Unit) = instrumentation.runOnMainSync(block)

    private fun waitUntil(timeoutMs: Long, condition: () -> Boolean): Boolean {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            if (condition()) return true
            Thread.sleep(20)
        }
        return condition()
    }

    /** 24 kHz mono PCM16, a quiet 440 Hz tone, in the 40 ms pieces Gemini sends. */
    private fun reply(milliseconds: Int): List<ByteArray> = (0 until milliseconds / 40).map { chunk ->
        ByteArray(1920) { index ->
            val sample = (sin(2 * PI * 440 * (chunk * 960 + index / 2) / 24_000) * 2000).toInt()
            (if (index % 2 == 0) sample else sample shr 8).toByte()
        }
    }

    @Before
    fun prepare() = onMain {
        audio = LiveAudioController(instrumentation.targetContext)
        audio.onPlaying = { isPlaying, epoch -> playing += isPlaying to epoch }
        audio.onStopRequired = { stopped.set(it) }
        audio.prepareOutput()
    }

    @After
    fun hangUp() = onMain { audio.stop() }

    @Test
    fun aReplyIsPlayingForAsLongAsItIsAudibleThenFinishes() {
        val start = SystemClock.elapsedRealtime()
        // Everything arrives at once, as it does from the network: much faster than it is spoken.
        onMain { reply(1000).forEach(audio::play) }
        assertTrue(audio.hasOutput)
        assertTrue("playing is reported", waitUntil(1000) { playing.firstOrNull()?.first == true })
        assertTrue("and ends", waitUntil(4000) { playing.lastOrNull()?.first == false })
        val elapsed = SystemClock.elapsedRealtime() - start
        assertTrue("not before the audio has been heard ($elapsed ms)", elapsed >= 900)
        assertFalse(audio.hasOutput)
        assertEquals(listOf(true, false), playing.map { it.first })
        assertTrue(audio.acceptsPlayback(playing.last().second))
        assertNull(stopped.get())
    }

    @Test
    fun interruptingDropsTheRestAndAShortNextReplyStillPlays() {
        onMain { reply(3000).forEach(audio::play) }
        assertTrue(waitUntil(1000) { playing.firstOrNull()?.first == true })
        Thread.sleep(300)
        onMain { audio.learnerTakesFloor() }
        assertFalse("nothing of the old reply is left", audio.hasOutput)
        assertEquals(false, playing.last().first)
        val interrupted = playing.size

        // A one-word answer is shorter than the track's buffer; it must still be heard and finish.
        Thread.sleep(200)
        val start = SystemClock.elapsedRealtime()
        onMain { reply(120).forEach(audio::play) }
        assertTrue(waitUntil(2000) { playing.size >= interrupted + 2 })
        assertEquals(listOf(true, false), playing.drop(interrupted).map { it.first })
        val elapsed = SystemClock.elapsedRealtime() - start
        assertTrue("finished after about its own length, not the old reply's ($elapsed ms)", elapsed in 100..1500)
        assertFalse(audio.hasOutput)
        assertNull(stopped.get())
    }

    @Test
    fun microphoneDeliversTwentyMillisecondFramesOnlyWhileUnmuted() {
        onMain { audio.startCapture() }
        val frames = mutableListOf<ByteArray>()
        assertTrue("frames arrive", waitUntil(3000) {
            audio.takeFrame()?.let(frames::add)
            frames.size >= 20
        })
        assertTrue(frames.all { it.size == 640 })

        onMain { audio.setMuted(true) }
        Thread.sleep(300)
        assertNull("nothing said while muted is kept", audio.takeFrame())
        onMain { audio.setMuted(false) }
        assertTrue("and capture resumes", waitUntil(3000) { audio.takeFrame() != null })

        // On the phone's own speaker, the microphone is silenced while the partner is audible.
        if (audio.usesSpeaker) {
            onMain { reply(1000).forEach(audio::play) }
            assertTrue(waitUntil(1000) { playing.firstOrNull()?.first == true })
            Thread.sleep(200)
            val during = generateSequence { audio.takeFrame() }.toList()
            assertTrue(during.isNotEmpty())
            assertTrue("silence keeps the stream's timing", during.all { frame -> frame.size == 640 && frame.all { it == 0.toByte() } })
        }
        assertNull(stopped.get())
    }
}
