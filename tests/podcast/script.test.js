import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/server/geminiConfig", () => ({
  createServerGeminiClient: vi.fn(),
}));

import { createServerGeminiClient } from "@/app/lib/server/geminiConfig";
import {
  generatePodcastScript,
  normalizePodcastScript,
  validatePodcastScript,
} from "@/app/lib/podcast/script";

const vocabulary = [
  ["resilience", "韧性", "The ability to recover after a difficult event.", "The market showed resilience after a volatile week."],
  ["momentum", "势头", "The force that keeps an activity moving forward.", "The company gained momentum after its product launch."],
  ["breakthrough", "突破", "An important discovery that advances knowledge or technology.", "The research team announced a major medical breakthrough."],
  ["regulation", "监管规定", "An official rule that controls how something operates.", "The new regulation requires clearer labels for consumers."],
  ["forecast", "预测", "A statement about what is likely to happen later.", "Analysts lowered their growth forecast for this quarter."],
  ["supply chain", "供应链", "The connected system that produces and delivers goods.", "Storms disrupted the regional supply chain last month."],
  ["adoption", "采用", "The act of beginning to use a new idea or product.", "Electric vehicle adoption continues to rise in cities."],
  ["outlook", "前景", "The expected situation or prospects for the future.", "Business leaders remain positive about the long-term outlook."],
].map(([term, meaning_zh, definition_en, example_en]) => ({
  term,
  meaning_zh,
  definition_en,
  example_en,
}));

function pairedTurns(topic) {
  return [
    {
      speaker: "LL",
      text: `今天我们先梳理${topic}的重要变化，以及它背后的主要原因。`,
    },
    {
      speaker: "DD",
      text: `Today we unpack the key change in ${topic} and explain the main reason behind it.`,
    },
    {
      speaker: "DD",
      text: "这条消息也会影响普通人的工作方式和日常选择。",
    },
    {
      speaker: "LL",
      text: "This development could also shape how ordinary people work and make everyday choices.",
    },
  ];
}

function validScript() {
  return {
    episode_title: "今日热点：市场、科技与世界新变化",
    shownotes: {
      summary_zh: "本期节目梳理国际、科技和商业领域的重要新闻。LL 和 DD 也会解释这些变化对普通人的实际影响。",
      summary_en: "This episode unpacks major stories in world affairs, technology, and business. LL and DD also explain how these changes could affect everyday life.",
      vocabulary: structuredClone(vocabulary),
    },
    chunks: [
      { name: "intro", turns: pairedTurns("今日新闻") },
      { name: "world", turns: pairedTurns("国际局势") },
      { name: "tech", turns: pairedTurns("科技行业") },
      { name: "business", turns: pairedTurns("商业市场") },
      {
        name: "outro",
        turns: [
          {
            speaker: "LL",
            text: "感谢今天的陪伴，也祝你的英语学习越来越顺利，拜拜！",
          },
          {
            speaker: "DD",
            text: "Thanks for listening and learning with us today. Bye!",
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  createServerGeminiClient.mockReset();
});

describe("podcast script validation", () => {
  it("accepts the five-chunk bilingual pair structure", () => {
    const script = validScript();

    expect(validatePodcastScript(script)).toBe(script);
  });

  it("enforces the alternating pair speakers and language order", () => {
    const wrongSpeaker = validScript();
    wrongSpeaker.chunks[0].turns[1].speaker = "LL";
    expect(() => validatePodcastScript(wrongSpeaker)).toThrow(/pair 0 English turn.*DD/);

    const wrongLanguage = validScript();
    wrongLanguage.chunks[0].turns[0].text = "This opening is written entirely in English for the audience.";
    expect(() => validatePodcastScript(wrongLanguage)).toThrow(/first turn must be Chinese-dominant/);
  });

  it("keeps the pair-role cycle continuous across chunk boundaries", () => {
    const oddPairCount = validScript();
    oddPairCount.chunks[0].turns.push(
      {
        speaker: "LL",
        text: "这一组会让下一个分块错误地再次从相同语言角色开始。",
      },
      {
        speaker: "DD",
        text: "This extra pair would make the next chunk restart with the same language roles.",
      },
    );

    expect(() => validatePodcastScript(oddPairCount)).toThrow(
      /intro must contain an even number of pairs/,
    );
  });

  it("rejects repeated or early farewell wording", () => {
    const earlyFarewell = validScript();
    earlyFarewell.chunks[3].turns[3].text = "That is the final business story for today. Bye for now.";
    expect(() => validatePodcastScript(earlyFarewell)).toThrow(/only allowed in the final two turns/);

    const repeatedFarewell = validScript();
    repeatedFarewell.chunks[4].turns[1].text = "Thanks for listening. Bye, bye!";
    expect(() => validatePodcastScript(repeatedFarewell)).toThrow(/exactly one English farewell/);
  });

  it("requires exactly eight unique shownotes vocabulary items", () => {
    const tooFew = validScript();
    tooFew.shownotes.vocabulary.pop();
    expect(() => validatePodcastScript(tooFew)).toThrow(/exactly 8 items/);

    const duplicate = validScript();
    duplicate.shownotes.vocabulary[7].term = " RESILIENCE ";
    expect(() => validatePodcastScript(duplicate)).toThrow(/terms must be unique/);
  });

  it("derives the legacy episode_summary from both shownotes languages", () => {
    const script = validScript();
    const normalized = normalizePodcastScript(script);

    expect(normalized.episode_summary).toBe(
      `${script.shownotes.summary_zh}\n\n${script.shownotes.summary_en}`,
    );
  });
});

describe("podcast script generation", () => {
  it("uses JSON output and performs at most one correction retry", async () => {
    const invalid = validScript();
    invalid.shownotes.vocabulary.pop();
    const generateContent = vi.fn()
      .mockResolvedValueOnce({ text: JSON.stringify(invalid) })
      .mockResolvedValueOnce({ text: JSON.stringify(validScript()) });
    createServerGeminiClient.mockReturnValue({ models: { generateContent } });

    const result = await generatePodcastScript([]);

    expect(result.episode_summary).toContain("\n\n");
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0][0].config.responseMimeType).toBe("application/json");
    expect(generateContent.mock.calls[1][0].contents.at(-1).parts[0].text).toContain(
      "failed validation",
    );
  });

  it("stops after the single correction retry also fails", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "{}" });
    createServerGeminiClient.mockReturnValue({ models: { generateContent } });

    await expect(generatePodcastScript([])).rejects.toThrow(/after one correction retry/);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("treats a validation error containing a retryable keyword as a correction, not a transient retry", async () => {
    // The model emits a duplicate vocabulary term that happens to be a word the
    // transient-error pattern also matches ("deadline"). This must stay on the
    // single-correction path, not trigger backoff retries or model failover.
    const invalid = validScript();
    invalid.shownotes.vocabulary[0].term = "deadline";
    invalid.shownotes.vocabulary[7].term = "deadline";
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(invalid) });
    createServerGeminiClient.mockReturnValue({ models: { generateContent } });

    await expect(generatePodcastScript([])).rejects.toThrow(/after one correction retry/);
    expect(generateContent).toHaveBeenCalledTimes(2);
    // Never fails over: both attempts stay on the primary model.
    expect(generateContent.mock.calls[1][0].model).toBe(generateContent.mock.calls[0][0].model);
  });

  it("retries a transient overload with the original prompt, not a correction", async () => {
    vi.useFakeTimers();
    try {
      // No numeric status: exercises the stringified-body detection path.
      const overload = new Error(
        '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
      );
      const generateContent = vi.fn()
        .mockRejectedValueOnce(overload)
        .mockResolvedValueOnce({ text: JSON.stringify(validScript()) });
      createServerGeminiClient.mockReturnValue({ models: { generateContent } });

      const promise = generatePodcastScript([]);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.episode_summary).toContain("\n\n");
      expect(generateContent).toHaveBeenCalledTimes(2);
      // The retry re-sends the original prompt, never a "failed validation" note.
      expect(generateContent.mock.calls[1][0].contents.at(-1).parts[0].text).not.toContain(
        "failed validation",
      );
      // First retry stays on the primary model.
      expect(generateContent.mock.calls[1][0].model).toBe(generateContent.mock.calls[0][0].model);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails over to the stable model when the preview stays overloaded", async () => {
    vi.useFakeTimers();
    try {
      const overload = Object.assign(new Error("model is experiencing high demand"), { status: 503 });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(overload)
        .mockRejectedValueOnce(overload)
        .mockResolvedValueOnce({ text: JSON.stringify(validScript()) });
      createServerGeminiClient.mockReturnValue({ models: { generateContent } });

      const promise = generatePodcastScript([]);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.episode_summary).toContain("\n\n");
      expect(generateContent).toHaveBeenCalledTimes(3);
      const models = generateContent.mock.calls.map((call) => call[0].model);
      expect(models[0]).toBe("gemini-3-flash-preview");
      expect(models[2]).toBe("gemini-2.5-flash");
    } finally {
      vi.useRealTimers();
    }
  });
});
