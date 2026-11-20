package com.qcy.lingdaily

import java.io.File
import java.nio.file.Files
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.PracticeArchive
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.PracticeStep
import com.qcy.lingdaily.core.model.SavedExpression
import com.qcy.lingdaily.core.model.summaryLines
import com.qcy.lingdaily.core.persistence.SyncBatchLimits
import com.qcy.lingdaily.core.persistence.SyncChanges
import com.qcy.lingdaily.core.persistence.SyncLedger
import com.qcy.lingdaily.core.persistence.SyncLedgerFile
import com.qcy.lingdaily.core.persistence.SyncSnapshot

class CloudSyncTest {
    private val base = 1_790_000_000_000L

    private fun scenario(id: String = "custom-0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D") = PracticeScenario(
        id, "退押金", "确认时间", "日常", "text.bubble", "Morgan", "房东", "你下周搬走。",
        (0 until 3).map { PracticeStep("step-$it", "目标$it", "Prompt $it?", "译文", "提示", "deposit", "Example $it", "示例") })

    private fun session(answer: String = "I need two more days.", offset: Long = 0): PracticeSession =
        PracticeSession.start(scenario(), now = base).submit(answer, now = base + offset * 1000).must()

    private fun expression(text: String) = SavedExpression(SavedExpression.key(text), text, "意思", "退押金", base, "phrase")

    /** Goes through the real wire format so date and id coding are covered too. */
    private fun snapshot(sessions: List<PracticeSession> = emptyList(), expressions: List<SavedExpression> = emptyList(),
                         scenarios: List<PracticeScenario> = emptyList(), rejected: List<String>? = null,
                         unchanged: List<String>? = null): SyncSnapshot {
        val wire = SyncSnapshot(
            sessions.map { SyncSnapshot.Session(it.id.toString().lowercase(), it) },
            expressions.map { SyncSnapshot.Expression(it.id, it.text, it.meaning, it.source, it.createdAt, it.kind) },
            scenarios, rejected, unchanged)
        return AppJson.decodeFromString(AppJson.encodeToString(wire))
    }

    @Test
    fun firstSyncUploadsEverythingAlreadyOnTheDevice() {
        val archive = PracticeArchive().upsert(session()).copy(expressions = listOf(expression("on track")), scenarios = listOf(scenario()))
        val ledger = SyncLedger.adopting("user-a", archive)
        val changes = ledger.changes(archive)
        assertEquals(1, changes.sessions.upsert.size)
        assertEquals(listOf("on track"), changes.expressions.upsert.map { it.text })
        assertEquals(listOf(scenario().id), changes.scenarios.upsert.map { it.id })
        val merged = ledger.merge(snapshot(archive.sessions, archive.expressions, archive.scenarios), changes, archive, now = base)
        assertEquals(0, merged.ledger.pendingCount)
        assertEquals(3, merged.ledger.synced.count)
        assertEquals(base, merged.ledger.lastSyncedAt)
        assertEquals(archive, merged.archive)
        assertTrue(merged.ledger.changes(merged.archive).isEmpty)
    }

    @Test
    fun editDuringUploadStaysPendingAndIsNotOverwritten() {
        val original = session()
        var archive = PracticeArchive().upsert(original)
        var ledger = SyncLedger.adopting("user-a", archive)
        val changes = ledger.changes(archive)
        val edited = original.beginRetry(now = base + 30_000)
        archive = archive.upsert(edited)
        ledger = ledger.sessionChanged(edited.id)
        val merged = ledger.merge(snapshot(listOf(original)), changes, archive)
        assertEquals(PracticeSession.Phase.RETRY, merged.archive.sessions.first().phase)
        assertEquals(setOf(SyncLedger.sessionKey(original.id)), merged.ledger.dirty.sessions)
    }

    @Test
    fun deletionsElsewhereApplyButPendingLocalDeletesAreNotResurrected() {
        val kept = session("Kept")
        var archive = PracticeArchive().upsert(kept).copy(expressions = listOf(expression("deadline"), expression("on track")))
        var ledger = SyncLedger.adopting("user-a", archive)
        ledger.merge(snapshot(listOf(kept), archive.expressions), ledger.changes(archive), archive).let { ledger = it.ledger; archive = it.archive }

        // The web deleted "deadline"; meanwhile this device deleted "on track" but has not uploaded it yet.
        archive = archive.copy(expressions = archive.expressions.filter { it.id != "on track" })
        ledger = ledger.expressionDeleted("on track")
        ledger.merge(snapshot(listOf(kept), listOf(expression("on track"))), SyncChanges(), archive).let { ledger = it.ledger; archive = it.archive }
        assertTrue(archive.expressions.isEmpty())
        assertEquals(listOf("on track"), ledger.changes(archive).expressions.delete)

        // Session removed on another device.
        archive = ledger.merge(snapshot(), SyncChanges(), archive).archive
        assertTrue(archive.sessions.isEmpty())
    }

    @Test
    fun downloadsNewCloudItemsWithoutMarkingThemForUpload() {
        val remote = session("From the web")
        val merged = SyncLedger.adopting("user-a", PracticeArchive())
            .merge(snapshot(listOf(remote), listOf(expression("deadline")), listOf(scenario())), SyncChanges(), PracticeArchive())
        assertEquals(listOf(remote), merged.archive.sessions)
        assertEquals(listOf("deadline"), merged.archive.expressions.map { it.id })
        assertEquals(listOf(scenario()), merged.archive.scenarios)
        assertEquals(0, merged.ledger.pendingCount)
    }

    @Test
    fun rejectedSessionIsKeptLocallyAndNotRetriedUntilEdited() {
        val local = session()
        var archive = PracticeArchive().upsert(local)
        var ledger = SyncLedger.adopting("user-a", archive)
        ledger.merge(snapshot(rejected = listOf(local.id.toString().uppercase())), ledger.changes(archive), archive)
            .let { ledger = it.ledger; archive = it.archive }
        assertEquals(1, archive.sessions.size)
        assertTrue(ledger.changes(archive).isEmpty)
        ledger.merge(snapshot(), SyncChanges(), archive).let { ledger = it.ledger; archive = it.archive }
        assertEquals("A rejected session is never treated as deleted remotely", 1, archive.sessions.size)
        assertEquals(1, ledger.sessionChanged(local.id).changes(archive).sessions.upsert.size)
    }

    @Test
    fun largeUploadGoesOutInRoundsAndUnsentSessionsStayLocal() {
        var archive = PracticeArchive()
        for (offset in 0 until 5) archive = archive.upsert(session("Answer $offset", offset.toLong()))
        var ledger = SyncLedger.adopting("user-a", archive)
        val uploaded = mutableListOf<PracticeSession>()
        for (round in 1..3) {
            val changes = ledger.changes(archive, SyncBatchLimits(sessions = 2))
            assertEquals(if (round < 3) 2 else 1, changes.sessions.upsert.size)
            uploaded += changes.sessions.upsert
            ledger.merge(snapshot(uploaded), changes, archive).let { ledger = it.ledger; archive = it.archive }
            assertEquals("Sessions not uploaded yet are never dropped", 5, archive.sessions.size)
            assertEquals(5 - uploaded.size, ledger.pendingCount)
        }
        assertEquals(archive.sessions.map { it.id }.toSet(), uploaded.map { it.id }.toSet())

        val again = SyncLedger.adopting("user-a", archive)
        assertEquals("An oversized session still goes alone", 1, again.changes(archive, SyncBatchLimits(sessionBytes = 1)).sessions.upsert.size)
        assertEquals("Only the newest versions are listed",
            archive.sessions.take(2).map { SyncLedger.sessionKey(it.id) }.toSet(),
            again.changes(archive, SyncBatchLimits(knownSessions = 2)).knownSessions?.keys)
    }

    @Test
    fun unchangedSessionsKeepTheLocalCopyAndRemoteDeletionsStillApply() {
        val kept = session("Kept")
        val removed = session("Removed elsewhere")
        var archive = PracticeArchive().upsert(kept).upsert(removed)
        var ledger = SyncLedger.adopting("user-a", archive)
        val sent = ledger.changes(archive)
        assertEquals(kept.updatedAt, sent.knownSessions?.get(SyncLedger.sessionKey(kept.id)))
        ledger.merge(snapshot(listOf(kept, removed)), sent, archive).let { ledger = it.ledger; archive = it.archive }

        val changes = ledger.changes(archive)
        assertEquals(2, changes.knownSessions?.size)
        ledger.merge(snapshot(unchanged = listOf(kept.id.toString().uppercase())), changes, archive).let { ledger = it.ledger; archive = it.archive }
        assertEquals(listOf(kept), archive.sessions)
        assertEquals(setOf(SyncLedger.sessionKey(kept.id)), ledger.synced.sessions)
        assertEquals(0, ledger.pendingCount)
    }

    @Test
    fun readoptAfterLostLedgerWriteResendsEverythingAndKeepsPendingDeletes() {
        val archive = PracticeArchive().upsert(session()).copy(expressions = listOf(expression("on track")))
        val kept = session("Kept elsewhere.")
        val key = SyncLedger.sessionKey(archive.sessions[0].id)
        val ledger = SyncLedger(ownerUserID = "user-a", synced = SyncLedger.Keys(sessions = setOf(key)))
            .sessionDeleted(kept.id).expressionDeleted(SavedExpression.key("on track")).readopt("user-a", archive)
        assertEquals("user-a", ledger.ownerUserID)
        assertEquals(setOf(key), ledger.dirty.sessions)
        assertEquals(setOf("on track"), ledger.dirty.expressions)
        assertEquals(setOf(SyncLedger.sessionKey(kept.id)), ledger.deleted.sessions)
        assertTrue(ledger.deleted.expressions.isEmpty())
        assertTrue(ledger.synced.sessions.isEmpty())
    }

    @Test
    fun ledgerFileMarksAFailedWriteStaleUntilACurrentLedgerIsSaved() {
        val directory = Files.createTempDirectory("lingdaily-ledger").toFile()
        try {
            var stale = false
            // A regular file where the ledger's folder should be makes every write fail.
            val blocker = File(directory, "blocked").apply { writeText("") }
            val ledger = SyncLedger(ownerUserID = "user-a").expressionChanged("on track")
            val broken = SyncLedgerFile(File(blocker, "sync-ledger.json"), { stale }, { stale = it })
            assertFalse(broken.isStale)
            assertThrows(Exception::class.java) { broken.save(ledger) }
            assertTrue(broken.isStale)
            assertEquals(SyncLedger(), broken.load())

            val file = SyncLedgerFile(File(directory, "nested/sync-ledger.json"), { stale }, { stale = it })
            file.save(ledger, current = false)
            assertTrue(file.isStale)
            assertEquals(ledger, file.load())
            file.save(ledger)
            assertFalse(file.isStale)
            assertEquals(ledger, file.load())
        } finally {
            directory.deleteRecursively()
        }
    }

    // ---- The same JSON as the iOS app ----

    /** JSON equality where 1 and 1.0 are the same number, as they are to every JSON reader. */
    private fun normalized(element: JsonElement): JsonElement = when (element) {
        is JsonObject -> JsonObject(element.mapValues { normalized(it.value) })
        is JsonArray -> JsonArray(element.map(::normalized))
        is JsonPrimitive -> if (!element.isString && element.doubleOrNull != null) JsonPrimitive(element.doubleOrNull) else element
    }

    /**
     * `ios-sync-changes.json` is what the iOS app's own encoder (`CloudSyncCoding.encoder`) wrote for
     * a text rehearsal, a finished Live rehearsal, 词库 and an own scenario. Android has to read all
     * of it and write the very same JSON back, or a rehearsal synced between the two apps would
     * lose or corrupt fields.
     */
    @Test
    fun readsAndRewritesTheIOSWireFormatWithoutChangingIt() {
        val raw = javaClass.getResource("/ios-sync-changes.json")!!.readText()
        val changes = AppJson.decodeFromString<SyncChanges>(raw)
        assertEquals(normalized(AppJson.parseToJsonElement(raw)),
            normalized(AppJson.encodeToJsonElement(SyncChanges.serializer(), changes)))

        // The text is case-preserving: ids are written upper case like Swift's UUID.
        val encoded = AppJson.encodeToString(changes)
        val firstID = AppJson.parseToJsonElement(raw).jsonObject.getValue("sessions").jsonObject
            .getValue("upsert").jsonArray[0].jsonObject.getValue("id").jsonPrimitive.content
        assertTrue(encoded.contains("\"$firstID\""))

        val sessions = changes.sessions.upsert
        assertEquals(2, sessions.size)
        assertTrue(sessions.all { it.isValid })
        val live = sessions.first { it.live != null }
        assertEquals(PracticeSession.Phase.COMPLETED, live.phase)
        assertEquals(listOf(0, 1, 2), live.live?.completedTasks)
        assertEquals("gemini-live-test", live.live?.model)
        assertEquals("你好。", live.messages.first().translation)
        assertEquals(listOf("landlord", "wear and tear"), live.collectedItems.map { it.text })
        assertEquals("I'd like my deposit back.", live.summaryLines.single().text)
        assertEquals("tough", live.requestAttitude)
        assertEquals(1_790_000_109_123L, live.updatedAt)

        val text = sessions.first { it.live == null }
        assertEquals(1, text.stepIndex)
        assertEquals(1, text.retryCount)
        assertEquals("  half typed ", text.draft)
        assertEquals("challenge", text.level)
        assertEquals(2, text.partnerTemperament.pushback)
        assertEquals(-1, text.partnerTemperament.emotion)
        assertEquals(listOf("scratch"), text.collectedItems.map { it.text })
        assertEquals("deposit", text.reviewItems?.single()?.text)
        // Still a usable rehearsal here: the pending request the server expects next.
        assertEquals(com.qcy.lingdaily.core.model.AIPracticeAction.ADVANCE, text.pendingAIRequest?.action)

        assertEquals(listOf(null, "word"), changes.expressions.upsert.map { it.kind })
        assertEquals("觉得自己没错，嘴硬", changes.scenarios.upsert.single().persona)
        assertEquals(setOf(text.updatedAt, live.updatedAt), changes.knownSessions?.values?.toSet())
    }
}
