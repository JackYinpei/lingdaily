package com.qcy.lingdaily.core.realtime

import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import com.qcy.lingdaily.core.model.AIPracticeRequest
import com.qcy.lingdaily.core.model.PartnerTemperament
import com.qcy.lingdaily.core.model.PracticeMessage
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeSession
import com.qcy.lingdaily.core.model.ReviewTarget
import com.qcy.lingdaily.core.model.Uuid

/**
 * Echo guard for the built-in speaker.
 *
 * On the loudspeaker the partner's voice reaches the microphone louder than the learner's
 * own voice; echo cancellation only attenuates it (least at the start of a call, before it
 * adapts), so the residue keeps triggering voice detection and cuts the partner off mid-sentence.
 * Loudness cannot tell residue from speech reliably here, so while partner audio is queued
 * or playing (plus a short room tail) microphone frames are
 * replaced with silence. The learner takes the floor explicitly with 打断: playback stops
 * first, so the open microphone then carries only the learner's voice.
 * Headphones/Bluetooth have no echo path and keep voice barge-in.
 */
class LiveEchoGate {
    private var quietUntil = 0L

    /** Set by 打断; cleared when the partner starts a new reply. */
    var learnerHasFloor = false
        private set

    fun learnerTookFloor() {
        learnerHasFloor = true
        quietUntil = 0
    }

    fun partnerStartedReply() {
        learnerHasFloor = false
    }

    /**
     * @param partnerAudible partner audio is queued or still playing.
     * @param speakerOutput output is the built-in speaker or earpiece.
     * @param now a monotonic clock in milliseconds.
     */
    fun suppressesMicrophone(partnerAudible: Boolean, speakerOutput: Boolean, now: Long): Boolean {
        if (!speakerOutput || learnerHasFloor) {
            quietUntil = 0
            return false
        }
        if (partnerAudible) {
            quietUntil = now + TAIL_MS
            return true
        }
        return now < quietUntil
    }

    companion object {
        /** Room reverberation and the microphone's own latency after the last presented frame. */
        const val TAIL_MS = 500L
    }
}

/**
 * What the app says to the model right after a Live session is set up.
 * A fresh rehearsal asks the partner to open, naming who the model plays: the setting is
 * written to the learner as 你, and without this the model sometimes opened with the
 * learner's own lines. When resuming (switching from text, or reconnecting) a fixed
 * "please begin" made the model repeat its last question, so the cue depends on who spoke last.
 */
object LiveKickoff {
    fun fresh(scenario: PracticeScenario): String =
        "You are ${scenario.partner} (${scenario.partnerRole}); I am the learner. Open the conversation in character as ${scenario.partner}, the way you really would at this moment (greet me only if you would), and lead into the current task. Never say my lines."

    fun replyToLearner(scenario: PracticeScenario): String =
        "You are ${scenario.partner}. We were cut off. Reply in character to my last message above. Do not greet me again or repeat anything you already said."

    /** null means send nothing: the partner's last line is still waiting for the learner's answer. */
    fun text(session: PracticeSession): String? {
        val last = session.messages.lastOrNull { it.text.isNotBlank() } ?: return fresh(session.scenario)
        return if (last.role == PracticeMessage.Role.USER) replyToLearner(session.scenario) else null
    }
}

/**
 * How long the learner may pause in a call before the partner replies. It is part of the
 * session setup, so a change applies from the next call.
 */
object LivePause {
    const val KEY = "livePauseMs"
    val options = listOf(800, 1500, 2500, 4000)
    const val STANDARD = 1500

    fun valid(milliseconds: Int): Int = if (milliseconds in options) milliseconds else STANDARD

    fun label(milliseconds: Int): String =
        if (milliseconds % 1000 == 0) "${milliseconds / 1000} 秒" else "${milliseconds / 1000.0} 秒"
}

/**
 * A reply idea for a learner who is stuck during a Live call. Chinese first:
 * `hint` says what to talk about; `reply` is an optional English model answer.
 */
@Serializable
data class LiveSuggestion(val hint: String, val keywords: String, val reply: String, val meaning: String)

@Serializable
data class LiveSuggestionRequest(
    val requestId: Uuid,
    val scenario: AIPracticeRequest.Scenario,
    val goal: String,
    val context: String,
    val stepIndex: Int,
    val messages: List<LiveTokenRequest.Message>,
    val model: String? = null,
    val level: String? = null,
    val attitude: String? = null,
    val temperament: PartnerTemperament? = null,
    val reviewItems: List<ReviewTarget>? = null,
) {
    companion object {
        fun from(session: PracticeSession): LiveSuggestionRequest? {
            val live = LiveTokenRequest.from(session)
            if (live.messages.isEmpty()) return null
            return LiveSuggestionRequest(UUID.randomUUID(), live.scenario, live.goal, live.context, live.stepIndex,
                live.messages, level = live.level, attitude = live.attitude, temperament = live.temperament,
                reviewItems = live.reviewItems)
        }
    }
}

/**
 * When to offer help on its own: the partner has finished a line and the
 * learner has said nothing for a while. At most once per partner line.
 */
object LiveStuckPolicy {
    const val SILENCE_MS = 8_000L

    /** The partner line the learner should be answering, if the learner has not answered it yet. */
    fun awaitedLine(session: PracticeSession): UUID? {
        val last = session.messages.lastOrNull { it.text.isNotBlank() } ?: return null
        return if (last.role == PracticeMessage.Role.PARTNER) last.id else null
    }
}

/**
 * One `usageMetadata` message from Gemini Live. It covers a single model turn (prompt incl.
 * conversation context, and that turn's response), not a running total, so a connection's
 * usage is the sum of all of them.
 */
data class LiveUsage(
    val input: Int = 0,
    val output: Int = 0,
    val inputAudio: Int = 0,
    val outputAudio: Int = 0,
    val total: Int = 0,
) {
    operator fun plus(other: LiveUsage): LiveUsage = LiveUsage(input + other.input, output + other.output,
        inputAudio + other.inputAudio, outputAudio + other.outputAudio, total + other.total)

    companion object {
        private fun number(value: Any?): Long? = (value as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull

        fun from(metadata: JsonObject): LiveUsage? {
            fun count(key: String): Int = (number(metadata[key]) ?: 0).coerceIn(0, 10_000_000).toInt()
            fun audio(key: String): Int = (metadata[key] as? JsonArray).orEmpty()
                .mapNotNull { it as? JsonObject }
                .filter { (it["modality"] as? JsonPrimitive)?.takeIf { value -> value.isString }?.content == "AUDIO" }
                .sumOf { (number(it["tokenCount"]) ?: 0).coerceIn(0, 10_000_000).toInt() }
            val input = count("promptTokenCount")
            val output = count("responseTokenCount")
            val total = count("totalTokenCount")
            if (input + output + total <= 0) return null
            return LiveUsage(input, output, minOf(audio("promptTokensDetails"), input),
                minOf(audio("responseTokensDetails"), output), total)
        }
    }
}
