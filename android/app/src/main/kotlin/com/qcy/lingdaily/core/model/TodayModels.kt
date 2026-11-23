package com.qcy.lingdaily.core.model

import kotlinx.serialization.Serializable

/** 「今日」 from `GET /api/ios/today`: the latest daily podcast and a rehearsal about one of its stories. */
@Serializable
data class TodayEpisode(
    val date: String,
    val title: String,
    val summary: String,
    val audioURL: String? = null,
    val duration: Int? = null,
    val vocabulary: List<Term> = emptyList(),
    val scenario: AIScenarioResponse.Draft? = null,
) {
    @Serializable
    data class Term(val term: String, val meaning: String, val example: String) {
        val id: String get() = SavedExpression.key(term)

        /** 词库 type for a podcast term. */
        val kind: String get() = if (term.contains(" ")) "phrase" else "word"
    }

    /** Streamed only over HTTPS. */
    val playableURL: String? get() = audioURL?.takeIf { it.startsWith("https://") }

    /** One id per episode, so every rehearsal about it shares an identity and a colour. */
    val practiceScenario: PracticeScenario? get() = scenario?.practiceScenario("today-$date")

    /** Where its terms say they came from in 词库, e.g. 每日播客 10月26日. */
    val source: String
        get() {
            val parts = date.split("-").mapNotNull { it.toIntOrNull() }
            return if (parts.size == 3) "每日播客 ${parts[1]}月${parts[2]}日" else "每日播客"
        }
}

@Serializable
data class TodayResponse(val today: TodayEpisode? = null)

/** Built-in rehearsals from `GET /api/ios/scenarios`; the four bundled ones are the offline fallback. */
@Serializable
data class ScenarioCatalogResponse(val version: Int, val scenarios: List<PracticeScenario>) {
    /** Entries the app can practise: three filled-in steps and an id no learner or daily scenario uses. */
    val validScenarios: List<PracticeScenario>
        get() {
            val seen = mutableSetOf<String>()
            return scenarios.filter { scenario ->
                val texts = listOf(scenario.title, scenario.subtitle, scenario.category, scenario.partner,
                    scenario.partnerRole, scenario.setting) + scenario.steps.flatMap {
                    listOf(it.id, it.goal, it.prompt, it.translation, it.hint, it.keywords, it.expression, it.meaning)
                }
                scenario.steps.size == 3
                    && ID_PATTERN.matches(scenario.id)
                    && !scenario.id.startsWith("custom-") && !scenario.id.startsWith("today-")
                    && texts.all { it.isNotBlank() && it.length <= 400 }
                    && (scenario.persona?.length ?: 0) <= 400
                    && seen.add(scenario.id)
            }
        }
}

/** Interest tags and alternate cast read from the same catalog entries, kept out of `PracticeScenario`. */
@Serializable
data class ScenarioExtrasResponse(val scenarios: List<ScenarioExtras> = emptyList())

/** The valid built-in scenarios and their extras, by scenario id. */
data class ScenarioCatalog(val scenarios: List<PracticeScenario>, val extras: Map<String, ScenarioExtras>)

fun parseScenarioCatalog(json: String): ScenarioCatalog {
    val scenarios = AppJson.decodeFromString(ScenarioCatalogResponse.serializer(), json).validScenarios
    val ids = scenarios.map { it.id }.toSet()
    val extras = runCatching { AppJson.decodeFromString(ScenarioExtrasResponse.serializer(), json).scenarios }.getOrDefault(emptyList())
        .filter { it.id in ids }.associate { it.id to it.cleaned() }
    return ScenarioCatalog(scenarios, extras)
}

private val ID_PATTERN = Regex("^[a-z][a-z0-9-]{1,39}$")
