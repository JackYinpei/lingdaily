package com.qcy.lingdaily.core.network

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.encodeToString
import com.qcy.lingdaily.core.model.AppJson

private const val KEYSTORE = "AndroidKeyStore"
private const val TRANSFORMATION = "AES/GCM/NoPadding"
private const val IV_BYTES = 12

private fun keystoreKey(alias: String): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
        init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        generateKey()
    }
}

private fun encryptBytes(alias: String, plaintext: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, keystoreKey(alias))
    return cipher.iv + cipher.doFinal(plaintext)
}

private fun decryptBytes(alias: String, packed: ByteArray): ByteArray? {
    if (packed.size <= IV_BYTES) return null
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, keystoreKey(alias), GCMParameterSpec(128, packed, 0, IV_BYTES))
    return cipher.doFinal(packed, IV_BYTES, packed.size - IV_BYTES)
}

/**
 * Keeps the app session on this device only: encrypted with a key that never leaves the
 * Android Keystore, in app-private storage that is excluded from backup and device transfer.
 */
class SessionVault(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("account", Context.MODE_PRIVATE)

    fun load(): AccountSession? = runCatching {
        val bytes = Base64.decode(preferences.getString(ENTRY, null) ?: return null, Base64.NO_WRAP)
        val plain = decryptBytes(ALIAS, bytes) ?: return null
        AppJson.decodeFromString<AccountSession>(plain.decodeToString())
    }.getOrNull()

    fun save(session: AccountSession): Boolean = runCatching {
        val packed = encryptBytes(ALIAS, AppJson.encodeToString(session).toByteArray())
        preferences.edit().putString(ENTRY, Base64.encodeToString(packed, Base64.NO_WRAP)).commit()
    }.getOrDefault(false)

    fun delete() {
        preferences.edit().remove(ENTRY).apply()
    }

    private companion object {
        const val ALIAS = "lingdaily.account.session"
        const val ENTRY = "session"
    }
}

/**
 * Stores the learner's own provider keys and model IDs encrypted in `noBackupFilesDir`,
 * protected by an Android Keystore AES-256-GCM key.
 */
class AISettingsVault(context: Context) {
    private val file = File(context.applicationContext.noBackupFilesDir, "ai-settings.bin")

    fun load(): AISettings? = runCatching {
        if (!file.isFile) return null
        val plain = decryptBytes(ALIAS, file.readBytes()) ?: return null
        AppJson.decodeFromString<AISettings>(plain.decodeToString())
    }.getOrNull()

    fun save(settings: AISettings): Boolean = runCatching {
        file.parentFile?.mkdirs()
        val packed = encryptBytes(ALIAS, AppJson.encodeToString(settings).toByteArray())
        val temp = File(file.parentFile, "${file.name}.tmp")
        temp.writeBytes(packed)
        if (!temp.renameTo(file)) {
            temp.copyTo(file, overwrite = true)
            temp.delete()
        }
        true
    }.getOrDefault(false)

    fun delete() {
        runCatching { file.delete() }
    }

    private companion object {
        const val ALIAS = "lingdaily.ai.settings"
    }
}
