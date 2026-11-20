package com.qcy.lingdaily.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import com.qcy.lingdaily.core.network.PracticeApiClient
import com.qcy.lingdaily.core.persistence.SyncLedger
import com.qcy.lingdaily.core.persistence.SyncLedgerFile

/**
 * Keeps the local archive and the signed-in account's cloud copy in step.
 * Local edits are recorded immediately and uploaded a few seconds later;
 * the device also pulls when the account signs in and when the app returns.
 * During a Live call nothing is uploaded (the call's audio needs the bandwidth);
 * edits made during the call go out right after hang-up.
 */
class SyncEngine(
    private val store: PracticeStore,
    private val account: AccountStore,
    private val api: PracticeApiClient,
    private val ledgerFile: SyncLedgerFile,
    private val scope: CoroutineScope,
    /** Review history, reminders and the podcast leave the device with the account's data. */
    private val forgetDeviceState: () -> Unit,
) {
    sealed interface Status {
        data object Idle : Status
        data object Syncing : Status
        data class Failed(val message: String) : Status
    }

    var status by mutableStateOf<Status>(Status.Idle)
        private set
    var lastSyncedAt by mutableStateOf<Long?>(null)
        private set
    var pendingCount by mutableIntStateOf(0)
        private set

    private var ledger = ledgerFile.load()

    /** An earlier ledger write failed, so the saved ledger may miss edits: the next sync re-sends everything local. */
    private var needsFullResync = ledgerFile.isStale
    private var ledgerSaveFailed = false
    private var running: Deferred<Boolean>? = null
    private var again = false
    private var debounce: Job? = null
    private var inLiveCall = false
    private var deferredDuringCall = false

    /** Bumped by every local edit; a sync that started before an edit runs once more. */
    private var changeCount = 0
    private var changeCountAtStart = 0

    init {
        lastSyncedAt = ledger.lastSyncedAt
        pendingCount = ledger.pendingCount
        store.onChange = ::record
        scope.launch {
            snapshotFlow { account.session?.userID }.distinctUntilChanged().collect { if (it != null) syncNow() }
        }
    }

    val isEnabled: Boolean get() = !account.usesLocalDevelopment && account.session != null

    /** Called by the call screen when a Live call starts and when it ends. */
    fun liveCallChanged(active: Boolean) {
        if (active == inLiveCall) return
        inLiveCall = active
        if (active || !deferredDuringCall) return
        deferredDuringCall = false
        scope.launch { syncNow() }
    }

    private fun record(change: ArchiveChange) {
        ledger = when (change) {
            is ArchiveChange.Session -> ledger.sessionChanged(change.id)
            is ArchiveChange.SessionDeleted -> ledger.sessionDeleted(change.id)
            is ArchiveChange.Expression -> ledger.expressionChanged(change.key)
            is ArchiveChange.ExpressionDeleted -> ledger.expressionDeleted(change.key)
            is ArchiveChange.Scenario -> ledger.scenarioChanged(change.id)
            is ArchiveChange.ScenarioDeleted -> ledger.scenarioDeleted(change.id)
        }
        saveLedger()
        changeCount++
        debounce?.cancel()
        debounce = scope.launch {
            delay(UPLOAD_DELAY_MS)
            syncNow()
        }
    }

    /** Runs one sync (or joins the running one). Returns true when nothing is left to upload. */
    suspend fun syncNow(): Boolean {
        if (!isEnabled) return false
        if (inLiveCall) {
            deferredDuringCall = true
            return false
        }
        running?.let {
            // Only edits made after the running sync collected its changes need another round;
            // a caller that just wants fresh cloud data gets it from the running one.
            if (changeCount != changeCountAtStart) again = true
            return it.await()
        }
        val task = scope.async {
            var clean = performSync()
            while (again && clean) {
                again = false
                clean = performSync()
            }
            clean
        }
        running = task
        // Cleared here rather than after `await`: the caller may be cancelled while waiting.
        task.invokeOnCompletion {
            if (running === task) {
                running = null
                again = false
            }
        }
        return task.await()
    }

    /** Uploads in rounds until nothing fits the remaining pending changes, or a round makes no progress. */
    private suspend fun performSync(): Boolean {
        changeCountAtStart = changeCount
        var pending = Int.MAX_VALUE
        repeat(50) {
            val clean = performRound() ?: return false
            if (clean || ledger.pendingCount >= pending) return clean
            pending = ledger.pendingCount
        }
        return ledger.pendingCount == 0
    }

    /** One request. Null when it failed. */
    private suspend fun performRound(): Boolean? {
        val session = account.session ?: return null
        if (!store.canWrite) return null
        if (ledger.ownerUserID != session.userID || needsFullResync) {
            val owner = ledger.ownerUserID
            ledger = if (owner != null && owner != session.userID) {
                // Data on this device belongs to another account (its session was rejected without a
                // sign-out): never upload it into this one, nor show its reviews or reminders.
                forgetAccountData()
                SyncLedger(ownerUserID = session.userID)
            } else if (needsFullResync) {
                ledger.readopt(session.userID, store.archive)
            } else {
                SyncLedger.adopting(session.userID, store.archive)
            }
            needsFullResync = false
            saveLedger()
        }
        status = Status.Syncing
        val changes = ledger.changes(store.archive)
        return try {
            val snapshot = api.sync(changes)
            if (account.session?.userID != session.userID) return null
            val merged = ledger.merge(snapshot, changes, store.archive)
            ledger = merged.ledger
            store.replaceArchive(merged.archive)
            saveLedger()
            lastSyncedAt = ledger.lastSyncedAt
            status = if (ledgerSaveFailed) Status.Failed(LEDGER_SAVE_FAILED) else Status.Idle
            ledger.pendingCount == 0
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            status = if (account.session == null) Status.Idle else Status.Failed(error.message ?: "同步没有完成，稍后会自动重试。")
            null
        }
    }

    /** Uploads what is left before signing out. True when the device holds nothing unsynced. */
    suspend fun flushBeforeSignOut(): Boolean = if (isEnabled) syncNow() else true

    /**
     * Forgets everything this device holds for the account: archive, sync ledger, review history
     * and reminders. Runs on sign-out, account deletion, and when a different account signs in.
     */
    fun forgetAccountData() {
        debounce?.cancel()
        store.clearAll()
        ledger = SyncLedger()
        needsFullResync = false
        lastSyncedAt = null
        status = Status.Idle
        saveLedger()
        forgetDeviceState()
    }

    private fun saveLedger() {
        pendingCount = ledger.pendingCount
        try {
            ledgerFile.save(ledger, current = !needsFullResync)
            ledgerSaveFailed = false
            if (status == Status.Failed(LEDGER_SAVE_FAILED)) status = Status.Idle
        } catch (_: Exception) {
            ledgerSaveFailed = true
            status = Status.Failed(LEDGER_SAVE_FAILED)
        }
    }

    private companion object {
        const val UPLOAD_DELAY_MS = 4_000L
        const val LEDGER_SAVE_FAILED = "同步记录没能保存到本机。下次打开 App 时会重新上传本机全部内容。"
    }
}
