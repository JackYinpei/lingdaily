import { GoogleGenAI } from "@google/genai";
import { auth } from "@/app/auth";

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

// POST /api/scenarios/generate
// Body: { idea: string, lang?: "en"|"zh"|"ja", targetLang?: "en"|"zh" }
// Returns a fully generated scenario object (not saved)
export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const { idea, lang = "zh" } = body;

    if (!idea || typeof idea !== "string" || idea.trim().length < 5) {
      return jsonResponse({ error: "Please provide a scenario idea (at least 5 characters)" }, 400);
    }

    const ideaTrimmed = idea.trim().slice(0, 500);

    const systemPrompt = `You are an expert language learning scenario designer. Given a user's scenario idea, you generate a complete, detailed, engaging language practice scenario in JSON format.

The scenario should feel authentic and immersive. Include specific details: real character names, specific locations, concrete job descriptions, actual topics to discuss, key vocabulary, etc.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{
  "title_zh": "场景标题（中文，15字以内）",
  "title_en": "Scenario Title (English, max 8 words)",
  "title_ja": "シナリオタイトル（日本語）",
  "description_zh": "详细的中文描述（150–300字）。必须包含：具体的场景设定、角色背景、核心挑战或话题、关键词汇列表（5–8个）、练习重点。",
  "description_en": "Detailed English description (150–300 words). Must include: specific setting, character background, core challenge or topics to cover, key vocabulary (5–8 terms), practice goals.",
  "difficulty": "beginner|intermediate|advanced",
  "system_prompt": "Detailed instructions for the AI playing the opposite role (200–400 words). Include: the AI's character name, personality, specific knowledge the AI has, conversation structure/flow, specific questions to ask, how to handle common responses, how to give language feedback gently. Write in English.",
  "category_suggestion": "One of: study_abroad_interview | tour_guide | celebrity_speech | job_interview | daily_life | other"
}`;

    const userMessage = `Create a language practice scenario based on this idea: "${ideaTrimmed}"

The user's preferred language is: ${lang === "zh" ? "Chinese" : lang === "ja" ? "Japanese" : "English"}

Make the scenario specific and detailed. Avoid generic placeholder descriptions.`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.8,
        maxOutputTokens: 2000,
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
    const required = ["title_zh", "title_en", "description_zh", "description_en", "difficulty", "system_prompt"];
    const missing = required.filter((k) => !generated[k]);
    if (missing.length > 0) {
      return jsonResponse({ error: `AI response missing fields: ${missing.join(", ")}` }, 500);
    }

    return jsonResponse({ ok: true, data: generated });
  } catch (error) {
    console.error("[scenario/generate] Error:", error);
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  }
}
