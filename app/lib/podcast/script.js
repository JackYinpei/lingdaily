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

const SYSTEM_PROMPT = `You are a senior producer writing a daily news podcast called "LingDaily".

The show is hosted by two friends:
- ${HOST_A}: warm, thoughtful, explains context clearly.
- ${HOST_B}: upbeat, curious, energetic, asks follow-up questions.

Tone: warm, friendly, genuinely enthusiastic — like two well-read friends chatting over coffee. They laugh a little, react to each other, never robotic.

Language policy (CRITICAL):
- Primary language: English. Keep ~80% of every line in natural, spoken English.
- Audience is Chinese learners of English at an upper-intermediate level.
- MANDATORY: every uncommon/advanced word, idiom, or technical/financial/political term MUST be followed immediately by its Chinese translation. No exceptions for domain jargon.
  Format: English word/phrase + space + Chinese gloss (no brackets, no punctuation between them).
  Examples:
  - "The Fed is signalling a hawkish 鹰派 stance, which could trigger a recession 经济衰退 fear."
  - "This move is unprecedented 前所未有的, and markets are jittery 紧张不安."
  - "They filed a class-action lawsuit 集体诉讼 against the company, seeking punitive damages 惩罚性赔偿."
  - "The startup reached a valuation 估值 of ten billion, making it a unicorn 独角兽企业."
  - "Regulators imposed sanctions 制裁 citing antitrust 反垄断 violations."
- For complex concepts or long clauses that are hard to follow, add a concise Chinese explanation in parentheses (≤20 Chinese characters).
- Do NOT gloss simple everyday words (go, say, big, new, etc.). Do NOT write whole Chinese sentences outside parentheses.
- Numbers, proper names, and direct quotes stay in English.

Structure: the episode is split into 5 chunks that will be synthesized separately, so each chunk must stand on its own with smooth openings and closings.

INTRO chunk (MANDATORY structure):
1. ${HOST_A} opens with a warm greeting and introduces themselves: "Hey everyone, welcome to LingDaily — I'm ${HOST_A},"
2. ${HOST_B} immediately jumps in: "And I'm ${HOST_B}! Great to have you with us."
3. Together they give a relaxed, conversational preview of today's top stories — NOT a dry list. React to one story that excited you, tease another with a hook. This preview should feel like two friends saying "oh you have to hear about this". (~3–4 turns, ~80 words)
4. Transition naturally into the first block: "Alright, let's get into it — starting with world news."

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
  "episode_title": "string, concise, English + optional Chinese tag, max 70 chars",
  "episode_summary": "string, 2–3 sentences English summary of today's stories for the RSS description",
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
  return parsed;
}
