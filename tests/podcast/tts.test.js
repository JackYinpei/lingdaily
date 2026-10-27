import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/server/geminiConfig", () => ({
  createServerGeminiClient: vi.fn(),
}));

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerGeminiClient } from "@/app/lib/server/geminiConfig";
import {
  estimateChunkSeconds,
  levelSpeech,
  speechLevelDb,
  synthesizeChunkWithRetry,
  synthesizePodcast,
  trimEdgeSilence,
  validateChunkAudio,
} from "@/app/lib/podcast/tts";

const SAMPLE_RATE = 24000;

// A chunk whose text-based estimate is ~9.8s: one Chinese turn (23 han chars)
// and one English turn (9 latin words), plus the per-turn gap allowance.
function smallChunk(name = "intro") {
  return {
    name,
    turns: [
      { speaker: "LL", text: "今天我们聊聊全球市场的重要变化以及背后的主要原因。" },
      { speaker: "DD", text: "Today we unpack the key change in global markets." },
    ],
  };
}

function speechPcm(seconds, amplitude = 8000) {
  const samples = new Int16Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.round(Math.sin(i / 7) * amplitude);
  }
  return Buffer.from(samples.buffer);
}

function silencePcm(seconds) {
  return Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2);
}

function audioResponse(...pcmBuffers) {
  return {
    candidates: [
      {
        content: {
          parts: pcmBuffers.map((pcm) => ({ inlineData: { data: pcm.toString("base64") } })),
        },
      },
    ],
  };
}

function seconds(pcm) {
  return pcm.byteLength / 2 / SAMPLE_RATE;
}

describe("chunk duration estimate", () => {
  it("accounts for both languages plus turn gaps", () => {
    const estimate = estimateChunkSeconds(smallChunk());
    expect(estimate).toBeGreaterThan(8);
    expect(estimate).toBeLessThan(12);
  });
});

describe("edge silence trim", () => {
  it("keeps only a short pause around the speech", () => {
    const pcm = Buffer.concat([silencePcm(5), speechPcm(10), silencePcm(60)]);
    const trimmed = trimEdgeSilence(pcm);
    expect(seconds(trimmed)).toBeGreaterThan(10);
    expect(seconds(trimmed)).toBeLessThan(11.5);
  });

  it("returns an empty buffer for pure silence", () => {
    expect(trimEdgeSilence(silencePcm(20)).byteLength).toBe(0);
  });
});

describe("chunk audio validation", () => {
  it("salvages a good take that has a long silent tail", () => {
    const pcm = Buffer.concat([speechPcm(10), silencePcm(74)]);
    const trimmed = validateChunkAudio(smallChunk(), pcm);
    expect(seconds(trimmed)).toBeLessThan(11.5);
  });

  it("rejects audio that runs several times the transcript length", () => {
    expect(() => validateChunkAudio(smallChunk(), speechPcm(30))).toThrow(/repeated, looped, or truncated/);
  });
});

describe("chunk synthesis", () => {
  it("concatenates every inline audio part instead of only the first", async () => {
    const generateContent = vi.fn().mockResolvedValue(
      audioResponse(speechPcm(5), speechPcm(5)),
    );
    const pcm = await synthesizeChunkWithRetry({ models: { generateContent } }, smallChunk());

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(seconds(pcm)).toBeGreaterThan(9.5);
  });

  it("retries when the model repeats the transcript, like the 2026-07-29 intro", async () => {
    vi.useFakeTimers();
    try {
      const generateContent = vi.fn()
        // Tripled transcript plus a long silent tail — like the observed glitch,
        // which ran ~2.4x its estimate even after the silence was trimmed.
        .mockResolvedValueOnce(audioResponse(Buffer.concat([speechPcm(30), silencePcm(74)])))
        .mockResolvedValueOnce(audioResponse(speechPcm(10)));

      const promise = synthesizeChunkWithRetry({ models: { generateContent } }, smallChunk());
      await vi.runAllTimersAsync();
      const pcm = await promise;

      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(seconds(pcm)).toBeLessThan(11.5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries transient overloads on the same model", async () => {
    vi.useFakeTimers();
    try {
      const overload = Object.assign(new Error("model is experiencing high demand"), { status: 503 });
      const generateContent = vi.fn()
        .mockRejectedValueOnce(overload)
        .mockRejectedValueOnce(overload)
        .mockResolvedValueOnce(audioResponse(speechPcm(10)));

      const promise = synthesizeChunkWithRetry({ models: { generateContent } }, smallChunk());
      await vi.runAllTimersAsync();
      await promise;

      expect(generateContent.mock.calls.map((call) => call[0].model)).toEqual(Array(3).fill("gemini-3.1-flash-tts-preview"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("abandons a stalled call after the time limit and retries it on the same model", async () => {
    vi.stubEnv("PODCAST_TTS_CALL_TIMEOUT_MS", "50");
    try {
      const stalled = ({ config }) => new Promise((_, reject) => {
        config.abortSignal.addEventListener("abort", () => reject(new Error("This operation was aborted")));
      });
      const generateContent = vi.fn()
        .mockImplementationOnce(stalled)
        .mockResolvedValueOnce(audioResponse(speechPcm(10)));

      const pcm = await synthesizeChunkWithRetry({ models: { generateContent } }, smallChunk());

      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(generateContent.mock.calls.map((call) => call[0].model)).toEqual(Array(2).fill("gemini-3.1-flash-tts-preview"));
      expect(seconds(pcm)).toBeGreaterThan(9.5);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("treats a dropped connection as transient", async () => {
    vi.useFakeTimers();
    try {
      const generateContent = vi.fn()
        .mockRejectedValueOnce(new TypeError("terminated"))
        .mockResolvedValueOnce(audioResponse(speechPcm(10)));

      const promise = synthesizeChunkWithRetry({ models: { generateContent } }, smallChunk());
      await vi.runAllTimersAsync();
      await promise;

      expect(generateContent).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails at once when the model is permanently unavailable", async () => {
    const gone = Object.assign(new Error("requested model was not found"), { status: 404 });
    const generateContent = vi.fn().mockRejectedValue(gone);

    await expect(synthesizeChunkWithRetry({ models: { generateContent } }, smallChunk())).rejects.toThrow(/not found/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting bad-audio retries rather than publishing a glitch", async () => {
    vi.useFakeTimers();
    try {
      const generateContent = vi.fn().mockResolvedValue(audioResponse(speechPcm(30)));

      const promise = synthesizeChunkWithRetry({ models: { generateContent } }, smallChunk());
      const expectation = expect(promise).rejects.toThrow(/kept returning unusable audio/);
      await vi.runAllTimersAsync();
      await expectation;

      expect(generateContent).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("speech levelling", () => {
  it("brings quiet and loud takes to the same speech loudness", () => {
    const quiet = levelSpeech(speechPcm(3, 2500));
    const loud = levelSpeech(speechPcm(3, 20000));
    expect(Math.abs(speechLevelDb(quiet) - speechLevelDb(loud))).toBeLessThan(0.5);
    expect(Math.abs(speechLevelDb(quiet) + 19)).toBeLessThan(0.5);
  });

  it("keeps peaks below full scale, leaves silence alone and caps the gain", () => {
    const peaky = levelSpeech(Buffer.concat([speechPcm(2, 3000), speechPcm(0.2, 32000)]));
    const samples = new Int16Array(peaky.buffer, peaky.byteOffset, peaky.byteLength / 2);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(32767);
    expect(levelSpeech(silencePcm(1)).equals(silencePcm(1))).toBe(true);
    // A near-silent take (quiet speech with sparse peaks, ~-41 dBFS) is raised by at most 12 dB.
    const whisper = speechPcm(2, 400);
    const view = new Int16Array(whisper.buffer, whisper.byteOffset, whisper.byteLength / 2);
    for (let i = 600; i < view.length; i += 1200) view[i] = 2500;
    expect(speechLevelDb(levelSpeech(whisper)) - speechLevelDb(whisper)).toBeCloseTo(12, 0);
  });
});

describe("podcast synthesis", () => {
  it("writes one MP3 covering every chunk and reports its duration", async () => {
    const generateContent = vi.fn().mockResolvedValue(audioResponse(speechPcm(10)));
    createServerGeminiClient.mockReturnValue({ models: { generateContent } });

    const dir = await mkdtemp(path.join(tmpdir(), "podcast-tts-"));
    try {
      const outputMp3Path = path.join(dir, "episode.mp3");
      const script = { chunks: [smallChunk("intro"), smallChunk("outro")] };

      const result = await synthesizePodcast(script, {
        outputMp3Path,
        workDir: path.join(dir, "work"),
      });

      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(result.duration).toBe(20);
      expect(result.size).toBeGreaterThan(1000);
      expect(result.model).toBe("gemini-3.1-flash-tts-preview");
      const written = await readFile(outputMp3Path);
      expect(written.byteLength).toBe(result.size);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function synthesize(chunks, generateContent) {
    createServerGeminiClient.mockReturnValue({ models: { generateContent } });
    const dir = await mkdtemp(path.join(tmpdir(), "podcast-tts-"));
    try {
      return await synthesizePodcast({ chunks }, { outputMp3Path: path.join(dir, "episode.mp3"), workDir: path.join(dir, "work") });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("re-voices the whole episode with the stable model instead of mixing models", async () => {
    const gone = Object.assign(new Error("requested model was not found"), { status: 404 });
    const generateContent = vi.fn(async ({ model, contents }) => {
      const outro = contents[0].parts[0].text.includes("outro line");
      if (model === "gemini-3.1-flash-tts-preview" && outro) throw gone;
      return audioResponse(speechPcm(10));
    });
    const outro = smallChunk("outro");
    outro.turns[1] = { speaker: "DD", text: "This outro line wraps up the global markets story today." };

    const result = await synthesize([smallChunk("intro"), outro], generateContent);

    expect(result.model).toBe("gemini-2.5-flash-preview-tts");
    const stable = generateContent.mock.calls.filter((call) => call[0].model === "gemini-2.5-flash-preview-tts");
    expect(stable).toHaveLength(2); // Both chunks, including the intro the preview had already voiced.
  });

  it("voices chunks in parallel, at most three at a time, in script order", async () => {
    let active = 0;
    let peak = 0;
    const generateContent = vi.fn(async ({ contents }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      const index = Number(contents[0].parts[0].text.match(/segment (\d)/)[1]);
      return audioResponse(speechPcm(9 + index * 0.1));
    });
    const chunks = [0, 1, 2, 3, 4].map((index) => {
      const chunk = smallChunk(`c${index}`);
      chunk.turns[1] = { speaker: "DD", text: `Today we unpack segment ${index} of the global markets.` };
      return chunk;
    });

    const result = await synthesize(chunks, generateContent);

    expect(generateContent).toHaveBeenCalledTimes(5);
    expect(peak).toBe(3);
    expect(result.duration).toBe(46); // 9.0 + 9.1 + 9.2 + 9.3 + 9.4 s, joined in script order.
  });
});
