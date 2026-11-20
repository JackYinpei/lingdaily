package com.qcy.lingdaily.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Device-local, versioned permission; never inferred from microphone permission or login. */
object AIDataConsent {
    const val VERSION = "2026-10-20"
    const val KEY = "aiDataConsentVersion"
    const val DATE_KEY = "aiDataConsentDate"
}

/**
 * Features whose model the learner can pick in 「我的」. The server publishes
 * the allowed choices and ignores anything else, so this is only a preference.
 */
enum class AIModelFeature(val raw: String, val title: String) {
    PRACTICE("practice", "文字对话"),
    SUGGEST("suggest", "卡住时的建议"),
    TRANSLATE("translate", "单句翻译"),
    LIVE("live", "语音通话");

    val key: String get() = "aiModel.$raw"
}

/** The server's allowed models per feature (`GET /api/ios/models`). */
@Serializable
data class AIModelCatalog(val practice: Feature, val suggest: Feature, val translate: Feature, val live: Feature) {
    @Serializable
    data class Choice(val id: String, val note: String)

    @Serializable
    data class Feature(@SerialName("default") val defaultModel: String, val choices: List<Choice>)

    fun feature(feature: AIModelFeature): Feature = when (feature) {
        AIModelFeature.PRACTICE -> practice
        AIModelFeature.SUGGEST -> suggest
        AIModelFeature.TRANSLATE -> translate
        AIModelFeature.LIVE -> live
    }
}
