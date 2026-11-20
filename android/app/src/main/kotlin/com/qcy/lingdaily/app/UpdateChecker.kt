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
 * APK says which version is current; a newer one is offered as a download in the browser,
 * and Android's own installer takes it from there.
 */
class UpdateChecker {
    @Serializable
    data class Release(val versionCode: Int, val versionName: String, val apkUrl: String, val changelog: String = "")

    /** A newer version than this build, when there is one. */
    var available by mutableStateOf<Release?>(null)
        private set
    private var checkedAt = 0L

    suspend fun check() {
        if (nowMillis() - checkedAt < 6 * 3_600_000L) return
        checkedAt = nowMillis()
        available = withContext(Dispatchers.IO) {
            runCatching {
                // The query keeps a CDN from answering with yesterday's file.
                val request = Request.Builder().url("$BASE_URL/latest.json?t=${nowMillis() / 60_000}").build()
                PracticeApiClient.sharedClient.newCall(request).execute().use { response ->
                    if (response.code != 200) return@use null
                    newer(response.body.source().apply { request(64 * 1024) }.buffer.clone().readUtf8(), BuildConfig.VERSION_CODE)
                }
            }.getOrNull()
        }
    }

    companion object {
        const val BASE_URL = "https://deploy.shiying.sh.cn/lingdaily"

        /** The release described by `json` when it is newer than `current` and downloads from our own address. */
        fun newer(json: String, current: Int): Release? = runCatching { AppJson.decodeFromString<Release>(json) }.getOrNull()
            ?.takeIf { it.versionCode > current && it.apkUrl.startsWith("$BASE_URL/") && it.apkUrl.endsWith(".apk") }
    }
}
