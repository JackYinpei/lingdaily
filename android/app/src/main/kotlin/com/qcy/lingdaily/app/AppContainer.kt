package com.qcy.lingdaily.app

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import com.qcy.lingdaily.BuildConfig
import com.qcy.lingdaily.core.audio.PodcastPlayer
import com.qcy.lingdaily.core.audio.SpeechController
import com.qcy.lingdaily.core.model.PracticeStats
import com.qcy.lingdaily.core.network.DevConnection
import com.qcy.lingdaily.core.network.PracticeApiClient
import com.qcy.lingdaily.core.network.SessionVault
import com.qcy.lingdaily.core.persistence.SyncLedgerFile

/**
 * The app's long-lived objects, built once per process and shared by every screen.
 * Everything here is used on the main thread.
 */
class AppContainer(context: Context) {
    val context: Context = context.applicationContext
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val settings = Settings(this.context.getSharedPreferences("settings", Context.MODE_PRIVATE))

    /** Set by the visible activity: asks for a runtime permission and suspends until answered. */
    var permissionRequester: (suspend (String) -> Boolean)? = null

    /** The learner has to see what AI use sends where before the first AI call. */
    var consentRequested by mutableStateOf(false)

    private val directory = File(this.context.filesDir, "lingdaily")
    private val devConnection = if (BuildConfig.DEBUG && BuildConfig.DEV_ACCESS_TOKEN.isNotEmpty()) {
        DevConnection(BuildConfig.DEV_BASE_URL, BuildConfig.DEV_ACCESS_TOKEN)
    } else null

    val store = PracticeStore(File(directory, "archive.json"))
    val account = AccountStore(SessionVault(this.context), usesLocalDevelopment = devConnection != null)
    val api = PracticeApiClient(
        configuration = devConnection,
        accountSession = { account.session },
        aiConsent = { settings.aiConsentGranted },
        modelPreference = settings::model,
        pauseMs = { settings.livePauseMs },
        // Both can be reported from a request that finishes after its screen is gone.
        onSessionRejected = { scope.launch { account.signOut() } },
        onConsentRequired = { scope.launch { consentRequested = true } },
    ).also { account.api = it }

    val podcast = PodcastPlayer(this.context, scope)
    val reminders = ReminderCenter(this.context, settings)
    val catalog = ScenarioCatalogStore(File(directory, "scenario-catalog.json"), api)
    val today = TodayStore(api)
    val speech = SpeechController(this.context, scope, slowSpeech = { settings.slowSpeech },
        requestMicrophone = { requestPermission(android.Manifest.permission.RECORD_AUDIO) }, pausePodcast = podcast::pause)
    val sync = SyncEngine(store, account, api,
        SyncLedgerFile(File(directory, "sync-ledger.json"), { settings.syncLedgerStale }, { settings.syncLedgerStale = it }),
        scope, forgetDeviceState = {
            reminders.clearAll()
            settings.clearReviewLog()
            podcast.stop()
            today.clear()
        })

    suspend fun requestPermission(permission: String): Boolean = permissionRequester?.invoke(permission) ?: false

    val navigator = com.qcy.lingdaily.ui.Navigator()

    val practicedToday: Boolean get() = PracticeStats.spokeToday(store.archive.sessions)

    /** The app came back from the background: pick up changes made on the web or another device. */
    fun returnedToForeground() {
        reminders.rescheduleDaily(practicedToday)
        scope.launch { sync.syncNow() }
        scope.launch { catalog.refresh() }
        if (account.canPractice) scope.launch { today.refresh() }
    }
}

class LingDailyApplication : Application() {
    val container: AppContainer by lazy { AppContainer(this) }
}
