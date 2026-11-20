package com.qcy.lingdaily.app

import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import com.qcy.lingdaily.core.model.AILearningItem
import com.qcy.lingdaily.core.model.PracticeArchive
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.SavedExpression
import com.qcy.lingdaily.core.persistence.ArchiveFile

/** A user-visible change to the local archive, recorded so cloud sync can upload it. */
sealed interface ArchiveChange {
    data class Session(val id: UUID) : ArchiveChange
    data class SessionDeleted(val id: UUID) : ArchiveChange
    data class Expression(val key: String) : ArchiveChange
    data class ExpressionDeleted(val key: String) : ArchiveChange
    data class Scenario(val id: String) : ArchiveChange
    data class ScenarioDeleted(val id: String) : ArchiveChange
}

/**
 * The learner's rehearsals, 词库 and own scenarios on this device. Used on the main thread.
 * The archive is immutable, so each edit hands the newest copy to one writer thread; a Live
 * call saves a few times a second and must not wait for the disk.
 */
class PracticeStore(file: File) {
    var archive by mutableStateOf(PracticeArchive())
        private set
    var storageError by mutableStateOf<String?>(null)
        private set

    /** Set by `SyncEngine`; called after each local edit (never for merged cloud data). */
    var onChange: ((ArchiveChange) -> Unit)? = null
    var canWrite = true
        private set

    private val file = ArchiveFile(file)
    private val main = Handler(Looper.getMainLooper())
    private val writer = Executors.newSingleThreadExecutor { Thread(it, "lingdaily-archive") }
    private val unwritten = AtomicReference<PracticeArchive?>(null)

    init {
        try {
            archive = this.file.load()
        } catch (_: Exception) {
            canWrite = false
            storageError = "本机记录暂时无法读取。原文件已保留，本次体验不会覆盖它。"
        }
    }

    fun save(session: PracticeSession, collecting: List<AILearningItem> = emptyList()) {
        val merged = archive.sessions.firstOrNull { it.id == session.id }?.let(session::mergeSentenceReviews) ?: session
        val known = archive.expressions.map { it.id }.toSet()
        archive = archive.upsert(merged).collect(collecting, source = merged.scenario.title)
        persist()
        if (archive.sessions.any { it.id == merged.id }) onChange?.invoke(ArchiveChange.Session(merged.id))
        reportNewExpressions(known)
    }

    fun addScenario(scenario: PracticeScenario) {
        archive = archive.copy(scenarios = listOf(scenario) + archive.scenarios)
        persist()
        onChange?.invoke(ArchiveChange.Scenario(scenario.id))
    }

    fun removeScenario(id: String) {
        archive = archive.copy(scenarios = archive.scenarios.filter { it.id != id })
        persist()
        onChange?.invoke(ArchiveChange.ScenarioDeleted(id))
    }

    fun removeSession(id: UUID) {
        archive = archive.copy(sessions = archive.sessions.filter { it.id != id })
        persist()
        onChange?.invoke(ArchiveChange.SessionDeleted(id))
    }

    fun isSaved(text: String): Boolean {
        val key = SavedExpression.key(text)
        return archive.expressions.any { it.id == key }
    }

    fun toggleExpression(text: String, meaning: String, source: String) {
        archive = archive.toggleExpression(text, meaning, source)
        persist()
        val key = SavedExpression.key(text)
        onChange?.invoke(if (isSaved(text)) ArchiveChange.Expression(key) else ArchiveChange.ExpressionDeleted(key))
    }

    /** Adds words picked by hand (e.g. the podcast's terms) with their type; existing entries stay as they are. */
    fun collect(items: List<AILearningItem>, source: String) {
        val known = archive.expressions.map { it.id }.toSet()
        archive = archive.collect(items, source)
        persist()
        reportNewExpressions(known)
    }

    /** A sentence saved before its Chinese meaning arrived gets the meaning once it is known. */
    fun fillMeaning(text: String, meaning: String) {
        val key = SavedExpression.key(text)
        if (meaning.isEmpty() || archive.expressions.none { it.id == key && it.meaning.isEmpty() }) return
        archive = archive.copy(expressions = archive.expressions.map { if (it.id == key) it.copy(meaning = meaning) else it })
        persist()
        onChange?.invoke(ArchiveChange.Expression(key))
    }

    fun removeExpression(id: String) {
        archive = archive.copy(expressions = archive.expressions.filter { it.id != id })
        persist()
        onChange?.invoke(ArchiveChange.ExpressionDeleted(id))
    }

    /** Replaces local data with the merged cloud copy; not reported as a local edit. */
    fun replaceArchive(merged: PracticeArchive) {
        if (!canWrite || merged == archive) return
        archive = merged
        persist()
    }

    /** Removes this account's data from the device (sign-out or account deletion). */
    fun clearAll() {
        archive = PracticeArchive()
        persist()
    }

    fun retrySave() = persist()

    /** Waits briefly for the newest copy to reach the disk; called when the app leaves the screen. */
    fun flush() {
        runCatching { writer.submit {}.get(2, TimeUnit.SECONDS) }
    }

    private fun reportNewExpressions(known: Set<String>) {
        for (item in archive.expressions) if (item.id !in known) onChange?.invoke(ArchiveChange.Expression(item.id))
    }

    private fun persist() {
        if (!canWrite) return
        // Only the newest copy matters; a write already queued picks it up.
        if (unwritten.getAndSet(archive) == null) writer.execute(::write)
    }

    private fun write() {
        val snapshot = unwritten.getAndSet(null) ?: return
        val error = try {
            file.save(snapshot)
            null
        } catch (_: Exception) {
            "还没有保存到本机，请重试。退出 App 前请保留本次内容。"
        }
        main.post { storageError = error }
    }
}
