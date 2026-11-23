package com.qcy.lingdaily.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import com.qcy.lingdaily.core.network.AccountSession
import com.qcy.lingdaily.core.network.PracticeApiClient
import com.qcy.lingdaily.core.network.SessionVault

/**
 * Signed-in state for the production service. The session token lives encrypted on this
 * device; practice data syncs to this account through `SyncEngine`.
 *
 * Android signs in with the email and password of the LingDaily web account (the iOS app
 * uses Sign in with Apple); both receive the same kind of app session from the server.
 */
class AccountStore(
    private val vault: SessionVault,
    /** Debug builds paired with `npm run ios:dev` need no account. */
    val usesLocalDevelopment: Boolean,
) {
    enum class Registration { SIGNED_IN, CONFIRM_EMAIL, FAILED }

    var session by mutableStateOf(vault.load()?.takeIf { it.isUsable() })
        private set
    var isSigningIn by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)

    lateinit var api: PracticeApiClient

    val canPractice: Boolean get() = usesLocalDevelopment || session != null

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
