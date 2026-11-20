package com.qcy.lingdaily.core.model

import java.util.UUID
import kotlinx.serialization.Serializable

/** Kept separately from in-call corrections: the original transcript is never replaced. */
@Serializable
data class SentenceReviewRecord(
    val id: Uuid,
    val original: String,
    val revised: String,
    val meaning: String,
    val note: String,
)

@Serializable
data class SentenceReviewRequest(
    val requestId: Uuid,
    val sessionId: Uuid,
    val scenario: AIPracticeRequest.Scenario,
    val messages: List<Message>,
    val model: String? = null,
) {
    @Serializable
    data class Message(val messageId: Uuid, val text: String, val precedingPartner: String)
}

@Serializable
data class SentenceReviewResponse(val requestId: Uuid, val items: List<Item>) {
    @Serializable
    data class Item(val messageId: Uuid, val revised: String, val meaning: String, val note: String)

    fun records(request: SentenceReviewRequest): List<SentenceReviewRecord>? {
        if (requestId != request.requestId || items.size != request.messages.size
            || items.map { it.messageId }.toSet().size != items.size) return null
        return request.messages.map { message ->
            val item = items.firstOrNull { it.messageId == message.messageId } ?: return null
            if (item.revised.length > 8000 || item.meaning.length > 16000 || item.note.length > 500) return null
            val consistent = if (item.revised.isEmpty()) item.meaning.isEmpty() && item.note.isEmpty()
            else item.revised.isNotBlank() && item.meaning.isNotEmpty() && item.note.isNotEmpty()
            if (!consistent) return null
            SentenceReviewRecord(message.messageId, message.text, item.revised, item.meaning, item.note)
        }
    }
}

val PracticeSession.learnerMessages: List<PracticeMessage>
    get() = messages.filter { it.role == PracticeMessage.Role.USER && it.text.isNotBlank() }

fun PracticeSession.sentenceReview(message: PracticeMessage): SentenceReviewRecord? =
    sentenceReviews?.firstOrNull { it.id == message.id && it.original == message.text }

/** Bounded batches cover every turn over successive calls, including retries and short replies. */
val PracticeSession.nextSentenceReview: SentenceReviewRequest?
    get() {
        if (!isAI || phase != PracticeSession.Phase.COMPLETED) return null
        val batch = mutableListOf<SentenceReviewRequest.Message>()
        var length = 0
        var partner = ""
        for (message in messages) {
            if (message.role == PracticeMessage.Role.PARTNER) {
                partner = message.text.prefix(800)
                continue
            }
            if (message.text.isBlank() || sentenceReview(message) != null) continue
            val count = message.text.length
            if (batch.isNotEmpty() && (batch.size == 4 || length + count > 16000)) break
            batch += SentenceReviewRequest.Message(message.id, message.text, partner)
            length += count
        }
        if (batch.isEmpty()) return null
        return SentenceReviewRequest(UUID.randomUUID(), id, AIPracticeRequest.Scenario(scenario), batch)
    }
