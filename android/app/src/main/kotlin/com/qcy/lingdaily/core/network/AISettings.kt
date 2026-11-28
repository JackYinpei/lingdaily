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

    /** Prefilled newest models (checked end to end with the app's real requests on 2026-11-28). */
    val defaultTextModel: String get() = if (this == GEMINI) "gemini-3.8-flash" else "gpt-6.2-sol"
    val defaultLiveModel: String get() = if (this == GEMINI) "gemini-3.8-live" else "gpt-realtime-2.1"
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

    /** Empty model fields become the provider's default models. */
    fun withDefaultModels(provider: AIProviderKind): AIProviderConfiguration = copy(
        textModel = textModel.ifBlank { provider.defaultTextModel },
        liveModel = liveModel.ifBlank { provider.defaultLiveModel },
    )

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

    /** The provider chosen in 接口设置; text and voice both use it (`voiceProvider` mirrors it for sync). */
    val provider: AIProviderKind get() = textProvider

    /** Both providers with empty model fields filled with their defaults. */
    fun withDefaultModels(): AISettings = copy(
        gemini = gemini.withDefaultModels(AIProviderKind.GEMINI),
        openai = openai.withDefaultModels(AIProviderKind.OPENAI),
    )

    /** The chosen provider once it has an API key; empty models fall back to its defaults. */
    private val resolved: ResolvedProvider?
        get() {
            val config = configuration(provider).sanitized().withDefaultModels(provider)
            return if (config.apiKey.isEmpty()) null else ResolvedProvider(provider, config)
        }

    val resolvedText: ResolvedProvider? get() = resolved

    val resolvedVoice: ResolvedProvider? get() = resolved

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
