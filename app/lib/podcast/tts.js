// Synthesize each script chunk with Gemini multi-speaker TTS, then concat into one MP3.
// Splitting per chunk keeps each TTS call under the "few minutes" drift threshold.

import { GoogleGenAI } from "@google/genai";
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
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

const VOICE_A = "Sulafat";    // Warm
const VOICE_B = "Laomedeia";  // Upbeat

const DIRECTOR_PREAMBLE = `You are synthesizing a daily bilingual English/Mandarin news podcast.

AUDIO PROFILE
- ${HOST_A}: warm, thoughtful, mid-range voice. Sounds like a friend who has read the news carefully and wants to share it.
- ${HOST_B}: upbeat, curious, lively voice. Brings energy and asks follow-up questions.

DIRECTOR'S NOTES
- Style: friendly, enthusiastic, conversational — the "vocal smile" is audible. They react to each other, not read from a script.
- Pacing: natural spoken pace; slight speed-ups on excitement words, gentle pauses at story transitions.
- Language: primary language is English. Inline short Chinese translations (e.g. "hawkish 鹰派") are glosses for learners — read them naturally in Mandarin, then return to English without pausing awkwardly.
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

function writeWavHeader(pcmLength) {
  const byteRate = SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH;
  const blockAlign = CHANNELS * SAMPLE_WIDTH;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(SAMPLE_WIDTH * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmLength, 40);
  return header;
}

async function pcmToWavFile(pcmBuffer, filePath) {
  const header = writeWavHeader(pcmBuffer.length);
  await writeFile(filePath, Buffer.concat([header, pcmBuffer]));
}

function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
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

async function getMp3Duration(mp3Path) {
  try {
    const { stdout } = await runProcess("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      mp3Path,
    ]);
    const seconds = parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? Math.round(seconds) : 0;
  } catch {
    return 0;
  }
}

// Synthesize every chunk, concat to single MP3, return { size, duration }.
export async function synthesizePodcast(script, { outputMp3Path, workDir }) {
  await mkdir(workDir, { recursive: true });

  const wavFiles = [];
  for (const chunk of script.chunks) {
    const pcm = await synthesizeChunkWithRetry(chunk);
    const wavPath = path.join(workDir, `${chunk.name}.wav`);
    await pcmToWavFile(pcm, wavPath);
    wavFiles.push(wavPath);
  }

  const listPath = path.join(workDir, "concat.txt");
  const listContent = wavFiles.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, listContent);

  await runProcess("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c:a", "libmp3lame",
    "-b:a", "96k",
    "-ac", "1",
    "-ar", "24000",
    outputMp3Path,
  ]);

  const { size } = await stat(outputMp3Path);
  const duration = await getMp3Duration(outputMp3Path);

  await rm(workDir, { recursive: true, force: true });

  return { size, duration };
}
