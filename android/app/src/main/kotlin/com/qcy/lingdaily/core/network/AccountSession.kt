package com.qcy.lingdaily.core.network

import kotlinx.serialization.Serializable
import com.qcy.lingdaily.core.model.IsoMillisSerializer
import com.qcy.lingdaily.core.model.Millis
import com.qcy.lingdaily.core.model.nowMillis

/**
 * The server-issued app session after signing in. Only the token is a credential;
 * the email is kept to show which account is signed in.
 */
@Serializable
data class AccountSession(
    val token: String,
    /** Supabase user id shared with the web and iOS apps; cloud data on this device belongs to it. */
    val userID: String,
    val expiresAt: Millis,
    val email: String,
) {
    fun isUsable(now: Long = nowMillis()): Boolean =
        token.isNotEmpty() && token.length <= 4096 && token.none { it.isWhitespace() } && expiresAt > now
}

@Serializable
data class PasswordCredentials(val email: String, val password: String)

@Serializable
data class PasswordConfirmation(val password: String)

/** Reply of the Android sign-in and registration routes. */
@Serializable
data class AccountSignInResponse(
    val sessionToken: String? = null,
    val expiresAt: String? = null,
    val account: Account? = null,
    /** Registration only: the address has to be confirmed by email before signing in. */
    val confirmationRequired: Boolean = false,
) {
    @Serializable
    data class Account(val id: String, val email: String)

    fun session(now: Long = nowMillis()): AccountSession? {
        val expiry = expiresAt?.let(IsoMillisSerializer::parse) ?: return null
        val session = AccountSession(sessionToken ?: return null, account?.id ?: return null, expiry, account.email)
        return session.takeIf { it.isUsable(now) && it.userID.isNotEmpty() }
    }
}

/**
 * Pairing with the local AI service of `npm run ios:dev`, bundled into Debug builds only.
 * It reaches this machine's loopback through `adb reverse tcp:8000 tcp:8000`, so the
 * pairing token never leaves the USB cable or the emulator. Public servers use the
 * signed-in account session instead.
 */
data class DevConnection(val baseURL: String, val accessToken: String) {
    val isValid: Boolean
        get() = baseURL.removeSuffix("/") == "http://localhost:8000"
            && accessToken.length == 64 && accessToken.all { it in "0123456789abcdef" }
}
