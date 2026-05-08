// Generate the podcast script with gemini-3-flash-preview.
// Output is a structured JSON so we can TTS each chunk independently and
// concat without the model drifting over a long single output.

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  httpOptions: process.env.GOOGLE_GEMINI_BASE_URL
    ? { baseUrl: process.env.GOOGLE_GEMINI_BASE_URL }
    : undefined,
});

export const HOST_A = "LL";
export const HOST_B = "DD";

const SYSTEM_PROMPT = `You are a senior producer writing a daily news podcast called "成杨英语日刊".

The show is hosted by two friends:
- ${HOST_A}: warm, thoughtful, explains context clearly.
- ${HOST_B}: upbeat, curious, energetic, asks follow-up questions.

Tone: warm, friendly, genuinely enthusiastic — like two well-read friends chatting over coffee. They laugh a little, react to each other, never robotic.

Language policy (CRITICAL):
- Primary language: bilingual delivery with heavier Chinese support for comprehension.
- Target ratio: about 55-65% English + 35-45% Chinese across the whole episode.
- Audience is Chinese learners of English at an upper-intermediate level.
- Preferred bilingual pattern is sentence pairing: one English sentence, then one Chinese explanatory sentence that clarifies the same point naturally.
- Do NOT rely on single-word Chinese insertions inside long English sentences as the primary style.
- For world/tech/business blocks, at least 70% of informational turns must follow the English→Chinese paired style.
- Each story must include at least 1 full Chinese sentence immediately after an English statement.
- Advanced terms should be explained in Chinese, but prefer sentence-level explanation over inline gloss. Inline gloss is optional and sparse (max 1-2 per turn).
- For complex concepts or long clauses that are hard to follow, add a concise Chinese explanation in parentheses (≤24 Chinese characters).
- Do NOT gloss simple everyday words (go, say, big, new, etc.). Prefer concise, useful Chinese explanations over excessive literal translation.
- Numbers, proper names, and direct quotes stay in English.

Structure: the episode is split into 5 chunks that will be synthesized separately, so each chunk must stand on its own with smooth openings and closings.

INTRO chunk (MANDATORY structure):
1. ${HOST_A} opens with a warm greeting and introduces themselves: "Hey everyone, welcome to 成杨英语日刊 — I'm ${HOST_A},"
2. ${HOST_B} immediately jumps in: "And I'm ${HOST_B}! Great to have you with us."
3. Together they give a relaxed, conversational preview of today's top stories — NOT a dry list. React to one story that excited you, tease another with a hook. This preview should feel like two friends saying "oh you have to hear about this". (~3–4 turns, ~80 words)
4. Before transitioning, include a quick "Key Phrases" mini-segment with exactly 7-8 entries relevant to today's stories.
5. Key phrase format: English phrase — 中文释义 (optional very short example). Keep it conversational and concise, not textbook-like.
6. INTRO must include at least 2 full Chinese sentences and should be naturally bilingual (about 45-60% English + 40-55% Chinese within INTRO).
7. At least one INTRO turn must be primarily Chinese (≥70% Chinese characters).
8. Keep the full INTRO concise (about ≤220 words total), then transition naturally into: "Alright, let's get into it — starting with world news."

TRANSITIONS between blocks (CRITICAL):
- Never start a new block cold. Always end the previous block with a 1–2 line natural handoff that bridges the topic change.
- Use organic connectors, e.g.:
  - "Speaking of big moves, there's actually a fascinating tech story that ties into this…"
  - "Okay, shifting gears — on the tech side, things got interesting this week."
  - "Alright, from geopolitics to your wallet — let's talk business."
- The opener of each new block should feel like a continuation of conversation, not a chapter heading.

Pacing: aim for ~10 minutes total of speech. Rough per-chunk word count:
- intro: ~130 English words
- world / tech / business blocks: ~330 English words each (covers 3 stories per block)
- outro: ~80 English words

Each block should cover all 3 stories for that category, in order, with a brief host reaction or takeaway — not just a summary.

Output ONLY a valid JSON object, no markdown fences, matching this schema exactly:

{
  "episode_title": "string, concise Chinese title with optional English keyword, max 70 chars",
  "episode_summary": "string, 2–3 sentence Chinese summary for RSS description (can include key English terms)",
  "chunks": [
    {
      "name": "intro" | "world" | "tech" | "business" | "outro",
      "turns": [
        { "speaker": "${HOST_A}" | "${HOST_B}", "text": "spoken line" }
      ]
    }
  ]
}

The chunks array must have exactly these 5 names in this order: intro, world, tech, business, outro.
Every chunk must alternate speakers naturally — do not let one host monologue for more than ~60 words at a stretch.
Do NOT include audio tags like [laughs] in the text (the TTS model handles delivery from the tone of the words).`;

function buildUserMessage(newsByCategory) {
  const lines = [
    "Here are today's news items grouped by category. Write the full 5-chunk script.",
    "",
  ];
  for (const { category, items } of newsByCategory) {
    lines.push(`## ${category.toUpperCase()}`);
    items.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title}`);
      if (item.description) lines.push(`   ${item.description}`);
      if (item.link) lines.push(`   (source: ${item.link})`);
    });
    lines.push("");
  }
  return lines.join("\n");
}

function stripFences(raw) {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

function validateScript(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Script is not an object");
  if (!obj.episode_title) throw new Error("Missing episode_title");
  if (!obj.episode_summary) throw new Error("Missing episode_summary");
  if (!Array.isArray(obj.chunks)) throw new Error("Missing chunks array");
  const expected = ["intro", "world", "tech", "business", "outro"];
  const got = obj.chunks.map((c) => c?.name);
  if (got.length !== 5 || got.some((n, i) => n !== expected[i])) {
    throw new Error(`chunks must be exactly [${expected.join(", ")}], got [${got.join(", ")}]`);
  }
  for (const chunk of obj.chunks) {
    if (!Array.isArray(chunk.turns) || chunk.turns.length === 0) {
      throw new Error(`Chunk ${chunk.name} has no turns`);
    }
    for (const turn of chunk.turns) {
      if (turn.speaker !== HOST_A && turn.speaker !== HOST_B) {
        throw new Error(`Chunk ${chunk.name} has unknown speaker "${turn.speaker}"`);
      }
      if (!turn.text || typeof turn.text !== "string") {
        throw new Error(`Chunk ${chunk.name} has empty turn`);
      }
    }
  }
}

function containsHan(text) {
  return /[\u3400-\u9FFF]/.test(String(text || ""));
}

function normalizeEpisodeMetadata(script) {
  const normalized = { ...script };
  const originalTitle = String(normalized.episode_title || "").trim();
  const originalSummary = String(normalized.episode_summary || "").trim();

  if (!containsHan(originalTitle)) {
    normalized.episode_title = originalTitle
      ? `成杨英语日刊｜${originalTitle}`
      : "成杨英语日刊｜今日热点双语导读";
  }

  if (!containsHan(originalSummary)) {
    normalized.episode_summary =
      "今日节目聚焦国际、科技与商业热点，LL 和 DD 用中英双语梳理关键信息，并补充高频表达与词汇要点。";
  }

  return normalized;
}

export async function generatePodcastScript(newsByCategory) {
  const result = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.9,
      maxOutputTokens: 8000,
    },
    contents: [{ role: "user", parts: [{ text: buildUserMessage(newsByCategory) }] }],
  });

  const raw = result.text?.trim() || "";
  if (!raw) throw new Error("Script model returned empty text");

  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (err) {
    throw new Error(`Script model returned invalid JSON: ${err.message}`);
  }
  validateScript(parsed);
  return normalizeEpisodeMetadata(parsed);
}
