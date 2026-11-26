package com.qcy.lingdaily.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import com.qcy.lingdaily.core.model.Millis
import com.qcy.lingdaily.core.model.nowMillis
import com.qcy.lingdaily.core.model.prefix

@Serializable
enum class AIProviderKind {
    @SerialName("gemini") GEMINI,
    @SerialName("openai") OPENAI;

    val title: String get() = if (this == GEMINI) "Google Gemini" else "OpenAI"
    val shortTitle: String get() = if (this == GEMINI) "Gemini" else "OpenAI"
    val other: AIProviderKind get() = if (this == GEMINI) OPENAI else GEMINI
}

@Serializable
data class AIProviderConfiguration(
    val apiKey: String = "",
    val baseURL: String = "",
    val textModel: String = "",
    val liveModel: String = "",
) {
    val hasAnyValue: Boolean
        get() = apiKey.trim().isNotEmpty() || baseURL.trim().isNotEmpty()
            || textModel.trim().isNotEmpty() || liveModel.trim().isNotEmpty()

    val isTextConfigured: Boolean
        get() = apiKey.trim().isNotEmpty() && textModel.trim().isNotEmpty()

    val isVoiceConfigured: Boolean
        get() = apiKey.trim().isNotEmpty() && liveModel.trim().isNotEmpty()

    fun sanitized(): AIProviderConfiguration = AIProviderConfiguration(
        apiKey = apiKey.trim().prefix(512),
        baseURL = baseURL.trim().prefix(512),
        textModel = textModel.trim().prefix(120),
        liveModel = liveModel.trim().prefix(120),
    )
}

data class ResolvedProvider(
    val provider: AIProviderKind,
    val configuration: AIProviderConfiguration,
) {
    val apiKey: String get() = configuration.apiKey.trim()
    val baseURL: String get() = configuration.baseURL.trim()
    val textModel: String get() = configuration.textModel.trim()
    val liveModel: String get() = configuration.liveModel.trim()
}

@Serializable
data class AISettings(
    val updatedAt: Millis = 0L,
    val textProvider: AIProviderKind = AIProviderKind.GEMINI,
    val voiceProvider: AIProviderKind = AIProviderKind.GEMINI,
    val gemini: AIProviderConfiguration = AIProviderConfiguration(),
    val openai: AIProviderConfiguration = AIProviderConfiguration(),
) {
    fun configuration(provider: AIProviderKind): AIProviderConfiguration =
        if (provider == AIProviderKind.GEMINI) gemini else openai

    fun withConfiguration(provider: AIProviderKind, configuration: AIProviderConfiguration): AISettings =
        if (provider == AIProviderKind.GEMINI) copy(gemini = configuration) else copy(openai = configuration)

    val hasAnyValue: Boolean
        get() = gemini.hasAnyValue || openai.hasAnyValue

    val resolvedText: ResolvedProvider?
        get() {
            val primary = configuration(textProvider)
            if (primary.isTextConfigured) return ResolvedProvider(textProvider, primary.sanitized())
            val fallbackKind = textProvider.other
            val fallback = configuration(fallbackKind)
            if (fallback.isTextConfigured) return ResolvedProvider(fallbackKind, fallback.sanitized())
            return null
        }

    val resolvedVoice: ResolvedProvider?
        get() {
            val primary = configuration(voiceProvider)
            if (primary.isVoiceConfigured) return ResolvedProvider(voiceProvider, primary.sanitized())
            val fallbackKind = voiceProvider.other
            val fallback = configuration(fallbackKind)
            if (fallback.isVoiceConfigured) return ResolvedProvider(fallbackKind, fallback.sanitized())
            return null
        }

    val isAnyConfigured: Boolean
        get() = resolvedText != null || resolvedVoice != null

    /** Bounds every field to the sync schema limits and guarantees a positive timestamp for sync. */
    fun sanitizedForSync(now: Long = nowMillis()): AISettings = AISettings(
        updatedAt = if (updatedAt > 0L) updatedAt else now,
        textProvider = textProvider,
        voiceProvider = voiceProvider,
        gemini = gemini.sanitized(),
        openai = openai.sanitized(),
    )
}
