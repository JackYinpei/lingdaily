package com.qcy.lingdaily.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.qcy.lingdaily.MainActivity
import com.qcy.lingdaily.R

/**
 * Keeps a voice call alive while the learner looks at another app. Android only lets an
 * app use the microphone in the background from a visible foreground service, so the
 * call shows an ongoing notification with a way to hang up.
 */
class LiveCallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = (applicationContext as LingDailyApplication).container
        if (intent?.action == ACTION_HANG_UP) {
            app.hangUpCall?.invoke()
            stopSelf()
            return START_NOT_STICKY
        }
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "语音通话", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val hangUp = PendingIntent.getService(this, 1, Intent(this, LiveCallService::class.java).setAction(ACTION_HANG_UP), PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("正在语音通话").setContentText(intent?.getStringExtra(EXTRA_PARTNER)?.let { "和 $it 的对话进行中" } ?: "对话进行中")
            .setOngoing(true).setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "结束通话", hangUp).build()).build()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            else startForeground(ID, notification)
        } catch (_: RuntimeException) {
            // Not allowed right now (the app is not visible): the call then ends when the app leaves the screen, as before.
            stopSelf()
        }
        return START_NOT_STICKY
    }

    /** Swiping the app away ends the call; nothing keeps listening after that. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        (applicationContext as LingDailyApplication).container.hangUpCall?.invoke()
        stopSelf()
    }

    companion object {
        private const val CHANNEL = "live-call"
        private const val ID = 41
        private const val ACTION_HANG_UP = "com.qcy.lingdaily.HANG_UP"
        private const val EXTRA_PARTNER = "partner"

        /** True when the service could be started, so the call may continue in the background. */
        fun start(context: Context, partner: String): Boolean = runCatching {
            ContextCompat.startForegroundService(context, Intent(context, LiveCallService::class.java).putExtra(EXTRA_PARTNER, partner))
        }.isSuccess

        fun stop(context: Context) {
            context.stopService(Intent(context, LiveCallService::class.java))
        }
    }
}
