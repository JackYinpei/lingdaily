package com.qcy.lingdaily

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import com.qcy.lingdaily.core.model.AppJson
import com.qcy.lingdaily.core.model.LearnerInterests
import com.qcy.lingdaily.core.model.PracticeScenario
import com.qcy.lingdaily.core.model.PracticeStep
import com.qcy.lingdaily.core.model.ScenarioExtras
import com.qcy.lingdaily.core.model.parseScenarioCatalog
import com.qcy.lingdaily.core.model.playedBy

class LearnerInterestsTest {
    private fun scenario(id: String) = PracticeScenario(id, "t", "s", "日常", "house", "Sam", "咖啡师", "情境",
        List(3) { PracticeStep("s$it", "g", "p", "t", "h", "k", "e", "m") }, persona = "忙")

    @Test
    fun storedPicksKeepKnownIdsOnceInOrder() {
        assertEquals(listOf("work", "pushback"), LearnerInterests.picks("work,unknown,pushback,work"))
        assertEquals("travel,fast", LearnerInterests.raw(listOf("travel", "nope", "travel", "fast")))
        assertEquals(emptyList<String>(), LearnerInterests.picks(""))
    }

    @Test
    fun ranksMatchingScenariosFirstAndKeepsCatalogOrderOtherwise() {
        val all = listOf("coffee", "classmate", "deposit", "meeting", "blame").map(::scenario)
        val extras = mapOf(
            "coffee" to ScenarioExtras("coffee", listOf("travel", "living", "fast")),
            "classmate" to ScenarioExtras("classmate", listOf("campus", "social")),
            "deposit" to ScenarioExtras("deposit", listOf("living", "pushback")),
            "meeting" to ScenarioExtras("meeting", listOf("work", "pushback")),
        )
        assertEquals(all.map { it.id }, LearnerInterests.ranked(all, extras, emptyList()).map { it.id })
        assertEquals(listOf("meeting", "deposit", "coffee", "classmate", "blame"),
            LearnerInterests.ranked(all, extras, listOf("work", "pushback")).map { it.id })
        assertEquals(setOf("meeting"), LearnerInterests.recommended(all, extras, listOf("work", "pushback"), limit = 1))
        assertEquals(emptySet<String>(), LearnerInterests.recommended(all, extras, listOf("interview")))
    }

    @Test
    fun catalogExtrasDecodeBesideScenariosAndStayOutOfTheSnapshot() {
        val step = """{"id":"a","goal":"g","prompt":"p","translation":"t","hint":"h","keywords":"k","expression":"e","meaning":"m"}"""
        val json = """{"version":5,"scenarios":[
          {"id":"coffee","title":"t","subtitle":"s","category":"日常","symbol":"cup","partner":"Sam","partnerRole":"咖啡师",
           "persona":"忙","setting":"情境","steps":[$step,$step,$step],"tags":["travel","fast"],
           "cast":[{"partner":"Sam","label":"忙碌的兼职生","persona":"忙"},{"partner":"Lou","label":"不耐烦的老店员","persona":"冷"},{"partner":" ","label":"x","persona":"y"}]},
          {"id":"hotel","title":"t","subtitle":"s","category":"旅行","symbol":"bed","partner":"Jamie","partnerRole":"前台",
           "setting":"情境","steps":[$step,$step,$step],"cast":[{"partner":"Jamie","label":"客气","persona":"客气"}]},
          {"id":"old","title":"t","subtitle":"s","category":"日常","symbol":"c","partner":"Ari","partnerRole":"r","setting":"x","steps":[$step,$step,$step]}
        ]}"""
        val catalog = parseScenarioCatalog(json)
        assertEquals(listOf("coffee", "hotel", "old"), catalog.scenarios.map { it.id })
        assertEquals(listOf("travel", "fast"), catalog.extras["coffee"]?.tags)
        assertEquals("an invalid person is dropped", listOf("Sam", "Lou"), catalog.extras["coffee"]?.cast?.map { it.partner })
        assertEquals("one person is no choice", emptyList<Any>(), catalog.extras["hotel"]?.cast)
        assertEquals(ScenarioExtras("old"), catalog.extras["old"])

        val coffee = catalog.scenarios.first()
        val encoded = AppJson.encodeToString(PracticeScenario.serializer(), coffee)
        assertFalse("a rehearsal snapshot never carries catalog extras", "cast" in encoded || "tags" in encoded)
        val played = coffee.playedBy(catalog.extras.getValue("coffee").cast.last())
        assertEquals("Lou", played.partner)
        assertEquals("冷", played.persona)
        assertEquals(coffee.id, played.id)
    }

    @Test
    fun anotherPersonIsNamedInTheSettingAndLines() {
        val meeting = scenario("meeting").copy(partner = "Riley", setting = "周一的例会上，Riley 提议直接全量上线。",
            steps = List(3) { PracticeStep("s$it", "g", "Riley here.", "我是 Riley。", "h", "k", "Thanks, Riley.", "谢谢 Riley。") })
        val played = meeting.playedBy(com.qcy.lingdaily.core.model.PartnerCharacter("Brooke", "用数据压人", "冷静但咄咄逼人"))
        assertEquals("周一的例会上，Brooke 提议直接全量上线。", played.setting)
        assertEquals("Brooke here.", played.steps[0].prompt)
        assertEquals("谢谢 Brooke。", played.steps[0].meaning)
        assertEquals(meeting.copy(persona = "急"), meeting.copy(persona = "急").playedBy(com.qcy.lingdaily.core.model.PartnerCharacter("Riley", "急", "急")))
    }
}
