package com.qcy.lingdaily.core.audio

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.annotation.OptIn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import com.qcy.lingdaily.core.model.TodayEpisode

/**
 * Plays the daily podcast in a media session, so it keeps going with the screen off and
 * has lock-screen and headset controls. Practice still stops in the background.
 */
class PodcastService : MediaSessionService() {
    private var session: MediaSession? = null

    @OptIn(UnstableApi::class)
    override fun onCreate() {
        super.onCreate()
        val player = ExoPlayer.Builder(this)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), /* handleAudioFocus = */ true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        session = MediaSession.Builder(this, player).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiping the app away while nothing plays should not leave a service behind.
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}

/**
 * Streams the daily podcast. One shared player so practice audio can stop it: a call,
 * dictation or read-aloud pauses the podcast first, and only the learner resumes it.
 */
class PodcastPlayer(context: Context, private val scope: CoroutineScope) {
    /** The episode loaded into the player, playing or paused. */
    var episode by mutableStateOf<TodayEpisode?>(null)
        private set
    var isPlaying by mutableStateOf(false)
        private set
    var progress by mutableFloatStateOf(0f)
        private set
    var positionMs by mutableLongStateOf(0L)
        private set

    /** Zero until the stream has told its length. */
    var durationMs by mutableLongStateOf(0L)
        private set
    var speed by mutableFloatStateOf(1f)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    private val context = context.applicationContext
    private var controller: MediaController? = null
    private var connecting = false
    private var whenConnected: ((MediaController) -> Unit)? = null
    private var ticker: Job? = null

    val episodeDate: String? get() = episode?.date

    fun isCurrent(episode: TodayEpisode): Boolean = episodeDate == episode.date

    /** Plays this episode, or pauses/resumes it when it is already the loaded one. */
    fun toggle(episode: TodayEpisode) {
        if (isCurrent(episode) && controller != null) {
            if (isPlaying) pause() else controller?.play()
            return
        }
        val url = episode.playableURL
        if (url == null) {
            errorMessage = "这期播客暂时没有音频。"
            return
        }
        errorMessage = null
        this.episode = episode
        progress = 0f
        positionMs = 0
        durationMs = (episode.duration ?: 0) * 1000L
        val item = MediaItem.Builder().setMediaId(episode.date).setUri(url)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(episode.title).setArtist("LingDaily").build())
            .build()
        withController {
            it.setMediaItem(item)
            it.setPlaybackSpeed(speed)
            it.prepare()
            it.play()
        }
    }

    fun pause() {
        whenConnected = null
        controller?.pause()
    }

    /** `fraction` of the episode, 0...1. */
    fun seekTo(fraction: Float) {
        val player = controller ?: return
        if (durationMs <= 0) return
        player.seekTo((durationMs * fraction.coerceIn(0f, 1f)).toLong())
        tick()
    }

    /** Jumps back (negative) or ahead within the episode. */
    fun skip(milliseconds: Long) {
        val player = controller ?: return
        val target = (player.currentPosition + milliseconds).coerceAtLeast(0)
        player.seekTo(if (durationMs > 0) target.coerceAtMost(durationMs) else target)
        tick()
    }

    fun changeSpeed(value: Float) {
        speed = value
        controller?.setPlaybackSpeed(value)
    }

    /** Signing out: the episode leaves with the account. */
    fun stop() {
        whenConnected = null
        controller?.run {
            stop()
            clearMediaItems()
        }
        ticker?.cancel()
        episode = null
        isPlaying = false
        progress = 0f
        positionMs = 0
        durationMs = 0
    }

    private fun withController(action: (MediaController) -> Unit) {
        controller?.let { return action(it) }
        whenConnected = action
        if (connecting) return
        connecting = true
        val future = MediaController.Builder(context, SessionToken(context, ComponentName(context, PodcastService::class.java))).buildAsync()
        future.addListener({
            connecting = false
            val connected = runCatching { future.get() }.getOrNull()
            if (connected == null) {
                whenConnected = null
                episode = null
                errorMessage = "暂时无法播放，请稍后再试。"
                return@addListener
            }
            controller = connected
            connected.addListener(listener)
            whenConnected?.invoke(connected)
            whenConnected = null
        }, ContextCompat.getMainExecutor(context))
    }

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(playing: Boolean) {
            isPlaying = playing
            ticker?.cancel()
            tick()
            if (playing) ticker = scope.launch {
                while (isActive) {
                    tick()
                    delay(500)
                }
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_READY) tick()
            if (playbackState != Player.STATE_ENDED) return
            // Finished: back to the start, ready to listen again.
            controller?.run {
                pause()
                seekTo(0)
            }
            progress = 0f
            positionMs = 0
        }

        override fun onPlayerError(error: PlaybackException) {
            stop()
            errorMessage = "播客加载失败，请检查网络后重试。"
        }
    }

    private fun tick() {
        val player = controller ?: return
        val duration = player.duration
        if (duration != C.TIME_UNSET && duration > 0) durationMs = duration
        positionMs = player.currentPosition.coerceAtLeast(0)
        if (durationMs > 0) progress = (positionMs.toFloat() / durationMs).coerceIn(0f, 1f)
    }
}
