package com.qcy.lingdaily

import java.io.File
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import com.qcy.lingdaily.core.model.AIPracticeAction
import com.qcy.lingdaily.core.model.SentenceReviewRequest
import com.qcy.lingdaily.core.model.parseScenarioCatalog
import com.qcy.lingdaily.core.network.AIProviderKind
import com.qcy.lingdaily.core.network.DirectAI
import com.qcy.lingdaily.core.network.PracticeNetworkException

class DirectAITest {

    @Test
    fun normalizesGeminiAndOpenAIBaseURLsAndBlocksPublicCleartext() {
        assertEquals("Empty means the Tokyo relay", "https://lingdailyapi-jp.yasobi.xyz", DirectAI.normalizeGeminiBaseURL(""))
        assertEquals("https://generativelanguage.googleapis.com", DirectAI.normalizeGeminiBaseURL("https://generativelanguage.googleapis.com/"))
        assertEquals("https://my-gemini-proxy.example.com", DirectAI.normalizeGeminiBaseURL("my-gemini-proxy.example.com/v1beta/"))
        assertEquals("https://my-gemini-proxy.example.com/custom", DirectAI.normalizeGeminiBaseURL("https://my-gemini-proxy.example.com/custom/v1alpha"))
        assertEquals("http://localhost:8787", DirectAI.normalizeGeminiBaseURL("http://localhost:8787/v1beta/"))
        assertEquals("http://192.168.1.20:8080", DirectAI.normalizeGeminiBaseURL("http://192.168.1.20:8080/"))
        assertEquals("http://10.0.2.2:8000", DirectAI.normalizeGeminiBaseURL("http://10.0.2.2:8000"))
        assertEquals(
            "https://my-gemini-proxy.example.com/v1beta/models/gemini-2.5-flash:generateContent",
            DirectAI.geminiGenerateContentURL("my-gemini-proxy.example.com/v1beta/", "models/gemini-2.5-flash"),
        )

        assertEquals("Empty means the Tokyo relay", "https://lingdailyapi-jp.yasobi.xyz/openai/v1", DirectAI.normalizeOpenAIV1BaseURL(""))
        assertEquals("https://api.openai.com/v1", DirectAI.normalizeOpenAIV1BaseURL("https://api.openai.com/"))
        assertEquals("https://api.openai.com/v1", DirectAI.normalizeOpenAIV1BaseURL("https://api.openai.com/v1/"))
        assertEquals("https://proxy.example.com/openai/v1", DirectAI.normalizeOpenAIV1BaseURL("proxy.example.com/openai"))
        assertEquals("https://proxy.example.com/openai/v1", DirectAI.normalizeOpenAIV1BaseURL("https://proxy.example.com/openai/v1/chat/completions"))
        assertEquals("http://172.16.5.4:11434/v1", DirectAI.normalizeOpenAIV1BaseURL("http://172.16.5.4:11434"))
        assertEquals("https://proxy.example.com/v1/chat/completions", DirectAI.openAIChatCompletionsURL("proxy.example.com"))

        assertThrows(PracticeNetworkException::class.java) {
            DirectAI.normalizeGeminiBaseURL("http://public-proxy.example.com")
        }
        assertThrows(PracticeNetworkException::class.java) {
            DirectAI.normalizeOpenAIV1BaseURL("http://172.32.0.1:8080")
        }
        assertThrows(PracticeNetworkException::class.java) {
            DirectAI.normalizeOpenAIV1BaseURL("https://user:pass@proxy.example.com")
        }
    }

    @Test
    fun geminiAndOpenAICodecsHandleThinkingPartsMarkdownFencesAndReasoningModels() {
        val gemini25Body = Json.parseToJsonElement(
            DirectAI.buildGeminiGenerateContentBody(
                model = "gemini-2.5-flash",
                systemInstruction = DirectAI.TRANSLATION_INSTRUCTION,
                userPayloadJson = """{"line":"Hello"}""",
                responseSchema = DirectAI.TRANSLATION_RESPONSE_SCHEMA,
                temperature = 0.2,
                maxOutputTokens = 1200,
            ),
        ).jsonObject
        assertEquals(0, gemini25Body.getValue("generationConfig").jsonObject.getValue("thinkingConfig").jsonObject.getValue("thinkingBudget").jsonPrimitive.int)

        val geminiOtherBody = Json.parseToJsonElement(
            DirectAI.buildGeminiGenerateContentBody(
                model = "gemini-2.0-flash",
                systemInstruction = DirectAI.TRANSLATION_INSTRUCTION,
                userPayloadJson = """{"line":"Hello"}""",
                responseSchema = DirectAI.TRANSLATION_RESPONSE_SCHEMA,
                temperature = 0.2,
                maxOutputTokens = 1200,
            ),
        ).jsonObject
        assertFalse("thinkingConfig" in geminiOtherBody.getValue("generationConfig").jsonObject)

        // Gemini 3 cannot skip thinking, but answers about 3x faster at "low" ("minimal" is rejected).
        val gemini3Body = Json.parseToJsonElement(
            DirectAI.buildGeminiGenerateContentBody(
                model = AIProviderKind.GEMINI.defaultTextModel,
                systemInstruction = DirectAI.TRANSLATION_INSTRUCTION,
                userPayloadJson = """{"line":"Hello"}""",
                responseSchema = DirectAI.TRANSLATION_RESPONSE_SCHEMA,
                temperature = 0.2,
                maxOutputTokens = 1200,
            ),
        ).jsonObject
        assertEquals("low", gemini3Body.getValue("generationConfig").jsonObject.getValue("thinkingConfig").jsonObject.getValue("thinkingLevel").jsonPrimitive.content)

        val geminiRawResponse = """
            {
              "candidates": [{
                "finishReason": "STOP",
                "content": {
                  "parts": [
                    {"thought": true, "text": "Internal reasoning that must be ignored"},
                    {"text": "```json\n{\"translation\":\"你好。\"}\n```"}
                  ]
                }
              }]
            }
        """.trimIndent()
        val extractedGemini = DirectAI.extractGeminiText(geminiRawResponse)
        assertEquals("你好。", DirectAI.parseTranslation(extractedGemini))

        val openAIStandard = Json.parseToJsonElement(
            DirectAI.buildOpenAIChatCompletionBody("gpt-4o-mini", "sys", DirectAI.TRANSLATION_JSON_CONTRACT, """{"line":"Hi"}""", 0.4),
        ).jsonObject
        assertTrue("temperature" in openAIStandard)
        assertEquals("json_object", openAIStandard.getValue("response_format").jsonObject.getValue("type").jsonPrimitive.content)

        for (reasoningModel in listOf("o1-mini", "o3-mini", "o4-mini", "gpt-5", "GPT-5-mini", AIProviderKind.OPENAI.defaultTextModel, "gpt-6-luna", "gpt-10")) {
            val body = Json.parseToJsonElement(
                DirectAI.buildOpenAIChatCompletionBody(reasoningModel, "sys", DirectAI.TRANSLATION_JSON_CONTRACT, """{"line":"Hi"}""", 0.4),
            ).jsonObject
            assertFalse("Reasoning model $reasoningModel must omit temperature", "temperature" in body)
        }

        val openAIRawResponse = """
            {"choices":[{"finish_reason":"stop","message":{"content":"```\n{\"translation\":\"早上好。\"}\n```"}}]}
        """.trimIndent()
        assertEquals("早上好。", DirectAI.parseTranslation(DirectAI.extractOpenAIText(openAIRawResponse)))
    }

    @Test
    fun parsesModelListsMapsHttpErrorsAndValidatesPracticeAndReviewOutputs() {
        assertEquals(
            listOf("gemini-2.5-flash", "gemini-2.5-pro"),
            DirectAI.parseGeminiModelsList("""{"models":[{"name":"models/gemini-2.5-pro"},{"name":"models/gemini-2.5-flash"},{"name":"models/gemini-2.5-flash"}]}"""),
        )
        assertEquals(
            listOf("gpt-4o-mini", "gpt-4o-realtime-preview"),
            DirectAI.parseOpenAIModelsList("""{"data":[{"id":"gpt-4o-realtime-preview"},{"id":"gpt-4o-mini"}]}"""),
        )

        assertTrue(DirectAI.mapHttpError(401, "gpt-4o").message!!.contains("API Key"))
        val geminiBadKey = """{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}"""
        assertTrue("Gemini answers a wrong key with 400", DirectAI.mapHttpError(400, "gemini-2.5-flash", geminiBadKey).message!!.contains("API Key"))
        assertFalse(DirectAI.mapHttpError(400, "gemini-2.5-flash", """{"error":{"message":"Invalid JSON payload"}}""").message!!.contains("API Key"))
        assertTrue(DirectAI.mapHttpError(404, "missing-model").message!!.contains("missing-model"))
        assertTrue(DirectAI.mapHttpError(429, "gpt-4o").message!!.contains("429"))

        // Practice validator rejects feedback.revised that copied partner reply.
        val copiedPartnerTurn = """
            {"reply":"Monday works for me.","translation":"周一可以。","hint":"提示","keywords":"Monday",
             "suggestedReply":"Could we do Monday?","suggestedMeaning":"能改周一吗？",
             "feedback":{"revised":"Monday works for me.","meaning":"周一可以。","note":"改写","items":[]}}
        """.trimIndent()
        assertThrows(IllegalArgumentException::class.java) {
            DirectAI.parsePracticeTurn(copiedPartnerTurn, AIPracticeAction.ANSWER, "Can delay Monday?")
        }

        // Sentence review clears identical rewrite.
        val msgId = UUID.randomUUID()
        val reviewRecords = DirectAI.parseSentenceReview(
            """{"items":[{"messageId":"$msgId","revised":"Sounds good to me.","meaning":"听起来不错。","note":"无需修改"}]}""",
            listOf(SentenceReviewRequest.Message(msgId, "  sounds good to me. ", "How about Monday?")),
        )
        assertEquals("", reviewRecords.single().revised)
        assertEquals("", reviewRecords.single().meaning)
        assertEquals("", reviewRecords.single().note)
    }

    @Test
    fun bundledRawCatalogLoadsAll25ScenariosWithCastAndPartnerVoices() {
        val file = File("src/main/res/raw/scenario_catalog.json")
        assertTrue("Bundled scenario_catalog.json must exist", file.isFile)
        val catalog = parseScenarioCatalog(file.readText())
        assertEquals(25, catalog.scenarios.size)
        for (scenario in catalog.scenarios) {
            val extras = catalog.extras[scenario.id]
            assertTrue("Scenario ${scenario.id} must have tags", !extras?.tags.isNullOrEmpty())
            assertTrue("Scenario ${scenario.id} must have cast choices", (extras?.cast?.size ?: 0) >= 2)
            for (person in extras!!.cast) {
                assertTrue(DirectAI.voiceForPartner(person.partner) in DirectAI.GEMINI_ALL_VOICES)
                assertTrue(DirectAI.openAIVoiceForPartner(person.partner) in (DirectAI.OPENAI_FEMALE_VOICES + DirectAI.OPENAI_MALE_VOICES))
            }
        }
    }
}
