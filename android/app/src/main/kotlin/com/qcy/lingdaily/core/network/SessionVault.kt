package com.qcy.lingdaily.core.network

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.encodeToString
import com.qcy.lingdaily.core.model.AppJson

/**
 * Keeps the app session on this device only: encrypted with a key that never leaves the
 * Android Keystore, in app-private storage that is excluded from backup and device transfer.
 */
class SessionVault(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("account", Context.MODE_PRIVATE)

    fun load(): AccountSession? = runCatching {
        val bytes = Base64.decode(preferences.getString(ENTRY, null) ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_BYTES))
        AppJson.decodeFromString<AccountSession>(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES).decodeToString())
    }.getOrNull()

    fun save(session: AccountSession): Boolean = runCatching {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(AppJson.encodeToString(session).toByteArray())
        preferences.edit().putString(ENTRY, Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)).commit()
    }.getOrDefault(false)

    fun delete() {
        preferences.edit().remove(ENTRY).apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build())
            generateKey()
        }
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "lingdaily.account.session"
        const val ENTRY = "session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}
