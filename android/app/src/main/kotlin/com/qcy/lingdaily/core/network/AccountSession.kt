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
    /** Set for accounts that sign in with a phone number (E.164, e.g. +8613800138000). */
    val phone: String? = null,
) {
    /** What the app shows as the signed-in account. */
    val displayName: String get() = phone?.let(::formatPhone) ?: email

    fun isUsable(now: Long = nowMillis()): Boolean =
        token.isNotEmpty() && token.length <= 4096 && token.none { it.isWhitespace() } && expiresAt > now
}

@Serializable
data class PasswordCredentials(val email: String, val password: String)

@Serializable
data class PhoneCredentials(
    val phone: String,
    val password: String,
    /** Sign-in only: a number without an account is registered with this password. */
    val autoRegister: Boolean? = null,
)

/** `+8613800138000` → `138 0013 8000`; other countries keep their code. */
fun formatPhone(phone: String): String {
    val china = Regex("^\\+86(1\\d{2})(\\d{4})(\\d{4})$").matchEntire(phone)
    return china?.destructured?.let { (a, b, c) -> "$a $b $c" } ?: phone
}

/** Same rule as the server's `normalizePhone`, so the button only enables for numbers it accepts. */
fun normalizePhone(input: String): String? {
    var value = input.trim().replace(Regex("[\\s\\-().]"), "")
    if (value.startsWith("00")) value = "+" + value.drop(2)
    if (Regex("^1[3-9]\\d{9}$").matches(value)) return "+86$value"
    if (Regex("^861[3-9]\\d{9}$").matches(value)) return "+$value"
    if (!Regex("^\\+[1-9]\\d{7,14}$").matches(value)) return null
    if (value.startsWith("+86") && !Regex("^\\+861[3-9]\\d{9}$").matches(value)) return null
    return value
}

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
    data class Account(val id: String, val email: String, val phone: String? = null)

    fun session(now: Long = nowMillis()): AccountSession? {
        val expiry = expiresAt?.let(IsoMillisSerializer::parse) ?: return null
        val session = AccountSession(sessionToken ?: return null, account?.id ?: return null, expiry, account.email, account.phone)
        return session.takeIf { it.isUsable(now) && it.userID.isNotEmpty() }
    }
}
