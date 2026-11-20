package com.qcy.lingdaily.core.model

import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlin.math.abs
import kotlin.math.min
import kotlinx.serialization.Serializable
import com.qcy.lingdaily.core.realtime.LiveCorrectionMatcher

/**
 * Did the learner say this expression? Word-level, ignoring case, punctuation and
 * simple endings (-s, -ed, -ing). It judges recall from a transcript, never pronunciation.
 */
object RecallMatcher {
    fun stem(word: String): String {
        var value = word
        if (value.length > 4 && value.endsWith("ies")) {
            value = value.dropLast(3) + "y"
        } else {
            for (suffix in listOf("ing", "ed", "es", "s")) {
                if (value.length > suffix.length + 2 && value.endsWith(suffix)) {
                    value = value.dropLast(suffix.length)
                    break
                }
            }
        }
        if (value.length > 3 && value.endsWith("e")) value = value.dropLast(1)
        return value
    }

    fun matches(target: String, heard: String): Boolean {
        val want = LiveCorrectionMatcher.words(target).map(::stem)
        val got = LiveCorrectionMatcher.words(heard).map(::stem)
        if (want.isEmpty() || got.size < min(want.size, 6)) return false
        if (want.size <= 6) {
            // A word or short phrase has to appear, in order.
            return (0..got.size - want.size).any { got.subList(it, it + want.size) == want }
        }
        // A whole sentence: most of its words, since speech-to-text rewrites a few.
        val expected = want.toSet()
        return expected.intersect(got.toSet()).size >= expected.size * 0.8
    }
}

/** "三个词回来找你": picks a few 词库 words for the partner to bring back in a new rehearsal. */
object ReviewPicker {
    const val ENABLED_KEY = "reviewWordsInPractice"

    /**
     * Recent words and phrases not yet used in a rehearsal: ones met in this scenario first,
     * then the least-targeted, so the same three do not come back every time.
     * Sentences and grammar are left out.
     */
    fun pick(archive: PracticeArchive, scenario: PracticeScenario? = null, limit: Int = 3): List<ReviewTarget> {
        val used = archive.sessions.flatMap { it.reusedReviewItems }.map { SavedExpression.key(it.text) }.toSet()
        val targeted = mutableMapOf<String, Int>()
        for (item in archive.sessions.flatMap { it.reviewItems.orEmpty() }) {
            targeted.merge(SavedExpression.key(item.text), 1, Int::plus)
        }
        return archive.expressions.withIndex()
            .filter { (_, item) ->
                (item.kind == "word" || item.kind == "phrase") && item.text.length <= 40
                    && item.meaning.isNotBlank() && item.id !in used
            }
            .sortedWith(compareBy(
                { if (it.value.source == scenario?.title) 0 else 1 },
                { targeted[it.value.id] ?: 0 },
                { it.index },
            ))
            .take(limit)
            .map { ReviewTarget(it.value.text, it.value.meaning) }
    }
}

/**
 * When each 词库 item was last reviewed on this device and how it went. Not synced.
 *
 * Reviews are spaced: every time an item is recalled it comes back after a longer gap
 * (1, 3, 7, 14, 30 days); a miss brings it back in the next review.
 */
@Serializable
data class ReviewLog(val entries: Map<String, Entry> = emptyMap()) {
    @Serializable
    data class Entry(
        val lastReviewedAt: Millis,
        val attempts: Int,
        val recalled: Int,
        /** Recalls in a row; decides the gap before the next review. Absent in logs written before spacing. */
        val streak: Int = 0,
    ) {
        val dueAt: Long get() = lastReviewedAt + INTERVAL_DAYS[streak.coerceIn(0, INTERVAL_DAYS.lastIndex)] * DAY_MS
    }

    fun record(key: String, recalled: Boolean, now: Long = nowMillis()): ReviewLog {
        val entry = entries[key] ?: Entry(now, 0, 0)
        return copy(entries = entries + (key to Entry(now, entry.attempts + 1, entry.recalled + if (recalled) 1 else 0,
            if (recalled) entry.streak + 1 else 0)))
    }

    private fun reviewable(expressions: List<SavedExpression>) = expressions.filter { it.meaning.isNotBlank() }

    /** Items whose gap has passed, the most overdue first. */
    fun due(expressions: List<SavedExpression>, now: Long = nowMillis()): List<SavedExpression> =
        reviewable(expressions).filter { item -> entries[item.id]?.let { it.dueAt <= now } == true }
            .sortedBy { entries.getValue(it.id).dueAt }

    /**
     * What to review now: items that are due first, then ones never reviewed (newest first).
     * When nothing is due or new, the ones coming up soonest, so a learner who asks can always review.
     */
    fun deck(expressions: List<SavedExpression>, limit: Int = 10, now: Long = nowMillis()): List<SavedExpression> {
        val candidates = reviewable(expressions)
        val wanted = due(expressions, now) + candidates.filter { it.id !in entries }
        if (wanted.isNotEmpty()) return wanted.take(limit)
        return candidates.sortedBy { entries.getValue(it.id).dueAt }.take(limit)
    }

    companion object {
        private const val DAY_MS = 86_400_000L
        private val INTERVAL_DAYS = listOf(0, 1, 3, 7, 14, 30)
    }
}

/** Facts only: how many of the last few days the learner spoke, and how many times. */
object PracticeStats {
    data class Recent(val activeDays: Int, val turns: Int)

    fun recent(sessions: List<PracticeSession>, days: Int = 7, now: Long = nowMillis(),
               zone: ZoneId = ZoneId.systemDefault()): Recent {
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val start = today.minusDays(days - 1L).atStartOfDay(zone).toInstant().toEpochMilli()
        val spoken = sessions.flatMap { it.messages }
            .filter { it.role == PracticeMessage.Role.USER && it.createdAt in start..now }
        val activeDays = spoken.map { Instant.ofEpochMilli(it.createdAt).atZone(zone).toLocalDate() }.toSet().size
        return Recent(activeDays, spoken.size)
    }

    fun spokeToday(sessions: List<PracticeSession>, now: Long = nowMillis(), zone: ZoneId = ZoneId.systemDefault()): Boolean =
        recent(sessions, days = 1, now = now, zone = zone).turns > 0

    data class Day(val date: java.time.LocalDate, val turns: Int)

    /** How many times the learner spoke on each of the last `days` days, oldest first, today last. */
    fun daily(sessions: List<PracticeSession>, days: Int = 7, now: Long = nowMillis(), zone: ZoneId = ZoneId.systemDefault()): List<Day> {
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val counts = sessions.flatMap { it.messages }.filter { it.role == PracticeMessage.Role.USER && it.createdAt <= now }
            .groupingBy { Instant.ofEpochMilli(it.createdAt).atZone(zone).toLocalDate() }.eachCount()
        return (days - 1 downTo 0).map { offset -> today.minusDays(offset.toLong()).let { Day(it, counts[it] ?: 0) } }
    }

    /**
     * Days in a row with practice, ending today — or yesterday, so the count does not drop to
     * zero in the morning before today's practice.
     */
    fun streak(sessions: List<PracticeSession>, now: Long = nowMillis(), zone: ZoneId = ZoneId.systemDefault()): Int {
        val active = sessions.flatMap { it.messages }.filter { it.role == PracticeMessage.Role.USER && it.createdAt <= now }
            .map { Instant.ofEpochMilli(it.createdAt).atZone(zone).toLocalDate() }.toSet()
        var day = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        if (day !in active) day = day.minusDays(1)
        var count = 0
        while (day in active) {
            count++
            day = day.minusDays(1)
        }
        return count
    }
}

/** One card per learner message, in conversation order, with its own suggestion underneath. */
data class SummaryLine(
    val id: UUID,
    val goal: String,
    val text: String,
    val meaning: String,
    val isOwnWords: Boolean,
    val original: String,
    val note: String,
)

val PracticeSession.summaryLines: List<SummaryLine>
    get() = learnerMessages.map { message ->
        val reviewed = sentenceReview(message)
        val feedback = feedback(message.id)
        val revised = reviewed?.revised ?: feedback?.revised ?: ""
        val hasRewrite = revised.isNotEmpty() && revised != message.text
        SummaryLine(
            id = message.id, goal = scenario.steps[message.stepIndex].goal,
            text = if (hasRewrite) revised else message.text,
            meaning = if (hasRewrite) reviewed?.meaning ?: feedback?.meaning ?: "" else "",
            isOwnWords = !hasRewrite, original = message.text,
            note = if (hasRewrite) reviewed?.note ?: feedback?.note ?: "" else "",
        )
    }

/**
 * The rehearsal a 词库 item came from: the one whose notes or words contain it,
 * else the closest in time with the same source.
 */
fun PracticeArchive.session(expression: SavedExpression): PracticeSession? {
    val key = expression.id
    sessions.firstOrNull { session ->
        session.collectedItems.any { SavedExpression.key(it.text) == key }
            || session.ai?.feedbacks.orEmpty().any { SavedExpression.key(it.feedback.revised) == key }
    }?.let { return it }
    val sameSource = sessions.filter { it.scenario.title == expression.source }
    return sameSource.firstOrNull { session -> session.messages.any { it.text.lowercase().contains(key) } }
        ?: sameSource.minByOrNull { abs(it.updatedAt - expression.createdAt) }
}
