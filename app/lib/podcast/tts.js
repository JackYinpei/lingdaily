// Synthesize each script chunk with Gemini multi-speaker TTS, then concat into one MP3.
// Splitting per chunk keeps each TTS call under the "few minutes" drift threshold.
// Separate calls are what made episodes sound uneven, so every chunk of an episode
// uses the same model and is levelled to the same speech loudness before the join.

import { mkdir, writeFile, rm } from "node:fs/promises";
import Mp3Encoder from "@breezystack/lamejs";
import { HOST_A, HOST_B, countHanCharacters, countLatinWords } from "./script.js";
import { backoffDelay, isRetryableApiError, sleep } from "./retry.js";
import { createServerGeminiClient } from "@/app/lib/server/geminiConfig";

// The preview TTS model has two failure modes seen in production: 503 "high
// demand" bursts, and HTTP 200 responses whose audio is glitched — transcript
// read twice, one phrase stuck in a loop, or a minute of silence appended
// (2026-07-29 episode). Transient failures retry with backoff; glitched audio is
// caught by the duration check below and retried. A model that still cannot
// voice a chunk hands the WHOLE episode to the next model: the two models render
// the same voice names differently, and switching per chunk made the hosts sound
// like other people halfway through. Both models are overridable without a redeploy.
const PRIMARY_TTS_MODEL = (process.env.PODCAST_TTS_MODEL || "gemini-3.1-flash-tts-preview").trim();
const FALLBACK_TTS_MODEL = (process.env.PODCAST_TTS_FALLBACK_MODEL ?? "gemini-2.5-flash-preview-tts").trim();
const TTS_MODELS = [PRIMARY_TTS_MODEL, FALLBACK_TTS_MODEL].filter(
  (model, index, all) => model && all.indexOf(model) === index,
);
// Retry budget per chunk and model.
const MAX_TRANSIENT_RETRIES = 3;
const MAX_BAD_AUDIO_RETRIES = 2;
// A call still running after this is abandoned and retried as a transient failure:
// one stalled ~300 s (until the socket timed out) on 2026-10-26 while the same
// chunk normally takes ~60 s.
function ttsCallTimeoutMs() {
  return Number.parseInt(process.env.PODCAST_TTS_CALL_TIMEOUT_MS || "", 10) || 150_000;
}
// One ~110 s chunk takes ~60 s to synthesize (measured 2026-10-26), so five in a
// row already filled most of the route's 300 s budget. Chunks run in parallel,
// longest first.
const TTS_CONCURRENCY = Math.min(Math.max(Number.parseInt(process.env.PODCAST_TTS_CONCURRENCY || "3", 10) || 3, 1), 5);

const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const SAMPLE_WIDTH = 2;
const MP3_KBPS = 96;
const FULL_SCALE = 32767;

const VOICE_A = "Zephyr";     // Warm
const VOICE_B = "Orus";       // Upbeat

// Duration plausibility window for a chunk's audio. Published episodes run
// 0.77x-0.96x of this text-based estimate, so the window is generous in both
// directions: a false reject burns a whole TTS attempt, while today's glitches
// land far outside it (the doubled intro measured ~2.4x after silence trim).
const HAN_CHARS_PER_SECOND = 5;
const LATIN_WORDS_PER_SECOND = 2.5;
const TURN_GAP_SECONDS = 0.8;
const MIN_DURATION_RATIO = 0.5;
const MAX_DURATION_RATIO = 1.6;

// Glitched responses can pad the chunk with long dead air. Trimming the edges
// first means an otherwise-good take with a silent tail is salvaged rather than
// rejected, and listeners never sit through a minute of nothing mid-episode.
const SILENCE_AMPLITUDE = 500; // ~1.5% of int16 full scale
const EDGE_KEEP_SECONDS = 0.6; // natural pause left at each chunk boundary

// Speech loudness. Separate calls came back several dB apart (the 2026-10-25 and
// 10-26 episodes swung 7-10 dB between segments, heard as the hosts changing).
// A chunk's level is the median RMS of its voiced 50 ms frames, so pauses and a
// few loud words do not move it; each chunk is scaled to one target, with a soft
// knee above LIMIT_KNEE so peaks never clip.
const TARGET_SPEECH_DBFS = -19;
const LEVEL_FRAME_SECONDS = 0.05;
const VOICED_FRAME_PEAK = 2000;
const MAX_LEVEL_GAIN_DB = 12;
const LIMIT_KNEE = Math.round(0.8 * FULL_SCALE);

const DIRECTOR_PREAMBLE = `You are synthesizing a daily bilingual English/Mandarin news podcast.

AUDIO PROFILE
- ${HOST_A}: warm, thoughtful, mid-range voice. Sounds like a friend who has read the news carefully and wants to share it.
- ${HOST_B}: upbeat, curious, lively voice. Brings energy and asks follow-up questions.

DIRECTOR'S NOTES
- Style: friendly, enthusiastic, conversational — the "vocal smile" is audible. They react to each other, not read from a script.
- Pacing: natural spoken pace; slight speed-ups on excitement words, gentle pauses at story transitions.
- Consistency: this transcript is one segment of a longer episode recorded in separate passes. Keep each host's voice, pitch, pace and volume exactly the same as in every other segment, from the first line to the last.
- Language: the transcript is organized into two-turn bilingual pairs. The first turn is Mandarin and the second is its natural English counterpart, spoken by the other host.
- Keep each turn in its written language. Do not merge the pair into one mixed-language turn; English names or learning terms inside Mandarin are the only normal exception.
- Preserve the speaker labels exactly. Language ownership swaps between pairs, so the same host may intentionally have two adjacent turns at a pair boundary.
- Accent: standard Mandarin for Chinese turns and clear, neutral English for English turns.
- Do not read bracketed directions or speaker labels out loud.
- Read the transcript exactly once from start to finish. Never repeat a line or restart the dialogue.

TRANSCRIPT (synthesize this dialogue):
`;

function renderChunkTranscript(chunk) {
  return chunk.turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
}

function renderChunkPrompt(chunk) {
  return DIRECTOR_PREAMBLE + renderChunkTranscript(chunk);
}

// Encode concatenated PCM buffers directly to MP3 using lamejs (no ffmpeg needed).
function pcmBuffersToMp3(pcmBuffers) {
  const encoder = new Mp3Encoder.Mp3Encoder(CHANNELS, SAMPLE_RATE, MP3_KBPS);
  const mp3Parts = [];

  for (const pcm of pcmBuffers) {
    // lamejs expects Int16Array
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
    const blockSize = 1152;
    for (let i = 0; i < samples.length; i += blockSize) {
      const chunk = samples.subarray(i, i + blockSize);
      const encoded = encoder.encodeBuffer(chunk);
      if (encoded.length > 0) mp3Parts.push(Buffer.from(encoded));
    }
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) mp3Parts.push(Buffer.from(flushed));

  return Buffer.concat(mp3Parts);
}

export function estimateChunkSeconds(chunk) {
  let seconds = 0;
  for (const turn of chunk.turns) {
    seconds += countHanCharacters(turn.text) / HAN_CHARS_PER_SECOND
      + countLatinWords(turn.text) / LATIN_WORDS_PER_SECOND
      + TURN_GAP_SECONDS;
  }
  return seconds;
}

// A response may split long audio across several inline parts; taking only the
// first would silently truncate the chunk.
function extractChunkPcm(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const audioParts = parts
    .map((part) => part?.inlineData?.data)
    .filter(Boolean)
    .map((data) => Buffer.from(data, "base64"));
  if (audioParts.length === 0) {
    throw new Error("response contains no audio data (possibly text token fallthrough)");
  }
  // Buffer.concat also re-allocates, guaranteeing the 2-byte alignment that the
  // Int16Array views below require.
  const pcm = Buffer.concat(audioParts);
  return pcm.byteLength % SAMPLE_WIDTH === 0 ? pcm : pcm.subarray(0, pcm.byteLength - 1);
}

export function trimEdgeSilence(pcm) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / SAMPLE_WIDTH);
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) < SILENCE_AMPLITUDE) first += 1;
  if (first >= samples.length) return Buffer.alloc(0);
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) < SILENCE_AMPLITUDE) last -= 1;
  const keep = Math.round(EDGE_KEEP_SECONDS * SAMPLE_RATE);
  const start = Math.max(first - keep, 0);
  const end = Math.min(last + 1 + keep, samples.length);
  return pcm.subarray(start * SAMPLE_WIDTH, end * SAMPLE_WIDTH);
}

// Trim edge silence, then reject audio whose spoken length is implausible for
// the chunk's text — the signature of a repeated/looping or truncated take.
export function validateChunkAudio(chunk, pcm) {
  const trimmed = trimEdgeSilence(pcm);
  const seconds = trimmed.byteLength / SAMPLE_WIDTH / SAMPLE_RATE;
  const expected = estimateChunkSeconds(chunk);
  const lower = Math.max(expected * MIN_DURATION_RATIO - 5, 3);
  const upper = expected * MAX_DURATION_RATIO + 10;
  if (seconds < lower || seconds > upper) {
    throw new Error(
      `audio runs ${seconds.toFixed(1)}s but the transcript should take ~${expected.toFixed(0)}s `
      + `(accepted ${lower.toFixed(0)}-${upper.toFixed(0)}s); the model likely repeated, looped, or truncated it`,
    );
  }
  return trimmed;
}

/** Median RMS of the voiced 50 ms frames, in dBFS; null when the audio has no speech. */
export function speechLevelDb(pcm) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / SAMPLE_WIDTH);
  const frame = Math.round(LEVEL_FRAME_SECONDS * SAMPLE_RATE);
  const levels = [];
  for (let start = 0; start + frame <= samples.length; start += frame) {
    let peak = 0;
    let energy = 0;
    for (let i = start; i < start + frame; i += 1) {
      const value = samples[i];
      peak = Math.max(peak, Math.abs(value));
      energy += value * value;
    }
    if (peak >= VOICED_FRAME_PEAK) levels.push(Math.sqrt(energy / frame));
  }
  if (levels.length === 0) return null;
  levels.sort((a, b) => a - b);
  return 20 * Math.log10(levels[Math.floor(levels.length / 2)] / FULL_SCALE);
}

/** Scales a chunk to the episode's speech loudness; peaks above the knee are softly limited. */
export function levelSpeech(pcm, targetDb = TARGET_SPEECH_DBFS) {
  const level = speechLevelDb(pcm);
  if (level === null) return pcm;
  const gainDb = Math.min(Math.max(targetDb - level, -MAX_LEVEL_GAIN_DB), MAX_LEVEL_GAIN_DB);
  const gain = 10 ** (gainDb / 20);
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / SAMPLE_WIDTH);
  const output = new Int16Array(input.length);
  const headroom = FULL_SCALE - LIMIT_KNEE;
  for (let i = 0; i < input.length; i += 1) {
    const scaled = input[i] * gain;
    const magnitude = Math.abs(scaled);
    const limited = magnitude <= LIMIT_KNEE
      ? magnitude
      : LIMIT_KNEE + headroom * Math.tanh((magnitude - LIMIT_KNEE) / headroom);
    output[i] = Math.round(Math.sign(scaled) * limited);
  }
  return Buffer.from(output.buffer);
}

class TtsModelError extends Error {}

// Voices one chunk with one model. Throws once that model has used its retries
// (or failed permanently); the episode then moves to the next model.
export async function synthesizeChunkWithRetry(ai, chunk, model = TTS_MODELS[0], { signal } = {}) {
  let transientRetries = 0;
  let badAudioRetries = 0;

  while (true) {
    if (signal?.aborted) throw new TtsModelError(`TTS chunk "${chunk.name}" was cancelled`);

    // Phase 1: the API call. Transient overloads and stalls retry with backoff.
    const timeoutMs = ttsCallTimeoutMs();
    const attempt = AbortSignal.timeout(timeoutMs);
    const started = Date.now();
    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: renderChunkPrompt(chunk) }] }],
        config: {
          abortSignal: signal ? AbortSignal.any([signal, attempt]) : attempt,
          responseModalities: ["AUDIO"],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: HOST_A, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_A } } },
                { speaker: HOST_B, voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_B } } },
              ],
            },
          },
        },
      });
    } catch (apiError) {
      if (signal?.aborted) throw new TtsModelError(`TTS chunk "${chunk.name}" was cancelled`);
      const timedOut = attempt.aborted;
      const message = timedOut
        ? `no audio after ${Math.round(timeoutMs / 1000)}s`
        : apiError instanceof Error ? apiError.message : String(apiError);
      // A permanent error (a preview model deprecated or renamed, as preview
      // models routinely are) would fail every day until someone noticed.
      if (!timedOut && !isRetryableApiError(apiError)) {
        throw new TtsModelError(`TTS chunk "${chunk.name}" failed: ${message}`);
      }
      if (transientRetries >= MAX_TRANSIENT_RETRIES) {
        throw new TtsModelError(
          `TTS chunk "${chunk.name}" failed after ${transientRetries} transient retries: ${message}`,
        );
      }
      transientRetries += 1;
      console.warn(
        `[podcast/tts] Transient error from ${model} on chunk "${chunk.name}" (retry ${transientRetries}/${MAX_TRANSIENT_RETRIES}): ${message}`,
      );
      await sleep(backoffDelay(transientRetries));
      continue;
    }

    // Phase 2: the call succeeded, so judge the audio itself. Unusable audio
    // (missing, repeated/looping, truncated) earns a fresh synthesis attempt.
    try {
      const pcm = validateChunkAudio(chunk, extractChunkPcm(response));
      console.log(`[podcast/tts] ${model} voiced chunk "${chunk.name}" in ${Math.round((Date.now() - started) / 1000)}s`);
      return pcm;
    } catch (audioError) {
      const message = audioError instanceof Error ? audioError.message : String(audioError);
      if (badAudioRetries >= MAX_BAD_AUDIO_RETRIES) {
        throw new TtsModelError(`TTS chunk "${chunk.name}" kept returning unusable audio: ${message}`);
      }
      badAudioRetries += 1;
      console.warn(
        `[podcast/tts] Unusable audio from ${model} on chunk "${chunk.name}" (retry ${badAudioRetries}/${MAX_BAD_AUDIO_RETRIES}): ${message}`,
      );
      await sleep(backoffDelay(badAudioRetries));
    }
  }
}

// Every chunk with one model, a few at a time and longest first; results keep
// script order. The first failure cancels the rest so the next model starts sooner.
async function synthesizeEpisodeChunks(ai, chunks, model) {
  const controller = new AbortController();
  const results = new Array(chunks.length);
  const order = chunks.map((_, index) => index)
    .sort((a, b) => estimateChunkSeconds(chunks[b]) - estimateChunkSeconds(chunks[a]));
  let next = 0;
  let failure = null;
  async function worker() {
    while (next < order.length && !failure) {
      const index = order[next];
      next += 1;
      try {
        results[index] = await synthesizeChunkWithRetry(ai, chunks[index], model, { signal: controller.signal });
      } catch (error) {
        failure ||= error;
        controller.abort();
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(TTS_CONCURRENCY, order.length) }, worker));
  if (failure) throw failure;
  return results;
}

function estimateMp3Duration(pcmBuffers) {
  const totalSamples = pcmBuffers.reduce((acc, b) => acc + b.byteLength / SAMPLE_WIDTH, 0);
  return Math.round(totalSamples / SAMPLE_RATE);
}

// Synthesize every chunk with one model, level them, concat to a single MP3,
// return { size, duration, model }.
export async function synthesizePodcast(script, { outputMp3Path, workDir }) {
  const ai = createServerGeminiClient();
  if (!ai) throw new Error("Gemini API key is not configured");

  await mkdir(workDir, { recursive: true });

  let pcmBuffers = null;
  let usedModel = null;
  for (const [index, model] of TTS_MODELS.entries()) {
    try {
      pcmBuffers = await synthesizeEpisodeChunks(ai, script.chunks, model);
      usedModel = model;
      break;
    } catch (error) {
      if (index === TTS_MODELS.length - 1) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[podcast/tts] ${model} could not voice every chunk (${message}); re-voicing the whole episode with ${TTS_MODELS[index + 1]} so the hosts sound the same throughout.`,
      );
    }
  }

  const levelled = pcmBuffers.map((pcm) => levelSpeech(pcm));
  const duration = estimateMp3Duration(levelled);
  const mp3Buffer = pcmBuffersToMp3(levelled);
  await writeFile(outputMp3Path, mp3Buffer);

  await rm(workDir, { recursive: true, force: true });

  return { size: mp3Buffer.length, duration, mp3Buffer, model: usedModel };
}
