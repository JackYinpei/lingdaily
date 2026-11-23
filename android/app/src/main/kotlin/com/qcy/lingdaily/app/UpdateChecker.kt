package com.qcy.lingdaily.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.Request
import com.qcy.lingdaily.BuildConfig
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.nowMillis
import com.qcy.lingdaily.core.network.PracticeApiClient

/**
 * Test builds are handed out as APK files, not through a store. `latest.json` next to the
 * APK says which version is current; a newer one is announced once in a dialog, stays on
 * 练习 and 我的, and is downloaded in the browser; Android's own installer takes it from there.
 */
class UpdateChecker {
    @Serializable
    data class Release(val versionCode: Int, val versionName: String, val apkUrl: String, val changelog: String = "")

    enum class Outcome { AVAILABLE, UP_TO_DATE, FAILED, SKIPPED }

    /** A newer version than this build, when there is one. */
    var available by mutableStateOf<Release?>(null)
        private set
    /** A check started from 「检查更新」 is under way. */
    var isChecking by mutableStateOf(false)
        private set
    private var checkedAt = 0L

    /**
     * Reads `latest.json`. Automatic checks (launch, back from the background) run at most
     * once an hour; `force` is the learner tapping 「检查更新」.
     */
    suspend fun check(force: Boolean = false): Outcome {
        if (isChecking || (!force && nowMillis() - checkedAt < 3_600_000L)) return Outcome.SKIPPED
        isChecking = true
        try {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    // The query keeps a CDN from answering with yesterday's file.
                    val request = Request.Builder().url("$BASE_URL/latest.json?t=${nowMillis() / 60_000}").build()
                    PracticeApiClient.sharedClient.newCall(request).execute().use { response ->
                        if (response.code != 200) error("HTTP ${response.code}")
                        response.body.source().apply { request(64 * 1024) }.buffer.clone().readUtf8()
                    }
                }.getOrNull()
            } ?: return Outcome.FAILED
            checkedAt = nowMillis()
            available = newer(result, BuildConfig.VERSION_CODE)
            return if (available != null) Outcome.AVAILABLE else Outcome.UP_TO_DATE
        } finally {
            isChecking = false
        }
    }

    companion object {
        const val BASE_URL = "https://deploy.shiying.sh.cn/lingdaily"

        /** The release described by `json` when it is newer than `current` and downloads from our own address. */
        fun newer(json: String, current: Int): Release? = runCatching { AppJson.decodeFromString<Release>(json) }.getOrNull()
            ?.takeIf { it.versionCode > current && it.apkUrl.startsWith("$BASE_URL/") && it.apkUrl.endsWith(".apk") }
    }
}
