package com.qcy.lingdaily.core.persistence

import java.io.File
import kotlinx.serialization.encodeToString
import com.qcy.lingdaily.core.model.AppJson

/**
 * Stores the sync ledger on disk. A failed write leaves an outdated file behind,
 * so the failure is also recorded outside that file: the next launch then
 * re-uploads everything on the device instead of trusting the outdated ledger.
 */
class SyncLedgerFile(
    private val file: File,
    private val readStale: () -> Boolean,
    private val writeStale: (Boolean) -> Unit,
) {
    /** True when an earlier write failed, so the saved ledger may be missing changes. */
    val isStale: Boolean get() = readStale()

    fun load(): SyncLedger = try {
        if (file.exists()) AppJson.decodeFromString<SyncLedger>(file.readText()) else SyncLedger()
    } catch (_: Exception) {
        SyncLedger()
    }

    /**
     * Writes the ledger. A failure marks the file stale. A success clears that mark
     * only when `current` is true, i.e. the saved ledger no longer needs a full resync.
     */
    fun save(ledger: SyncLedger, current: Boolean = true) {
        try {
            file.writeAtomically(AppJson.encodeToString(ledger))
        } catch (error: Exception) {
            writeStale(true)
            throw error
        }
        if (current) writeStale(false)
    }

    companion object {
        const val STALE_KEY = "LingDaily.syncLedgerWriteFailed"
    }
}
