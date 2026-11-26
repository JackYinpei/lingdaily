package com.qcy.lingdaily.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.qcy.lingdaily.core.model.nowMillis
import com.qcy.lingdaily.core.network.AISettings
import com.qcy.lingdaily.core.network.AISettingsVault

/**
 * Observable BYOK configuration on this device. Encrypted at rest in `AISettingsVault`,
 * and synced encrypted to the user's account when signed in.
 */
class AISettingsStore(private val vault: AISettingsVault) {
    var settings by mutableStateOf(vault.load() ?: AISettings())
        private set

    /** Set by `SyncEngine`; invoked only on local edits, never when applying cloud snapshots. */
    var onChange: (() -> Unit)? = null

    fun update(now: Long = nowMillis(), transform: (AISettings) -> AISettings) {
        val candidate = transform(settings)
        if (candidate.copy(updatedAt = 0L) == settings.copy(updatedAt = 0L)) return
        val stamped = candidate.copy(updatedAt = maxOf(now, settings.updatedAt + 1L))
        settings = stamped
        vault.save(stamped)
        onChange?.invoke()
    }

    fun replaceFromSync(remote: AISettings) {
        if (remote == settings) return
        settings = remote
        vault.save(remote)
    }

    fun clear() {
        settings = AISettings()
        vault.delete()
    }
}
