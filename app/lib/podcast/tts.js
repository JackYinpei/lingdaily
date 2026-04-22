// Synthesize each script chunk with Gemini multi-speaker TTS, then concat into one MP3.
// Splitting per chunk keeps each TTS call under the "few minutes" drift threshold.

import { GoogleGenAI } from "@google/genai";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import Mp3Encoder from "@breezystack/lamejs";
import { HOST_A, HOST_B } from "./script.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  httpOptions: process.env.GOOGLE_GEMINI_BASE_URL
    ? { baseUrl: process.env.GOOGLE_GEMINI_BASE_URL }
    : undefined,
});

const TTS_MODEL = "gemini-3.1-flash-tts-preview";
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const SAMPLE_WIDTH = 2;
const MP3_KBPS = 96;

const VOICE_A = "Sulafat";    // Warm
const VOICE_B = "Laomedeia";  // Upbeat

const DIRECTOR_PREAMBLE = `You are synthesizing a daily bilingual English/Mandarin news podcast.

AUDIO PROFILE
- ${HOST_A}: warm, thoughtful, mid-range voice. Sounds like a friend who has read the news carefully and wants to share it.
- ${HOST_B}: upbeat, curious, lively voice. Brings energy and asks follow-up questions.

DIRECTOR'S NOTES
- Style: friendly, enthusiastic, conversational — the "vocal smile" is audible. They react to each other, not read from a script.
- Pacing: natural spoken pace; slight speed-ups on excitement words, gentle pauses at story transitions.
- Language: bilingual with clear Chinese support. Keep a natural mix where English is the base and Chinese explanations are substantial (about 35-45% of spoken content).
- Inline short Chinese translations (e.g. "hawkish 鹰派") are glosses for learners — read them naturally in Mandarin, then return to English without pausing awkwardly.
- Accent: clear, neutral English; standard Mandarin for the Chinese glosses.
- Do not read bracketed directions or speaker labels out loud.

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

async function synthesizeChunkWithRetry(chunk, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: renderChunkPrompt(chunk) }] }],
        config: {
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
      const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!data) throw new Error("TTS returned no audio data (possibly text token fallthrough)");
      return Buffer.from(data, "base64");
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
  }
  throw new Error(`TTS chunk "${chunk.name}" failed after ${attempts} attempts: ${lastErr?.message}`);
}

function estimateMp3Duration(pcmBuffers) {
  const totalSamples = pcmBuffers.reduce((acc, b) => acc + b.byteLength / SAMPLE_WIDTH, 0);
  return Math.round(totalSamples / SAMPLE_RATE);
}

// Synthesize every chunk, concat to single MP3, return { size, duration }.
export async function synthesizePodcast(script, { outputMp3Path, workDir }) {
  await mkdir(workDir, { recursive: true });

  const pcmBuffers = [];
  for (const chunk of script.chunks) {
    const pcm = await synthesizeChunkWithRetry(chunk);
    pcmBuffers.push(pcm);
  }

  const duration = estimateMp3Duration(pcmBuffers);
  const mp3Buffer = pcmBuffersToMp3(pcmBuffers);
  await writeFile(outputMp3Path, mp3Buffer);

  await rm(workDir, { recursive: true, force: true });

  return { size: mp3Buffer.length, duration };
}
