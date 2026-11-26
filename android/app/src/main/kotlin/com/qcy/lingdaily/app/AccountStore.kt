package com.qcy.lingdaily.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import com.qcy.lingdaily.core.network.AccountSession
import com.qcy.lingdaily.core.network.PracticeApiClient
import com.qcy.lingdaily.core.network.SessionVault

/**
 * Optional signed-in state for multi-device cloud sync. The session token lives encrypted
 * on this device; practice records, vocabulary, custom scenarios and encrypted API settings
 * sync to this account through `SyncEngine`.
 */
class AccountStore(private val vault: SessionVault) {
    enum class Registration { SIGNED_IN, CONFIRM_EMAIL, FAILED }

    var session by mutableStateOf(vault.load()?.takeIf { it.isUsable() })
        private set
    var isSigningIn by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)

    lateinit var api: PracticeApiClient

    suspend fun signIn(email: String, password: String): Boolean = attempt { api.signIn(email, password) } != null

    /** Phone sign-in; with `autoRegister` a number that has no account yet is registered. */
    suspend fun signInWithPhone(phone: String, password: String, autoRegister: Boolean): Boolean =
        attempt { api.signInWithPhone(phone, password, autoRegister) } != null

    suspend fun register(email: String, password: String): Registration {
        var confirm = false
        val session = attempt { api.register(email, password).also { confirm = it == null } }
        return when {
            session != null -> Registration.SIGNED_IN
            confirm -> Registration.CONFIRM_EMAIL
            else -> Registration.FAILED
        }
    }

    private suspend fun attempt(request: suspend () -> AccountSession?): AccountSession? {
        if (isSigningIn) return null
        isSigningIn = true
        errorMessage = null
        try {
            val result = request() ?: return null
            if (!vault.save(result)) {
                errorMessage = "登录信息保存失败，请重试。"
                return null
            }
            session = result
            return result
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            errorMessage = error.message ?: "登录没有完成，请重试。"
            return null
        } finally {
            isSigningIn = false
        }
    }

    fun signOut() {
        vault.delete()
        session = null
    }

    /** Permanently deletes the account after the password is confirmed again. */
    suspend fun deleteAccount(password: String) {
        api.deleteAccount(password)
        signOut()
    }
}
