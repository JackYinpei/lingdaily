package com.qcy.lingdaily.app

import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty
import kotlinx.serialization.encodeToString
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.LearnerInterests
import com.qcy.lingdaily.core.model.PracticeLevel
import com.qcy.lingdaily.core.model.ReviewLog
import com.qcy.lingdaily.core.model.ReviewPicker
import com.qcy.lingdaily.core.persistence.SyncLedgerFile
import com.qcy.lingdaily.core.realtime.LivePause

/**
 * Small choices kept on this device. Each one is observable state, so a screen showing it
 * updates when another screen changes it. Keys match the iOS app's.
 */
class Settings(private val preferences: SharedPreferences) {
    private inner class Stored<T>(initial: T, private val write: SharedPreferences.Editor.(T) -> Unit) : ReadWriteProperty<Any?, T> {
        private var state by mutableStateOf(initial)
        override fun getValue(thisRef: Any?, property: KProperty<*>): T = state
        override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
            state = value
            preferences.edit().apply { write(value) }.apply()
        }
    }

    private fun string(key: String, default: String) = Stored(preferences.getString(key, default) ?: default) { putString(key, it) }
    private fun boolean(key: String, default: Boolean) = Stored(preferences.getBoolean(key, default)) { putBoolean(key, it) }
    private fun int(key: String, default: Int) = Stored(preferences.getInt(key, default)) { putInt(key, it) }

    /** system | light | dark */
    var appearance by string("appearance", "system")
    var autoReadReplies by boolean("autoReadAIReplies", true)
    var slowSpeech by boolean("slowSpeech", false)
    var reviewWordsInPractice by boolean(ReviewPicker.ENABLED_KEY, true)
    var livePauseMs by int(LivePause.KEY, LivePause.STANDARD)
    var preferVoicePractice by boolean("preferVoicePractice", true)
    var practiceLevel by string(PracticeLevel.KEY, PracticeLevel.STANDARD.raw)

    /** First-run picks, comma-joined (see LearnerInterests); matching scenarios lead the home page. */
    var learnerInterests by string(LearnerInterests.KEY, "")
    /** The first-run page was answered or skipped. */
    var learnerInterestsAsked by boolean(LearnerInterests.ASKED_KEY, false)

    /** Home filter; "" shows every category. */
    var homeCategory by string("homeScenarioCategory", "")
    /** The newest version already announced in the update dialog; it is not shown twice. */
    var updatePromptedVersion by int("updatePromptedVersion", 0)

    var dailyReminderEnabled by boolean("dailyReminderEnabled", false)
    var dailyReminderHour by int("dailyReminderHour", 21)
    var dailyReminderMinute by int("dailyReminderMinute", 0)

    /** When each 词库 item was last reviewed here. Another account's history must not carry over. */
    var reviewLog: ReviewLog
        get() = preferences.getString(REVIEW_LOG, null)
            ?.let { runCatching { AppJson.decodeFromString<ReviewLog>(it) }.getOrNull() } ?: ReviewLog()
        set(value) = preferences.edit().putString(REVIEW_LOG, AppJson.encodeToString(value)).apply()

    fun clearReviewLog() = preferences.edit().remove(REVIEW_LOG).apply()

    var syncLedgerStale: Boolean
        get() = preferences.getBoolean(SyncLedgerFile.STALE_KEY, false)
        // Written at once: this mark exists for the case where the process dies right after.
        set(value) {
            preferences.edit().putBoolean(SyncLedgerFile.STALE_KEY, value).commit()
        }

    private companion object {
        const val REVIEW_LOG = "reviewLog"
    }
}
