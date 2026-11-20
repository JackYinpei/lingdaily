package com.qcy.lingdaily.core.persistence

import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.Millis
import com.qcy.lingdaily.core.model.PracticeArchive
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.SavedExpression
import com.qcy.lingdaily.core.model.nowMillis

/**
 * Cloud copy of the signed-in account, as returned by `/api/ios/sync`.
 * Rehearsals, vocabulary and own scenarios live in the same Supabase tables as the web app.
 */
@Serializable
data class SyncSnapshot(
    val sessions: List<Session> = emptyList(),
    val expressions: List<Expression> = emptyList(),
    val scenarios: List<PracticeScenario> = emptyList(),
    val rejectedSessions: List<String>? = null,
    /** Sessions whose cloud copy is the version this device sent in `knownSessions`; not repeated in `sessions`. */
    val unchangedSessions: List<String>? = null,
) {
    @Serializable
    data class Session(val id: String, val session: PracticeSession)

    @Serializable
    data class Expression(
        val key: String, val text: String, val meaning: String, val source: String,
        val createdAt: Millis, val kind: String? = null,
    )
}

/** Local changes not yet in the cloud. */
@Serializable
data class SyncChanges(
    val sessions: Bucket<PracticeSession> = Bucket(),
    val expressions: Bucket<Expression> = Bucket(),
    val scenarios: Bucket<PracticeScenario> = Bucket(),
    /** Version (updatedAt, epoch ms) of every session on this device, so the server skips sending them back. */
    val knownSessions: Map<String, Long>? = null,
) {
    @Serializable
    data class Bucket<Item>(val upsert: List<Item> = emptyList(), val delete: List<String> = emptyList()) {
        val isEmpty: Boolean get() = upsert.isEmpty() && delete.isEmpty()
    }

    @Serializable
    data class Expression(
        val text: String, val meaning: String, val source: String,
        val createdAt: Millis, val kind: String? = null,
    )

    val isEmpty: Boolean get() = sessions.isEmpty && expressions.isEmpty && scenarios.isEmpty
}

/**
 * What one sync request may carry. Mirrors the server's limits; the byte budget also
 * stays below common proxy body limits, so a large first upload goes out in several rounds.
 */
data class SyncBatchLimits(
    val sessions: Int = 100,
    val sessionDeletes: Int = 200,
    val expressions: Int = 500,
    val expressionDeletes: Int = 500,
    val scenarios: Int = 50,
    val scenarioDeletes: Int = 50,
    /** Leaves room for vocabulary, scenarios and `knownSessions`, keeping a request under 1 MB. */
    val sessionBytes: Int = 600 * 1024,
    /** The server returns at most its newest 500 sessions; anything not listed simply comes back in full. */
    val knownSessions: Int = 500,
)

/**
 * Bookkeeping for one account: what the cloud had at the last sync and what
 * still has to be sent. Changes are tracked explicitly (not by comparing
 * timestamps), so a round trip can never make an item look modified again.
 */
@Serializable
data class SyncLedger(
    val ownerUserID: String? = null,
    val lastSyncedAt: Millis? = null,
    val synced: Keys = Keys(),
    val dirty: Keys = Keys(),
    val deleted: Keys = Keys(),
    /** Sessions the server can never store (invalid or too large); kept locally, not retried until edited. */
    val rejectedSessions: Set<String> = emptySet(),
) {
    @Serializable
    data class Keys(
        val sessions: Set<String> = emptySet(),
        val expressions: Set<String> = emptySet(),
        val scenarios: Set<String> = emptySet(),
    ) {
        val count: Int get() = sessions.size + expressions.size + scenarios.size
    }

    data class Merged(val ledger: SyncLedger, val archive: PracticeArchive)

    val pendingCount: Int get() = dirty.count + deleted.count

    fun sessionChanged(id: UUID): SyncLedger {
        val key = sessionKey(id)
        return copy(dirty = dirty.copy(sessions = dirty.sessions + key),
            deleted = deleted.copy(sessions = deleted.sessions - key), rejectedSessions = rejectedSessions - key)
    }

    // Deletions are always sent: the item may already be on the server from an in-flight upload.
    fun sessionDeleted(id: UUID): SyncLedger {
        val key = sessionKey(id)
        return copy(dirty = dirty.copy(sessions = dirty.sessions - key), deleted = deleted.copy(sessions = deleted.sessions + key))
    }

    fun expressionChanged(key: String): SyncLedger = copy(
        dirty = dirty.copy(expressions = dirty.expressions + key), deleted = deleted.copy(expressions = deleted.expressions - key))

    fun expressionDeleted(key: String): SyncLedger = copy(
        dirty = dirty.copy(expressions = dirty.expressions - key), deleted = deleted.copy(expressions = deleted.expressions + key))

    fun scenarioChanged(id: String): SyncLedger = copy(
        dirty = dirty.copy(scenarios = dirty.scenarios + id), deleted = deleted.copy(scenarios = deleted.scenarios - id))

    fun scenarioDeleted(id: String): SyncLedger = copy(
        dirty = dirty.copy(scenarios = dirty.scenarios - id), deleted = deleted.copy(scenarios = deleted.scenarios + id))

    /**
     * After a lost ledger write: everything on this device is sent again, and the
     * deletes the saved ledger still knew about are kept (resending a delete is harmless).
     */
    fun readopt(owner: String, archive: PracticeArchive): SyncLedger {
        val adopted = adopting(owner, archive)
        return adopted.copy(deleted = Keys(
            sessions = deleted.sessions - adopted.dirty.sessions,
            expressions = deleted.expressions - adopted.dirty.expressions,
            scenarios = deleted.scenarios - adopted.dirty.scenarios,
        ))
    }

    /**
     * The next request's worth of pending changes. Whatever does not fit stays
     * pending and goes out in the following round.
     */
    fun changes(archive: PracticeArchive, limits: SyncBatchLimits = SyncBatchLimits()): SyncChanges {
        val upsert = mutableListOf<PracticeSession>()
        var bytes = 0
        for (session in archive.sessions) {
            if (sessionKey(session.id) !in dirty.sessions) continue
            if (upsert.size >= limits.sessions) break
            val size = AppJson.encodeToString(session).toByteArray().size
            // A session larger than the whole budget still goes alone, so the server can reject it.
            if (upsert.isNotEmpty() && bytes + size > limits.sessionBytes) break
            upsert += session
            bytes += size
        }
        return SyncChanges(
            sessions = SyncChanges.Bucket(upsert, deleted.sessions.sorted().take(limits.sessionDeletes)),
            expressions = SyncChanges.Bucket(
                archive.expressions.filter { it.id in dirty.expressions }.take(limits.expressions)
                    .map { SyncChanges.Expression(it.text, it.meaning, it.source, it.createdAt, it.kind) },
                deleted.expressions.sorted().take(limits.expressionDeletes)),
            scenarios = SyncChanges.Bucket(
                archive.scenarios.filter { it.id in dirty.scenarios }.take(limits.scenarios),
                deleted.scenarios.sorted().take(limits.scenarioDeletes)),
            knownSessions = buildMap {
                for (session in archive.sessions.take(limits.knownSessions)) putIfAbsent(sessionKey(session.id), session.updatedAt)
            },
        )
    }

    /**
     * Applies a successful round trip. `sent` is what was uploaded; anything
     * changed locally while the request was in flight stays pending.
     */
    fun merge(snapshot: SyncSnapshot, sent: SyncChanges, archive: PracticeArchive, now: Long = nowMillis()): Merged {
        val dirtySessions = dirty.sessions.toMutableSet()
        val dirtyExpressions = dirty.expressions.toMutableSet()
        val dirtyScenarios = dirty.scenarios.toMutableSet()
        val rejected = rejectedSessions.toMutableSet()

        val sentSessions = buildMap { for (session in sent.sessions.upsert) putIfAbsent(sessionKey(session.id), session.updatedAt) }
        for (session in archive.sessions) {
            val key = sessionKey(session.id)
            if (sentSessions[key] == session.updatedAt) dirtySessions -= key
        }
        for (key in snapshot.rejectedSessions.orEmpty().map { it.lowercase() }) {
            if (key in sentSessions) {
                dirtySessions -= key
                rejected += key
            }
        }
        dirtyExpressions -= sent.expressions.upsert.map { SavedExpression.key(it.text) }.toSet()
        dirtyScenarios -= sent.scenarios.upsert.map { it.id }.toSet()
        val deletedSessions = deleted.sessions - sent.sessions.delete.toSet()
        val deletedExpressions = deleted.expressions - sent.expressions.delete.toSet()
        val deletedScenarios = deleted.scenarios - sent.scenarios.delete.toSet()

        // Sessions the server did not repeat are this device's own copies (same version).
        val unchanged = snapshot.unchangedSessions.orEmpty().map { it.lowercase() }.toSet()
        val held = archive.sessions.filter { sessionKey(it.id) in unchanged }
            .map { SyncSnapshot.Session(sessionKey(it.id), it) }
        // Sessions: remote wins unless this device still has unsent edits or a pending delete.
        val remoteSessions = (snapshot.sessions + held).filter { it.session.isValid && it.session.userTurns > 0 }
        val remoteKeys = remoteSessions.map { it.id.lowercase() }.toSet()
        val sessions = archive.sessions.filter { session ->
            val key = sessionKey(session.id)
            if (key in dirtySessions || key in remoteKeys || key in rejected) return@filter true
            if (key in synced.sessions) return@filter false // deleted on another device or the web
            dirtySessions += key
            true
        }.toMutableList()
        for (remote in remoteSessions) {
            val key = remote.id.lowercase()
            if (key in dirtySessions || key in deletedSessions) continue
            sessions.removeAll { sessionKey(it.id) == key }
            sessions += remote.session
        }

        // Vocabulary: union by key; removals elsewhere apply unless edited here.
        val remoteExpressions = buildMap { for (item in snapshot.expressions) putIfAbsent(item.key, item) }
        val expressions = archive.expressions.filter { item ->
            if (item.id in dirtyExpressions || item.id in remoteExpressions) return@filter true
            if (item.id in synced.expressions) return@filter false
            dirtyExpressions += item.id
            true
        }.toMutableList()
        val localKeys = expressions.map { it.id }.toSet()
        for (remote in snapshot.expressions) {
            if (remote.key in localKeys || remote.key in deletedExpressions) continue
            expressions += SavedExpression(remote.key, remote.text, remote.meaning, remote.source, remote.createdAt, remote.kind)
        }

        // Own scenarios.
        val remoteScenarios = buildMap { for (scenario in snapshot.scenarios) putIfAbsent(scenario.id, scenario) }
        val scenarios = archive.scenarios.filter { scenario ->
            if (scenario.id in dirtyScenarios || scenario.id in remoteScenarios) return@filter true
            if (scenario.id in synced.scenarios) return@filter false
            dirtyScenarios += scenario.id
            true
        }.toMutableList()
        for (remote in snapshot.scenarios) {
            if (remote.id in deletedScenarios) continue
            val index = scenarios.indexOfFirst { it.id == remote.id }
            if (index < 0) scenarios += remote
            else if (remote.id !in dirtyScenarios) scenarios[index] = remote
        }

        return Merged(
            ledger = copy(
                lastSyncedAt = now,
                synced = Keys(remoteKeys, remoteExpressions.keys.toSet(), remoteScenarios.keys.toSet()),
                dirty = Keys(dirtySessions, dirtyExpressions, dirtyScenarios),
                deleted = Keys(deletedSessions, deletedExpressions, deletedScenarios),
                rejectedSessions = rejected,
            ),
            archive = archive.copy(
                sessions = sessions.sortedByDescending { it.updatedAt },
                expressions = expressions.sortedByDescending { it.createdAt },
                scenarios = scenarios,
            ),
        )
    }

    companion object {
        fun sessionKey(id: UUID): String = id.toString().lowercase()

        /** First sync for an account: everything already on this device is uploaded into it. */
        fun adopting(owner: String, archive: PracticeArchive): SyncLedger = SyncLedger(
            ownerUserID = owner,
            dirty = Keys(
                sessions = archive.sessions.map { sessionKey(it.id) }.toSet(),
                expressions = archive.expressions.map { it.id }.toSet(),
                scenarios = archive.scenarios.map { it.id }.toSet(),
            ),
        )
    }
}
