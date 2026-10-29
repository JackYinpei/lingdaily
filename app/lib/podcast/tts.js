// Fixed-identity single-speaker turns, assembled in authored script order.
import { writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Mp3Encoder from "@breezystack/lamejs";
import { countHanCharacters, countLatinWords } from "./script.js";
import { synthesizeTurns } from "./tts-rest.js";

const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const SAMPLE_WIDTH = 2;
const MP3_KBPS = 96;
const FULL_SCALE = 32767;


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

// Per-turn speech has no inter-turn gap and cannot use the chunk's 5s slack.
// Allow fast delivery and very short acknowledgements, but reject clipped takes.
export function validateTurnAudio(turn, pcm) {
  const trimmed = trimEdgeSilence(pcm);
  const duration = trimmed.length / SAMPLE_WIDTH / SAMPLE_RATE;
  const expected = estimateChunkSeconds({ turns: [turn] });
  const speakingSeconds = expected - TURN_GAP_SECONDS;
  const lower = Math.max(0.12, speakingSeconds * 0.4 - 0.15);
  const upper = expected * MAX_DURATION_RATIO + 10;
  if (duration < lower || duration > upper) throw new Error("Invalid turn duration: repeated, looped, truncated or silent audio");
  return trimmed;
}

export async function synthesizePodcast(script, { outputMp3Path, workDir, signal } = {}) {
  // No language inference or reordering: LL中文/DD英文/DD中文/LL英文 stays as authored.
  if (!Array.isArray(script?.chunks) || script.chunks.some(chunk => !Array.isArray(chunk.turns))) throw new Error("Invalid podcast script chunks");
  const turns = script.chunks.flatMap(chunk => chunk.turns);
  const { results, model, gap } = await synthesizeTurns(turns, { workDir, signal, validate: validateTurnAudio });
  if (signal?.aborted) throw new Error("TTS cancelled (abort)");
  const buffers = [];
  const silence = Buffer.alloc(Math.round(gap * SAMPLE_RATE / 1000) * SAMPLE_WIDTH);
  for (const [index, result] of results.entries()) {
    if (index && silence.length) buffers.push(silence);
    buffers.push(levelSpeech(result.pcm));
  }
  const duration = Math.round(buffers.reduce((sum, b) => sum + b.length / SAMPLE_WIDTH / SAMPLE_RATE, 0));
  const mp3Buffer = pcmBuffersToMp3(buffers);
  const temporary = `${outputMp3Path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, mp3Buffer, { flag: "wx" });
    if (signal?.aborted) throw new Error("TTS cancelled (abort)");
    await rename(temporary, outputMp3Path);
  } finally { await unlink(temporary).catch(() => {}); }
  return { size: mp3Buffer.length, duration, mp3Buffer, model, metadata: { turns: results.map(r => r.metadata), turnGapMs: gap } };
}
