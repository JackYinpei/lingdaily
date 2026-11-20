package com.qcy.lingdaily.core.model

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** When the opt-in local reminders fire. Pure date math; scheduling lives in the app. */
object ReminderPlan {
    data class Event(
        val at: Long,
        /** true for the morning of the real conversation, false for the evening before. */
        val isSameDay: Boolean,
    )

    /** The evening before (20:00) and the morning of (08:00) a real conversation, skipping times already past. */
    fun event(day: LocalDate, now: Long = nowMillis(), zone: ZoneId = ZoneId.systemDefault()): List<Event> = listOf(
        Event(day.minusDays(1).atTime(20, 0).atZone(zone).toInstant().toEpochMilli(), false),
        Event(day.atTime(8, 0).atZone(zone).toInstant().toEpochMilli(), true),
    ).filter { it.at > now }

    /**
     * Daily reminders for the next `days` days at the chosen time. Today is skipped once the
     * learner has practised, so the reminder never nags someone who already showed up.
     */
    fun daily(hour: Int, minute: Int, practicedToday: Boolean, days: Int = 7, now: Long = nowMillis(),
              zone: ZoneId = ZoneId.systemDefault()): List<Long> {
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        return (0 until days).mapNotNull { offset ->
            if (offset == 0 && practicedToday) return@mapNotNull null
            today.plusDays(offset.toLong()).atTime(hour, minute).atZone(zone).toInstant().toEpochMilli().takeIf { it > now }
        }
    }
}
