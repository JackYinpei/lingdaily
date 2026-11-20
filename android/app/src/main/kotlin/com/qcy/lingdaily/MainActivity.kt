package com.qcy.lingdaily

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import com.qcy.lingdaily.app.AppContainer
import com.qcy.lingdaily.app.LingDailyApplication
import com.qcy.lingdaily.app.PracticeWidget
import com.qcy.lingdaily.app.ReminderCenter
import com.qcy.lingdaily.core.model.prefix
import com.qcy.lingdaily.ui.Screen
import com.qcy.lingdaily.ui.LingDailyRoot

class MainActivity : ComponentActivity() {
    private val app: AppContainer get() = (application as LingDailyApplication).container
    private var pendingPermission: CompletableDeferred<Boolean>? = null
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingPermission?.complete(granted)
        pendingPermission = null
    }
    private val requester: suspend (String) -> Boolean = ::requestPermission

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        app.permissionRequester = requester
        if (savedInstanceState == null) open(intent)
        setContent { LingDailyRoot(app) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        open(intent)
    }

    private fun open(intent: Intent?) {
        openReminder(intent)
        if (!app.navigator.isAtRoot) return
        when (intent?.action) {
            // Text shared from another app: describe the conversation it calls for (the composer keeps 300 characters).
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.takeIf { it.isNotEmpty() }
                ?.let { app.navigator.push(Screen.Composer(it.prefix(300))) }
            // The widget: straight back into the rehearsal that is waiting.
            PracticeWidget.ACTION_CONTINUE -> PracticeWidget.unfinished(app.store.archive.sessions)
                ?.let { app.navigator.push(Screen.Conversation(it)) }
        }
    }

    /** A tapped reminder opens its scenario, but never pulls the learner away from a page they are on. */
    private fun openReminder(intent: Intent?) {
        val scenarioID = intent?.getStringExtra(ReminderCenter.EXTRA_SCENARIO_ID) ?: return
        if (app.navigator.isAtRoot) app.reminders.pendingScenarioID = scenarioID
    }

    override fun onStart() {
        super.onStart()
        app.returnedToForeground()
    }

    override fun onStop() {
        super.onStop()
        app.store.flush()
        PracticeWidget.refresh(this)
    }

    override fun onDestroy() {
        if (app.permissionRequester === requester) app.permissionRequester = null
        pendingPermission?.complete(false)
        super.onDestroy()
    }

    private suspend fun requestPermission(permission: String): Boolean {
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) return true
        pendingPermission?.complete(false)
        val answer = CompletableDeferred<Boolean>()
        pendingPermission = answer
        permissionLauncher.launch(permission)
        return answer.await()
    }
}
