package com.qcy.lingdaily.ui.practice

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import com.qcy.lingdaily.app.PracticeStore
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.ReviewTarget
import com.qcy.lingdaily.core.network.PracticeNetworkException
import com.qcy.lingdaily.core.network.PracticeServing

/** One rehearsal on screen: the session, and the text-mode request in flight for it. */
class PracticeViewModel(
    session: PracticeSession,
    private val api: PracticeServing,
    private val store: PracticeStore,
    private val scope: CoroutineScope,
) {
    var session by mutableStateOf(session)
        private set
    var isLoading by mutableStateOf(false)
        private set
    var errorMessage by mutableStateOf<String?>(null)
        private set

    private var job: Job? = null
    private var generation = 0

    fun send(text: String): Boolean {
        session = session.submit(text) ?: return false
        store.save(session)
        requestPending()
        return true
    }

    fun beginRetry() {
        session = session.beginRetry()
        store.save(session)
    }

    fun cancelRetry() {
        session = session.cancelRetry()
        store.save(session)
    }

    fun advance() {
        session = session.advance()
        store.save(session)
        requestPending()
    }

    fun requestPending() {
        if (isLoading) return
        val request = session.pendingAIRequest ?: return
        errorMessage = null
        isLoading = true
        val current = ++generation
        job = scope.launch {
            try {
                val response = api.respond(request)
                if (generation != current) return@launch
                session = session.applyAIResponse(response) ?: throw PracticeNetworkException.invalidReply()
                store.save(session, collecting = response.data.feedback?.items.orEmpty())
                isLoading = false
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (generation != current) return@launch
                isLoading = false
                errorMessage = error.message
            }
        }
    }

    fun applyTranslation(translation: String, messageID: UUID) {
        session = session.applyTranslation(translation, messageID) ?: return
        store.save(session)
    }

    fun applyFeedbackMeaning(meaning: String, messageID: UUID) {
        session = session.applyFeedbackMeaning(meaning, messageID) ?: return
        store.save(session)
    }

    /** 再练一次: a fresh rehearsal of the same scenario, goal and level; the finished one stays in history. */
    fun restart(reviewItems: List<ReviewTarget>) {
        generation++
        job?.cancel()
        job = null
        isLoading = false
        errorMessage = null
        session = PracticeSession.start(session.scenario, goal = session.personalGoal, context = session.context, useAI = true,
            level = session.practiceLevel, attitude = session.partnerAttitude, temperament = session.partnerTemperament,
            reviewItems = reviewItems)
    }

    fun keepDraft(text: String) {
        session = session.keepDraft(text)
    }

    fun enterLive() {
        pause()
        session = session.beginLive()
    }

    fun enterText() {
        session = session.prepareText()
        requestPending()
    }

    fun updateLive(changed: PracticeSession) {
        session = changed
    }

    fun pause() {
        generation++
        job?.cancel()
        job = null
        isLoading = false
        if (session.pendingAIRequest != null) errorMessage = "AI 请求已暂停，点击重试继续。已发送的回答会保留。"
    }
}
