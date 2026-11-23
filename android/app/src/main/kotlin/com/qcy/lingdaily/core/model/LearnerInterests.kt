package com.qcy.lingdaily.core.model

import kotlinx.serialization.Serializable

/**
 * What the learner picked on the first-run page: why they practise English and which speaking
 * moments they find hard. Kept on this device only. Ids match app/lib/ios/interests.js, the
 * catalog's `tags` and the iOS app; the home page puts matching scenarios first and 换一批 sends them.
 */
data class LearnerInterest(val id: String, val label: String, val detail: String = "")

object LearnerInterests {
    const val KEY = "learnerInterests"
    const val ASKED_KEY = "learnerInterestsAsked"

    /** 「你练英语，主要为了什么？」 */
    val goals = listOf(
        LearnerInterest("travel", "出国旅行", "酒店、机场、点餐、问路"),
        LearnerInterest("campus", "留学校园", "同学、老师、小组作业"),
        LearnerInterest("work", "职场沟通", "开会、提意见、争取时间"),
        LearnerInterest("interview", "求职面试", "介绍经历、接住追问"),
        LearnerInterest("social", "交朋友", "邻居、聚会、约人出去玩"),
        LearnerInterest("living", "海外生活", "房东、快递、看病、办事"),
    )

    /** 「开口时，你最怕哪种场面？」 */
    val fears = listOf(
        LearnerInterest("fast", "对方说太快，听不过来"),
        LearnerInterest("pushback", "被人怼了，不知道怎么回"),
        LearnerInterest("smalltalk", "冷场，接不上话"),
        LearnerInterest("asking", "不好意思拒绝或提要求"),
    )

    val all = goals + fears
    private val allIDs = all.map { it.id }.toSet()

    /** Known ids from a stored comma-joined value, in order, without repeats. */
    fun picks(raw: String): List<String> = raw.split(",").filter { it in allIDs }.distinct()

    fun raw(picks: List<String>): String = picks(picks.joinToString(",")).joinToString(",")

    /** Scenarios matching more picks first; ties and unmatched ones keep the catalog order. */
    fun ranked(scenarios: List<PracticeScenario>, extras: Map<String, ScenarioExtras>, picks: List<String>): List<PracticeScenario> {
        if (picks.isEmpty()) return scenarios
        val wanted = picks.toSet()
        // sortedByDescending is stable, so equal scores keep their order.
        return scenarios.sortedByDescending { score(it, extras, wanted) }
    }

    /** Up to `limit` scenario ids matching at least one pick, best first, for the 「适合你」 mark. */
    fun recommended(scenarios: List<PracticeScenario>, extras: Map<String, ScenarioExtras>, picks: List<String>, limit: Int = 3): Set<String> {
        val wanted = picks.toSet()
        return ranked(scenarios, extras, picks).filter { score(it, extras, wanted) > 0 }.take(limit).map { it.id }.toSet()
    }

    private fun score(scenario: PracticeScenario, extras: Map<String, ScenarioExtras>, wanted: Set<String>): Int =
        extras[scenario.id]?.tags.orEmpty().count { it in wanted }
}

/** Another person who can play a catalog scenario's partner (「换个人」); the first is the default. */
@Serializable
data class PartnerCharacter(val partner: String, val label: String, val persona: String)

/** Catalog fields that are not part of a rehearsal's scenario snapshot, so they never reach sync. */
@Serializable
data class ScenarioExtras(
    val id: String,
    val tags: List<String> = emptyList(),
    val cast: List<PartnerCharacter> = emptyList(),
) {
    /** Malformed people dropped; one person is no choice. */
    fun cleaned(): ScenarioExtras {
        val valid = cast.filter {
            it.partner.isNotBlank() && it.partner.trim().length <= 40 && it.label.isNotEmpty() && it.label.length <= 12
                && it.persona.isNotEmpty() && it.persona.length <= PracticeScenario.PERSONA_LIMIT
        }
        return copy(cast = if (valid.size > 1) valid else emptyList())
    }
}

/**
 * The same scenario played by another person, for one rehearsal; the saved scenario is unchanged.
 * Settings and lines that name the partner (「房东 Morgan」) name the new person instead.
 */
fun PracticeScenario.playedBy(person: PartnerCharacter): PracticeScenario {
    val old = partner
    val new = person.partner
    fun rename(text: String) = if (old.isEmpty() || old == new) text else text.replace(old, new)
    return copy(
        partner = new, setting = rename(setting), persona = PracticeScenario.cleanPersona(person.persona),
        steps = steps.map {
            it.copy(prompt = rename(it.prompt), translation = rename(it.translation), hint = rename(it.hint),
                expression = rename(it.expression), meaning = rename(it.meaning))
        },
    )
}
