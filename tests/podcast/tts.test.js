import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/lib/server/geminiConfig", () => ({
  createServerGeminiClient: vi.fn(),
  getServerGeminiApiKey: vi.fn(),
  getServerGeminiBaseUrl: vi.fn(),
}));

import {
  estimateChunkSeconds,
  levelSpeech,
  speechLevelDb,
  trimEdgeSilence,
  validateChunkAudio,
  validateTurnAudio,
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

describe("turn audio validation", () => {
  it.each(['好。', 'Yes.'])('allows a short acknowledgement: %s', text => {
    expect(seconds(validateTurnAudio({ text }, speechPcm(0.2)))).toBeCloseTo(0.2);
  });
  it('rejects silence and sub-floor clicks even for short acknowledgements', () => {
    expect(() => validateTurnAudio({ text: '好。' }, silencePcm(1))).toThrow(/silent/);
    expect(() => validateTurnAudio({ text: '好。' }, speechPcm(0.05))).toThrow(/truncated/);
  });
  it('allows fast speech but rejects a clipped medium-length turn', () => {
    const turn = { text: '今天我们关注全球市场的重要变化。' };
    expect(() => validateTurnAudio(turn, speechPcm(0.2))).toThrow(/truncated/);
    expect(seconds(validateTurnAudio(turn, speechPcm(1.2)))).toBeCloseTo(1.2);
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
