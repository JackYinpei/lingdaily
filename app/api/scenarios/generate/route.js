import { GoogleGenAI } from "@google/genai";
import { auth } from "@/app/auth";
import {
  DEFAULT_LEARNING_LANGUAGE,
  DEFAULT_NATIVE_LANGUAGE,
  getLanguage,
} from "@/app/lib/languages";

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
  httpOptions: { baseUrl: process.env.GOOGLE_GEMINI_BASE_URL },
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resolveLanguagePair(body) {
  // Older clients sent targetLang="zh" as their UI language while scenario
  // practice still defaulted to English. Preserve that historical behavior.
  const legacyTarget = body.targetLang === "zh" ? DEFAULT_LEARNING_LANGUAGE.code : body.targetLang;
  const learningCode = body.learningLanguage?.code
    ?? body.target_language_code
    ?? legacyTarget
    ?? DEFAULT_LEARNING_LANGUAGE.code;
  const nativeCode = body.nativeLanguage?.code
    ?? body.native_language_code
    ?? (body.lang === "ja" ? "ja" : null)
    ?? DEFAULT_NATIVE_LANGUAGE.code;
  const learningLanguage = getLanguage(learningCode, { allowChinese: false });
  const nativeLanguage = getLanguage(nativeCode);

  if (!learningLanguage || !nativeLanguage || learningLanguage.code === nativeLanguage.code) {
    return null;
  }
  return { learningLanguage, nativeLanguage };
}

// POST /api/scenarios/generate
// Body: { idea, lang?, learningLanguage?: { code }, nativeLanguage?: { code } }
// Returns a fully generated scenario object (not saved)
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const { idea, lang = "zh" } = body;
    const pair = resolveLanguagePair(body);

    if (!idea || typeof idea !== "string" || idea.trim().length < 5) {
      return jsonResponse({ error: "Please provide a scenario idea (at least 5 characters)" }, 400);
    }
    if (!pair) {
      return jsonResponse({ error: "Unsupported learning or native language code" }, 400);
    }

    const ideaTrimmed = idea.trim().slice(0, 500);
    const { learningLanguage, nativeLanguage } = pair;

    const systemPrompt = `You are an expert multilingual language-learning scenario designer. Given a user's scenario idea, generate a complete, detailed, engaging practice scenario as JSON.

The scenario should feel authentic and immersive. Include specific details: real character names, specific locations, concrete job descriptions, actual topics to discuss, key vocabulary, etc.

This scenario is specifically for a learner practising ${learningLanguage.englishName} (${learningLanguage.code}), with ${nativeLanguage.englishName} (${nativeLanguage.code}) as their native/support language.

Language requirements:
- The role-play itself, model phrases, questions, examples, corrections, and vocabulary practice must primarily use ${learningLanguage.englishName}.
- ${nativeLanguage.englishName} may be used only for concise explanations, translations, and clarification.
- Do not default to English unless English is the selected practice or support language.
- The system_prompt must explicitly identify both selected languages and tell the conversational AI how to use them.
- title_target and description_target must be written in ${learningLanguage.englishName}.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "title_zh": "场景标题（中文，15字以内）",
  "title_en": "Scenario Title (English, max 8 words)",
  "title_ja": "シナリオタイトル（日本語）",
  "description_zh": "A concise Chinese summary for legacy display",
  "description_en": "A concise English summary for legacy display",
  "description_ja": "A concise Japanese summary for legacy display",
  "title_target": "A concise title written in ${learningLanguage.englishName}",
  "description_target": "A detailed description written in ${learningLanguage.englishName}, including the setting, character, challenge, 5–8 vocabulary items, and practice goals",
  "target_language_code": "${learningLanguage.code}",
  "native_language_code": "${nativeLanguage.code}",
  "difficulty": "beginner|intermediate|advanced",
  "system_prompt": "Detailed instructions for the AI playing the opposite role (200–400 words). Include its character, personality, knowledge, conversation flow, questions, response handling, and gentle feedback. Require ${learningLanguage.englishName} for the practice conversation and allow only brief ${nativeLanguage.englishName} support.",
  "category_suggestion": "One of: study_abroad_interview | tour_guide | celebrity_speech | job_interview | daily_life | other"
}`;

    const userMessage = `Create a language practice scenario based on this idea: "${ideaTrimmed}"

The user's preferred language is: ${lang === "zh" ? "Chinese" : lang === "ja" ? "Japanese" : "English"}
Practice language: ${learningLanguage.label} (${learningLanguage.code})
Native/support language: ${nativeLanguage.label} (${nativeLanguage.code})

Make the scenario specific and detailed. Avoid generic placeholder descriptions.`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.8,
        maxOutputTokens: 3000,
      },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
    });

    const raw = result.text?.trim() || "";

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

    let generated;
    try {
      generated = JSON.parse(cleaned);
    } catch {
      return jsonResponse({ error: "AI returned invalid JSON. Please try again." }, 500);
    }

    // Validate required fields
    const required = ["title_target", "description_target", "system_prompt"];
    const missing = required.filter((k) => !generated[k]);
    if (missing.length > 0) {
      return jsonResponse({ error: `AI response missing fields: ${missing.join(", ")}` }, 500);
    }

    const allowedCategories = new Set([
      "study_abroad_interview",
      "tour_guide",
      "celebrity_speech",
      "job_interview",
      "daily_life",
      "other",
    ]);
    const data = {
      // Legacy fields remain populated so old UI/save clients keep working,
      // but only the selected target-language fields are required from Gemini.
      title_zh: String(generated.title_zh || generated.title_target),
      title_en: String(generated.title_en || generated.title_target),
      title_ja: String(generated.title_ja || generated.title_target),
      description_zh: String(generated.description_zh || generated.description_target),
      description_en: String(generated.description_en || generated.description_target),
      description_ja: String(generated.description_ja || generated.description_target),
      title_target: String(generated.title_target),
      description_target: String(generated.description_target),
      target_language_code: learningLanguage.code,
      native_language_code: nativeLanguage.code,
      difficulty: ["beginner", "intermediate", "advanced"].includes(generated.difficulty)
        ? generated.difficulty
        : "intermediate",
      system_prompt: String(generated.system_prompt),
      category_suggestion: allowedCategories.has(generated.category_suggestion)
        ? generated.category_suggestion
        : "other",
    };

    return jsonResponse({ ok: true, data });
  } catch (error) {
    console.error("[scenario/generate] Error:", error);
    return jsonResponse({ error: "Unable to generate scenario" }, 500);
  }
}
