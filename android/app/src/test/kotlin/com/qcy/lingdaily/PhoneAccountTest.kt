package com.qcy.lingdaily

import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.network.AccountSession
import com.qcy.lingdaily.core.network.AccountSignInResponse
import com.qcy.lingdaily.core.network.formatPhone
import com.qcy.lingdaily.core.network.normalizePhone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PhoneAccountTest {
    @Test
    fun normalizesNumbersLikeTheServer() {
        for (input in listOf("13800138000", " 138 0013 8000 ", "138-0013-8000", "8613800138000", "+86 13800138000", "008613800138000")) {
            assertEquals(input, "+8613800138000", normalizePhone(input))
        }
        assertEquals("+14155550100", normalizePhone("+1 (415) 555-0100"))
        for (input in listOf("", "12345", "23800138000", "1380013800", "+8612800138000", "abc", "+0123456789")) {
            assertNull(input, normalizePhone(input))
        }
    }

    @Test
    fun showsThePhoneInsteadOfTheInternalAddress() {
        val reply = AppJson.decodeFromString(AccountSignInResponse.serializer(), """
            {"sessionToken":"token","expiresAt":"2099-01-01T00:00:00.000Z",
             "account":{"id":"user","email":"8613800138000@phone.lingdaily.yasobi.xyz","phone":"+8613800138000","isPrivateEmail":false}}
        """.trimIndent())
        val session = reply.session()!!
        assertEquals("138 0013 8000", session.displayName)
        assertEquals("+14155550100", formatPhone("+14155550100"))
        // Sessions saved before phone accounts existed still load and show the email.
        val old = AppJson.decodeFromString(AccountSession.serializer(), """{"token":"t","userID":"u","expiresAt":"2099-01-01T00:00:00.000Z","email":"a@b.c"}""")
        assertEquals("a@b.c", old.displayName)
    }
}
