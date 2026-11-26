package com.qcy.lingdaily.app

import android.app.Application
import android.content.Context
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import com.qcy.lingdaily.R
import com.qcy.lingdaily.core.audio.PodcastPlayer
import com.qcy.lingdaily.core.audio.SpeechController
import com.qcy.lingdaily.core.model.PracticeStats
import com.qcy.lingdaily.core.network.AISettingsVault
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

    private val directory = File(this.context.filesDir, "lingdaily")

    val store = PracticeStore(File(directory, "archive.json"))
    val aiSettings = AISettingsStore(AISettingsVault(this.context))
    val account = AccountStore(SessionVault(this.context))
    val api = PracticeApiClient(
        accountSession = { account.session },
        aiSettings = { aiSettings.settings },
        pauseMs = { settings.livePauseMs },
        // Both can be reported from a request that finishes after its screen is gone.
        onSessionRejected = { scope.launch { account.signOut() } },
    ).also { account.api = it }

    val podcast = PodcastPlayer(this.context, scope)
    val reminders = ReminderCenter(this.context, settings)
    val catalog = ScenarioCatalogStore(File(directory, "scenario-catalog.json"), api) {
        this.context.resources.openRawResource(R.raw.scenario_catalog).bufferedReader().use { it.readText() }
    }
    val podcasts = PodcastStore(api)
    val speech = SpeechController(
        this.context, scope, api,
        slowSpeech = { settings.slowSpeech },
        requestMicrophone = { requestPermission(android.Manifest.permission.RECORD_AUDIO) },
        pausePodcast = podcast::pause,
    )
    val sync = SyncEngine(
        store = store,
        aiSettings = aiSettings,
        account = account,
        api = api,
        ledgerFile = SyncLedgerFile(File(directory, "sync-ledger.json"), { settings.syncLedgerStale }, { settings.syncLedgerStale = it }),
        scope = scope,
        forgetDeviceState = {
            reminders.clearAll()
            settings.clearReviewLog()
            podcast.stop()
            podcasts.clearRehearsals()
        },
    )

    suspend fun requestPermission(permission: String): Boolean = permissionRequester?.invoke(permission) ?: false

    val navigator = com.qcy.lingdaily.ui.Navigator()
    val updates = UpdateChecker()

    /** Ends the voice call in progress; set by the call while it lasts. */
    var hangUpCall: (() -> Unit)? = null

    val practicedToday: Boolean get() = PracticeStats.spokeToday(store.archive.sessions)

    /** The app came back from the background: pick up changes made on the web or another device. */
    fun returnedToForeground() {
        reminders.rescheduleDaily(practicedToday)
        scope.launch { sync.syncNow() }
        scope.launch { catalog.refresh() }
        scope.launch { updates.check() }
    }
}

class LingDailyApplication : Application() {
    val container: AppContainer by lazy { AppContainer(this) }
}
