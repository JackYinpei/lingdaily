package com.qcy.lingdaily.core.realtime

import kotlin.math.min

/**
 * Match quoted sentences inside a transcript, ignoring STT punctuation and
 * minor word differences. Never blindly attach an unrelated quote to a user.
 */
object LiveCorrectionMatcher {
    private val separators = Regex("[^\\p{L}\\p{M}\\p{N}]+")

    fun words(text: String): List<String> = text.lowercase().split(separators).filter { it.isNotEmpty() }

    fun score(quote: String, transcript: String): Double {
        val left = words(quote)
        val right = words(transcript)
        if (left.isEmpty() || right.isEmpty()) return 0.0
        if (left == right) return 1.0
        val a = left.joinToString(" ")
        val b = right.joinToString(" ")
        if (left.size >= 2 && (" $b ".contains(" $a ") || " $a ".contains(" $b "))) return 0.95
        // Token overlap handles a sentence embedded in a longer transcription
        // and speech-to-text tense/contraction changes without quadratic strings.
        val shared = left.toSet().intersect(right.toSet()).size
        if (shared < 2) return 0.0
        return shared.toDouble() / min(left.toSet().size, right.toSet().size) * 0.85
    }
}
