package com.qcy.lingdaily.core.model

import java.util.UUID
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.descriptors.element
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.encoding.encodeStructure
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import com.qcy.lingdaily.core.realtime.LiveCorrectionMatcher

@Serializable
data class PracticeStep(
    val id: String,
    val goal: String,
    val prompt: String,
    val translation: String,
    val hint: String,
    val keywords: String,
    val expression: String,
    val meaning: String,
)

@Serializable
data class PracticeScenario(
    val id: String,
    val title: String,
    val subtitle: String,
    val category: String,
    val symbol: String,
    val partner: String,
    val partnerRole: String,
    val setting: String,
    val steps: List<PracticeStep>,
    /** How the partner treats the learner (Chinese), e.g. 嘴硬、反怪你. Absent in older scenarios. */
    val persona: String? = null,
) {
    /** The same scenario with a learner-edited persona, used for one rehearsal only. */
    fun withPersona(text: String?): PracticeScenario = copy(persona = cleanPersona(text))

    companion object {
        const val PERSONA_LIMIT = 120

        /** A trimmed, bounded persona; null when empty. */
        fun cleanPersona(text: String?): String? = text.orEmpty().trim().prefix(PERSONA_LIMIT).ifEmpty { null }
    }
}

/** How hard the partner makes it: vocabulary, sentence length and follow-up pressure. */
enum class PracticeLevel(val raw: String, val label: String) {
    EASY("easy", "轻松"), STANDARD("standard", "标准"), CHALLENGE("challenge", "挑战");

    companion object {
        const val KEY = "practiceLevel"
        fun from(raw: String?): PracticeLevel? = entries.firstOrNull { it.raw == raw }
    }
}

/** The older three-way choice, still read from rehearsals synced from iOS 1.7. */
enum class PracticeAttitude(val raw: String) {
    FRIENDLY("friendly"), NATURAL("natural"), TOUGH("tough");

    companion object {
        fun from(raw: String?): PracticeAttitude? = entries.firstOrNull { it.raw == raw }
    }
}

/**
 * Where the learner dragged the partner on the preparation page's two-axis pad, -2...2 per axis.
 * The centre follows the scenario's persona and is never sent.
 */
@Serializable(with = PartnerTemperamentSerializer::class)
class PartnerTemperament private constructor(
    /** 好商量 (-2) ... 不让步 (2) */
    val pushback: Int,
    /** 冷静 (-2) ... 情绪外放 (2) */
    val emotion: Int,
) {
    val isScenario: Boolean get() = pushback == 0 && emotion == 0

    /** The centre of this level's cell on the pad, each axis -1...1. */
    val x: Double get() = pushback / 2.0
    val y: Double get() = emotion / 2.0

    fun moved(pushback: Int = 0, emotion: Int = 0): PartnerTemperament =
        PartnerTemperament(this.pushback + pushback, this.emotion + emotion)

    /** e.g. "寸步不让、情绪激动"; null at the centre. */
    val label: String?
        get() = listOfNotNull(PUSHBACK_WORDS[pushback], EMOTION_WORDS[emotion]).takeIf { it.isNotEmpty() }?.joinToString("、")

    override fun equals(other: Any?): Boolean =
        other is PartnerTemperament && other.pushback == pushback && other.emotion == emotion

    override fun hashCode(): Int = pushback * 31 + emotion
    override fun toString(): String = "PartnerTemperament(pushback=$pushback, emotion=$emotion)"

    companion object {
        val LEVELS = -2..2
        val scenario = PartnerTemperament(0, 0)
        private val PUSHBACK_WORDS = mapOf(-2 to "很好商量", -1 to "愿意配合", 1 to "有点难缠", 2 to "寸步不让")
        private val EMOTION_WORDS = mapOf(-2 to "冷淡克制", -1 to "语气平稳", 1 to "情绪外露", 2 to "情绪激动")

        operator fun invoke(pushback: Int, emotion: Int): PartnerTemperament =
            PartnerTemperament(pushback.coerceIn(LEVELS), emotion.coerceIn(LEVELS))

        /** A point on the pad, each axis -1...1 with up meaning more emotion, at its nearest level. */
        fun at(x: Double, y: Double): PartnerTemperament = invoke(roundAwayFromZero(x * 2), roundAwayFromZero(y * 2))

        private fun roundAwayFromZero(value: Double): Int =
            (if (value >= 0) floor(value + 0.5) else ceil(value - 0.5)).toInt()
    }
}

/** Never fails, so a shape from a newer app cannot make a whole rehearsal undecodable. */
object PartnerTemperamentSerializer : KSerializer<PartnerTemperament> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("PartnerTemperament") {
        element<Int>("pushback")
        element<Int>("emotion")
    }

    override fun serialize(encoder: Encoder, value: PartnerTemperament) = encoder.encodeStructure(descriptor) {
        encodeIntElement(descriptor, 0, value.pushback)
        encodeIntElement(descriptor, 1, value.emotion)
    }

    override fun deserialize(decoder: Decoder): PartnerTemperament {
        val fields = (decoder as? JsonDecoder)?.decodeJsonElement() as? JsonObject
        fun level(key: String): Int = (fields?.get(key) as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: 0
        return PartnerTemperament(level("pushback"), level("emotion"))
    }
}

/** An expression from the learner's own 词库 that the partner tries to bring back. */
@Serializable
data class ReviewTarget(val text: String, val meaning: String)

@Serializable
data class PracticeMessage(
    val id: Uuid,
    val role: Role,
    val kind: Kind,
    val text: String,
    val stepIndex: Int,
    val createdAt: Millis,
    val translation: String? = null,
) {
    @Serializable
    enum class Role {
        @SerialName("partner") PARTNER,
        @SerialName("user") USER,
    }

    @Serializable
    enum class Kind {
        @SerialName("prompt") PROMPT,
        @SerialName("answer") ANSWER,
        @SerialName("retry") RETRY,
        @SerialName("response") RESPONSE,
    }
}

@Serializable
data class LivePracticeState(
    val model: String? = null,
    val completedTasks: List<Int> = emptyList(),
    val endedAt: Millis? = null,
    /** Items Live collected into 词库 during this rehearsal. */
    val collected: List<AILearningItem>? = null,
)

/**
 * One rehearsal. Immutable: every transition returns the changed copy. Transitions that can
 * be refused return null and leave the caller's copy as it was.
 */
@Serializable
data class PracticeSession(
    val id: Uuid,
    val scenario: PracticeScenario,
    val personalGoal: String,
    val context: String,
    val createdAt: Millis,
    val updatedAt: Millis,
    val messages: List<PracticeMessage>,
    val stepIndex: Int,
    val phase: Phase,
    val ai: AIPracticeState? = null,
    val live: LivePracticeState? = null,
    /** Unsent text in the composer, restored when the learner comes back. */
    val draft: String? = null,
    /** Raw `PracticeLevel`; null is standard. A string so a level from a newer app never breaks decoding. */
    val level: String? = null,
    /** Up to three 词库 expressions the partner looks for a chance to bring back. */
    val reviewItems: List<ReviewTarget>? = null,
    /** Raw `PracticeAttitude` from iOS 1.7; null follows the scenario. */
    val attitude: String? = null,
    /** Where the learner placed the partner; null is the centre (the scenario's persona). */
    val temperament: PartnerTemperament? = null,
    /** Post-conversation suggestions. */
    val sentenceReviews: List<SentenceReviewRecord>? = null,
) {
    @Serializable
    enum class Phase {
        @SerialName("speaking") SPEAKING,
        @SerialName("review") REVIEW,
        @SerialName("retry") RETRY,
        @SerialName("completed") COMPLETED,
    }

    val practiceLevel: PracticeLevel get() = PracticeLevel.from(level) ?: PracticeLevel.STANDARD
    val partnerAttitude: PracticeAttitude get() = PracticeAttitude.from(attitude) ?: PracticeAttitude.NATURAL

    /** What requests send: only values the server knows, null for the scenario's own persona. */
    val requestAttitude: String? get() = partnerAttitude.takeIf { it != PracticeAttitude.NATURAL }?.raw
    val partnerTemperament: PartnerTemperament get() = temperament ?: PartnerTemperament.scenario

    /** Sent only off-centre; the server lets it win over an older attitude. */
    val requestTemperament: PartnerTemperament? get() = partnerTemperament.takeIf { !it.isScenario }

    val title: String get() = personalGoal.ifEmpty { scenario.title }
    val step: PracticeStep get() = scenario.steps[min(stepIndex, scenario.steps.size - 1)]
    val userTurns: Int get() = messages.count { it.role == PracticeMessage.Role.USER }
    val retryCount: Int get() = messages.count { it.kind == PracticeMessage.Kind.RETRY }
    val completedSteps: Int
        get() = if (phase == Phase.COMPLETED) scenario.steps.size
        else stepIndex + if (phase == Phase.REVIEW || phase == Phase.RETRY) 1 else 0
    val isAI: Boolean get() = ai != null

    val pendingAIRequest: AIPracticeRequest?
        get() {
            val pending = ai?.pending ?: return null
            return AIPracticeRequest(
                requestId = pending.id, sessionId = id, action = pending.action, stepIndex = stepIndex,
                goal = personalGoal, context = context, scenario = AIPracticeRequest.Scenario(scenario),
                messages = messages.filter { it.text.isNotBlank() }.takeLast(24).map {
                    AIPracticeRequest.Message(it.role, it.kind,
                        if (live == null) it.text else it.text.trim().prefix(1200), it.stepIndex)
                },
                level = level, attitude = requestAttitude, temperament = requestTemperament, reviewItems = reviewItems,
            )
        }

    val currentFeedback: AIFeedback?
        get() {
            val user = messages.lastOrNull { it.role == PracticeMessage.Role.USER && it.stepIndex == stepIndex } ?: return null
            return ai?.feedbacks?.lastOrNull { it.id == user.id }?.feedback
        }

    fun feedback(messageID: UUID): AIFeedback? = ai?.feedbacks?.firstOrNull { it.id == messageID }?.feedback

    val suggestedStep: PracticeStep?
        get() {
            val turn = ai?.turn ?: return null
            if (ai.pending != null) return null
            return PracticeStep(
                id = step.id, goal = step.goal, prompt = turn.reply, translation = turn.translation,
                hint = turn.hint, keywords = turn.keywords,
                expression = currentFeedback?.revised ?: turn.suggestedReply,
                meaning = currentFeedback?.meaning ?: turn.suggestedMeaning,
            )
        }

    fun submit(text: String, now: Long = nowMillis()): PracticeSession? {
        if ((phase != Phase.SPEAKING && phase != Phase.RETRY) || ai?.pending != null) return null
        val trimmed = text.trim()
        if (trimmed.isEmpty() || trimmed.length > 800) return null
        val message = PracticeMessage(UUID.randomUUID(), PracticeMessage.Role.USER,
            if (phase == Phase.RETRY) PracticeMessage.Kind.RETRY else PracticeMessage.Kind.ANSWER,
            trimmed, stepIndex, now)
        return copy(
            messages = messages + message, draft = null, phase = Phase.REVIEW,
            ai = ai?.copy(pending = AIPendingRequest(UUID.randomUUID(), AIPracticeAction.ANSWER)),
            updatedAt = now,
        )
    }

    fun beginRetry(now: Long = nowMillis()): PracticeSession =
        if (phase != Phase.REVIEW || ai?.pending != null) this else copy(phase = Phase.RETRY, updatedAt = now)

    fun cancelRetry(now: Long = nowMillis()): PracticeSession =
        if (phase != Phase.RETRY) this else copy(phase = Phase.REVIEW, updatedAt = now)

    fun advance(now: Long = nowMillis()): PracticeSession {
        if (phase != Phase.REVIEW || ai?.pending != null) return this
        if (stepIndex + 1 == scenario.steps.size) return copy(phase = Phase.COMPLETED, updatedAt = now)
        val next = stepIndex + 1
        return if (ai != null) {
            copy(stepIndex = next, phase = Phase.SPEAKING, updatedAt = now,
                ai = ai.copy(pending = AIPendingRequest(UUID.randomUUID(), AIPracticeAction.ADVANCE)))
        } else {
            copy(stepIndex = next, phase = Phase.SPEAKING, updatedAt = now,
                messages = messages + PracticeMessage(UUID.randomUUID(), PracticeMessage.Role.PARTNER,
                    PracticeMessage.Kind.PROMPT, scenario.steps[next].prompt, next, now))
        }
    }

    fun applyAIResponse(response: AIPracticeResponse, now: Long = nowMillis()): PracticeSession? {
        val state = ai ?: return null
        val pending = state.pending ?: return null
        if (pending.id != response.requestId || !response.data.isValid(pending.action) || response.model.isEmpty()) return null
        var feedbacks = state.feedbacks
        response.data.feedback?.let { feedback ->
            val user = messages.lastOrNull() ?: return null
            if (user.role != PracticeMessage.Role.USER || user.stepIndex != stepIndex) return null
            feedbacks = feedbacks + AIFeedbackRecord(user.id, stepIndex, feedback)
        }
        val reply = PracticeMessage(UUID.randomUUID(), PracticeMessage.Role.PARTNER,
            if (pending.action == AIPracticeAction.ANSWER) PracticeMessage.Kind.RESPONSE else PracticeMessage.Kind.PROMPT,
            response.data.reply, stepIndex, now, response.data.translation)
        return copy(
            messages = messages + reply,
            ai = state.copy(turn = response.data, model = response.model, pending = null, feedbacks = feedbacks),
            updatedAt = now,
        )
    }

    /**
     * Live is a separate transition path. The text submit/retry/advance contracts stay
     * unchanged and still require their pending request rules.
     */
    fun beginLive(model: String? = null, now: Long = nowMillis()): PracticeSession {
        if (phase == Phase.COMPLETED) return this
        val state = live ?: LivePracticeState()
        return copy(
            ai = (ai ?: AIPracticeState()).copy(pending = null),
            live = if (model != null) state.copy(model = model) else state,
            phase = Phase.SPEAKING, updatedAt = now,
        )
    }

    fun prepareText(now: Long = nowMillis()): PracticeSession {
        if (phase == Phase.COMPLETED) return this
        // Repair whitespace-only subtitles written by older Live versions.
        val emptyIDs = messages.filter { it.text.isBlank() }.map { it.id }.toSet()
        val kept = messages.filter { it.id !in emptyIDs }
        var state = (ai ?: AIPracticeState()).let { it.copy(feedbacks = it.feedbacks.filter { item -> item.id !in emptyIDs }, pending = null) }
        var nextPhase = Phase.SPEAKING
        val last = kept.lastOrNull()
        if (last == null && stepIndex == 0) {
            state = state.copy(pending = AIPendingRequest(UUID.randomUUID(), AIPracticeAction.START))
        } else if (last != null && last.stepIndex < stepIndex) {
            // Live has already advanced the task. Do not re-send an old answer
            // as an answer for the new task (the server correctly rejects that).
            state = state.copy(turn = null, pending = AIPendingRequest(UUID.randomUUID(), AIPracticeAction.ADVANCE))
        } else if (last?.role == PracticeMessage.Role.USER) {
            nextPhase = Phase.REVIEW
            state = state.copy(pending = AIPendingRequest(UUID.randomUUID(), AIPracticeAction.ANSWER))
        }
        return copy(messages = kept, ai = state, phase = nextPhase, updatedAt = now)
    }

    fun liveTranscript(id: UUID, role: PracticeMessage.Role, text: String, now: Long = nowMillis()): PracticeSession? {
        if (live == null || text.isBlank() || text.length > 8000) return null
        val index = messages.indexOfFirst { it.id == id }
        val updated = if (index >= 0) {
            val previous = messages[index]
            messages.toMutableList().also {
                it[index] = PracticeMessage(id, role, previous.kind, text, previous.stepIndex, previous.createdAt)
            }
        } else {
            if (messages.size >= 500) return null
            messages + PracticeMessage(id, role,
                if (role == PracticeMessage.Role.USER) PracticeMessage.Kind.ANSWER else PracticeMessage.Kind.RESPONSE,
                text, stepIndex, now)
        }
        return copy(messages = updated, updatedAt = now)
    }

    fun liveCorrection(original: String, feedback: AIFeedback, now: Long = nowMillis()): PracticeSession? {
        if (live == null) return null
        val candidates = messages.filter { it.role == PracticeMessage.Role.USER }.takeLast(12).reversed()
        var best: Pair<PracticeMessage, Double>? = null
        for (candidate in candidates) {
            val score = LiveCorrectionMatcher.score(quote = original, transcript = candidate.text)
            if (best == null || score > best.second) best = candidate to score
        }
        val (user, score) = best ?: return null
        if (score < 0.6) return null
        return copy(
            ai = ai?.let { it.copy(feedbacks = it.feedbacks.filter { item -> item.id != user.id } + AIFeedbackRecord(user.id, user.stepIndex, feedback)) },
            updatedAt = now,
        )
    }

    /**
     * Completes every task from the current one through `taskIndex`, so a partner that
     * covered the rest in one go (or wraps up early) still closes the progress bar.
     * The learner must have spoken in the current task.
     */
    fun liveComplete(taskIndex: Int, now: Long = nowMillis()): PracticeSession? {
        val state = live ?: return null
        if (phase == Phase.COMPLETED || taskIndex < stepIndex || taskIndex >= scenario.steps.size
            || messages.none { it.role == PracticeMessage.Role.USER && it.stepIndex == stepIndex }) return null
        val finished = taskIndex + 1 == scenario.steps.size
        return copy(
            live = state.copy(completedTasks = state.completedTasks + (stepIndex..taskIndex)),
            ai = ai?.copy(turn = null),
            phase = if (finished) Phase.COMPLETED else Phase.SPEAKING,
            stepIndex = if (finished) stepIndex else taskIndex + 1,
            updatedAt = now,
        )
    }

    fun endLive(now: Long = nowMillis()): PracticeSession = copy(live = live?.copy(endedAt = now), updatedAt = now)

    fun applySentenceReviews(records: List<SentenceReviewRecord>, now: Long = nowMillis()): PracticeSession? {
        val ids = records.map { it.id }.toSet()
        val learner = learnerMessages
        if (records.isEmpty() || ids.size != records.size
            || !records.all { record -> learner.any { it.id == record.id && it.text == record.original } }) return null
        return copy(sentenceReviews = sentenceReviews.orEmpty().filter { it.id !in ids } + records, updatedAt = now)
    }

    /** A late background save of the conversation must not erase completed review batches. */
    fun mergeSentenceReviews(saved: PracticeSession): PracticeSession {
        if (id != saved.id) return this
        val current = sentenceReviews.orEmpty()
        val learner = learnerMessages
        val missing = saved.sentenceReviews.orEmpty().filter { record ->
            current.none { it.id == record.id } && learner.any { it.id == record.id && it.text == record.original }
        }
        if (missing.isEmpty()) return this
        return copy(sentenceReviews = current + missing, updatedAt = max(updatedAt, saved.updatedAt))
    }

    val isValid: Boolean
        get() = scenario.steps.isNotEmpty() && stepIndex in scenario.steps.indices
            && messages.all { it.stepIndex in scenario.steps.indices }
            && ai?.feedbacks.orEmpty().all { item ->
                messages.any { it.id == item.id && it.role == PracticeMessage.Role.USER && it.stepIndex == item.stepIndex }
            }

    /** Stores an on-demand Chinese gloss for one partner line (Live transcripts have none). */
    fun applyTranslation(translation: String, messageID: UUID, now: Long = nowMillis()): PracticeSession? {
        val text = translation.trim()
        val index = messages.indexOfFirst { it.id == messageID && it.role == PracticeMessage.Role.PARTNER }
        if (text.isEmpty() || text.length > 600 || index < 0) return null
        return copy(messages = messages.toMutableList().also { it[index] = it[index].copy(translation = text) }, updatedAt = now)
    }

    /** Keeps what the learner typed but has not sent, so leaving never loses it. */
    fun keepDraft(text: String, now: Long = nowMillis()): PracticeSession {
        val value = if (text.isBlank()) null else text.prefix(800)
        return if (value == draft) this else copy(draft = value, updatedAt = now)
    }

    /** Words this rehearsal added to 词库: text-mode feedback items plus those Live collected. */
    val collectedItems: List<AILearningItem>
        get() {
            val seen = mutableSetOf<String>()
            return (ai?.feedbacks.orEmpty().flatMap { it.feedback.items.orEmpty() } + live?.collected.orEmpty())
                .filter { seen.add(SavedExpression.key(it.text)) }
        }

    fun recordCollected(items: List<AILearningItem>, now: Long = nowMillis()): PracticeSession {
        val state = live ?: return this
        if (items.isEmpty()) return this
        val current = state.collected.orEmpty()
        val known = current.map { SavedExpression.key(it.text) }.toSet()
        val fresh = items.filter { SavedExpression.key(it.text) !in known }
        if (fresh.isEmpty()) return this
        return copy(live = state.copy(collected = (current + fresh).take(200)), updatedAt = now)
    }

    /** Review items the learner actually said in this rehearsal. */
    val reusedReviewItems: List<ReviewTarget>
        get() {
            val said = messages.filter { it.role == PracticeMessage.Role.USER }.map { it.text }
            return reviewItems.orEmpty().filter { item -> said.any { RecallMatcher.matches(target = item.text, heard = it) } }
        }

    /** Live corrections arrive without a Chinese meaning; fill it in once translated. */
    fun applyFeedbackMeaning(meaning: String, messageID: UUID, now: Long = nowMillis()): PracticeSession? {
        val text = meaning.trim()
        val state = ai ?: return null
        val index = state.feedbacks.indexOfFirst { it.id == messageID }
        if (text.isEmpty() || text.length > 800 || index < 0) return null
        val record = state.feedbacks[index]
        if (record.feedback.meaning.isNotEmpty()) return null
        val updated = state.feedbacks.toMutableList().also { it[index] = record.copy(feedback = record.feedback.copy(meaning = text)) }
        return copy(ai = state.copy(feedbacks = updated), updatedAt = now)
    }

    companion object {
        fun start(
            scenario: PracticeScenario, goal: String = "", context: String = "", useAI: Boolean = false,
            level: PracticeLevel = PracticeLevel.STANDARD, attitude: PracticeAttitude = PracticeAttitude.NATURAL,
            temperament: PartnerTemperament = PartnerTemperament.scenario,
            reviewItems: List<ReviewTarget> = emptyList(), now: Long = nowMillis(),
        ): PracticeSession {
            require(scenario.steps.isNotEmpty())
            return PracticeSession(
                id = UUID.randomUUID(), scenario = scenario,
                personalGoal = goal.trim().prefix(100), context = context.trim().prefix(500),
                createdAt = now, updatedAt = now,
                messages = if (useAI) emptyList() else listOf(PracticeMessage(UUID.randomUUID(), PracticeMessage.Role.PARTNER,
                    PracticeMessage.Kind.PROMPT, scenario.steps[0].prompt, 0, now)),
                stepIndex = 0, phase = Phase.SPEAKING,
                ai = if (useAI) AIPracticeState(pending = AIPendingRequest(UUID.randomUUID(), AIPracticeAction.START)) else null,
                level = level.takeIf { it != PracticeLevel.STANDARD }?.raw,
                attitude = attitude.takeIf { it != PracticeAttitude.NATURAL }?.raw,
                temperament = temperament.takeIf { !it.isScenario },
                reviewItems = reviewItems.take(3).ifEmpty { null },
            )
        }
    }
}

@Serializable
data class SavedExpression(
    val id: String,
    val text: String,
    val meaning: String,
    val source: String,
    val createdAt: Millis,
    /** word | phrase | grammar | other when auto-collected; null for a sentence saved by hand. */
    val kind: String? = null,
) {
    companion object {
        fun key(text: String): String = text.trim().lowercase()
    }
}

@Serializable
data class PracticeArchive(
    val schemaVersion: Int = 2,
    val sessions: List<PracticeSession> = emptyList(),
    val expressions: List<SavedExpression> = emptyList(),
    /** Learner-created scenarios, newest first. Sessions embed their scenario, so deleting one keeps history intact. */
    val scenarios: List<PracticeScenario> = emptyList(),
) {
    /** Adds auto-collected items that are not already in 词库; never removes anything. */
    fun collect(items: List<AILearningItem>, source: String, now: Long = nowMillis()): PracticeArchive {
        var list = expressions
        for (item in items.reversed()) {
            val key = SavedExpression.key(item.text)
            if (key.isEmpty() || list.any { it.id == key }) continue
            list = listOf(SavedExpression(key, item.text, item.meaning, source, now, item.type)) + list
        }
        return if (list === expressions) this else copy(expressions = list)
    }

    fun upsert(session: PracticeSession): PracticeArchive {
        if (!session.isValid || session.userTurns == 0) return this
        return copy(sessions = (sessions.filter { it.id != session.id } + session).sortedByDescending { it.updatedAt })
    }

    fun toggleExpression(text: String, meaning: String, source: String, now: Long = nowMillis()): PracticeArchive {
        val key = SavedExpression.key(text)
        if (key.isEmpty()) return this
        return if (expressions.any { it.id == key }) copy(expressions = expressions.filter { it.id != key })
        else copy(expressions = listOf(SavedExpression(key, text, meaning, source, now)) + expressions)
    }
}
