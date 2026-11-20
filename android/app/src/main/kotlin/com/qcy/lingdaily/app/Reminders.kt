package com.qcy.lingdaily.app

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import com.qcy.lingdaily.MainActivity
import com.qcy.lingdaily.R
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeStats
import com.qcy.lingdaily.core.model.ReminderPlan
import com.qcy.lingdaily.core.model.nowMillis

/**
 * Opt-in local reminders: one before a real conversation the learner told us about, and
 * an optional daily nudge that skips days already practised. Nothing is sent to a server.
 *
 * Android forgets alarms on restart, so what is planned is also kept in preferences and
 * `ReminderReceiver` plans it again after a restart, an app update or a time-zone change.
 */
class ReminderCenter(context: Context, private val settings: Settings) {
    /** A reminder kept across restarts: enough to post it without the archive. */
    @Serializable
    data class EventReminder(val day: String, val partner: String, val title: String)

    private val context = context.applicationContext
    private val preferences: SharedPreferences = this.context.getSharedPreferences("reminders", Context.MODE_PRIVATE)
    private val alarms = this.context.getSystemService(AlarmManager::class.java)

    /** A reminder for this scenario was tapped; the practice page opens it. */
    var pendingScenarioID by mutableStateOf<String?>(null)

    /** Custom scenario id → the real conversation it prepares for. */
    var events by mutableStateOf(loadEvents())
        private set

    val notificationsAllowed: Boolean
        get() = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    // ---- Before a real conversation ----

    fun eventDay(scenarioID: String): LocalDate? = events[scenarioID]?.day?.let(::parseDay)

    fun scheduleEvent(scenario: PracticeScenario, day: LocalDate) {
        cancelEvent(scenario.id)
        events = events + (scenario.id to EventReminder(day.toString(), scenario.partner, scenario.title))
        saveEvents()
        planEvent(scenario.id)
    }

    fun cancelEvent(scenarioID: String) {
        for (suffix in listOf("day", "eve")) alarms.cancel(alarm("event-$scenarioID-$suffix"))
        if (scenarioID !in events) return
        events = events - scenarioID
        saveEvents()
    }

    private fun planEvent(scenarioID: String) {
        val day = eventDay(scenarioID) ?: return
        for (event in ReminderPlan.event(day)) {
            set("event-$scenarioID-${if (event.isSameDay) "day" else "eve"}", event.at)
        }
    }

    // ---- Daily ----

    /** Re-plans the next seven days. Called on return to the app and after practising. */
    fun rescheduleDaily(practicedToday: Boolean) {
        val dates = if (settings.dailyReminderEnabled) {
            ReminderPlan.daily(settings.dailyReminderHour, settings.dailyReminderMinute, practicedToday)
        } else emptyList()
        val wanted = dates.associateBy { DAILY_PREFIX + Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).toLocalDate() }
        // The same id replaces its old alarm, so only days no longer wanted are cancelled.
        val planned = preferences.getStringSet(DAILY_KEY, emptySet()).orEmpty()
        for (id in planned - wanted.keys) alarms.cancel(alarm(id))
        for ((id, at) in wanted) set(id, at)
        preferences.edit().putStringSet(DAILY_KEY, wanted.keys).apply()
    }

    /** After a restart or a clock change: every alarm is gone or wrong, so plan them all again. */
    fun restore(practicedToday: Boolean) {
        events.keys.forEach(::planEvent)
        rescheduleDaily(practicedToday)
    }

    /** Sign-out or account deletion: this account's reminders leave the device with its data. */
    fun clearAll() {
        events.keys.toList().forEach(::cancelEvent)
        settings.dailyReminderEnabled = false
        rescheduleDaily(practicedToday = false)
        context.getSystemService(NotificationManager::class.java).cancelAll()
    }

    // ---- Posting ----

    /** Builds the notification for an alarm that has fired; null when it is no longer wanted. */
    fun notification(id: String): Notification? {
        val (title, body, scenarioID) = when {
            id.startsWith(DAILY_PREFIX) -> {
                if (!settings.dailyReminderEnabled) return null
                Triple("今天想练哪一场对话？", "五分钟就够，开口说几句。", null)
            }
            id.startsWith("event-") -> {
                val sameDay = id.endsWith("-day")
                val scenario = id.removePrefix("event-").removeSuffix(if (sameDay) "-day" else "-eve")
                val event = events[scenario] ?: return null
                Triple(
                    if (sameDay) "今天就要和 ${event.partner} 聊「${event.title}」" else "明天要和 ${event.partner} 聊「${event.title}」",
                    if (sameDay) "出门前再过一遍那三句话？" else "睡前再过一遍那三句话？",
                    scenario,
                )
            }
            else -> return null
        }
        val open = Intent(context, MainActivity::class.java)
            .setData(Uri.parse("lingdaily://reminder/$id"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_SCENARIO_ID, scenarioID)
        ensureChannel()
        return Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .build()
    }

    fun post(id: String) {
        if (!notificationsAllowed) return
        val notification = notification(id) ?: return
        context.getSystemService(NotificationManager::class.java).notify(id, 0, notification)
    }

    private fun ensureChannel() {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "练习提醒", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "你自己打开的每日提醒，和真实对话前的提醒。"
        })
    }

    // ---- Alarms ----

    private fun alarm(id: String): PendingIntent = PendingIntent.getBroadcast(context, 0,
        Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_FIRE).setData(Uri.parse("lingdaily://reminder/$id")),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** Within a few minutes of the chosen time, also in Doze; no exact-alarm permission is needed for that. */
    private fun set(id: String, at: Long) {
        if (at <= nowMillis()) return
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm(id))
    }

    private fun loadEvents(): Map<String, EventReminder> = preferences.getString(EVENTS_KEY, null)?.let {
        runCatching { AppJson.decodeFromString(EVENTS, it) }.getOrNull()
    } ?: emptyMap()

    private fun saveEvents() = preferences.edit().putString(EVENTS_KEY, AppJson.encodeToString(EVENTS, events)).apply()

    companion object {
        const val EXTRA_SCENARIO_ID = "scenarioID"
        private const val CHANNEL = "practice-reminders"
        private const val DAILY_PREFIX = "daily-"
        private const val DAILY_KEY = "plannedDaily"
        private const val EVENTS_KEY = "scenarioEvents"
        private val EVENTS = MapSerializer(String.serializer(), EventReminder.serializer())

        fun parseDay(text: String): LocalDate? = try {
            LocalDate.parse(text)
        } catch (_: DateTimeParseException) {
            null
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? LingDailyApplication ?: return
        val container = app.container
        when (intent.action) {
            ACTION_FIRE -> intent.data?.lastPathSegment?.let(container.reminders::post)
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_TIME_CHANGED ->
                container.reminders.restore(PracticeStats.spokeToday(container.store.archive.sessions))
        }
    }

    companion object {
        const val ACTION_FIRE = "com.qcy.lingdaily.REMINDER"
    }
}
