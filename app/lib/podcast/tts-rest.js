// REST deliberately preserves Gemini 3.8's speech_metadata and custom voice fields.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getServerGeminiApiKey, getServerGeminiBaseUrl } from '@/app/lib/server/geminiConfig';

const FORMAT = 'pcm16le-mono-24000-v1';
const DEFAULT_STYLE = 'bright, upbeat morning-news delivery; warm, engaged, conversational; crisp but unhurried; steady, not theatrical';
const hash = value => createHash('sha256').update(value).digest('hex');
export function numberSetting(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw?.trim() ? Number(raw) : NaN;
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
export function ttsSettings() {
  const voices = Object.fromEntries(['LL', 'DD'].map(speaker => {
    const voice = process.env[`PODCAST_TTS_VOICE_${speaker}`]?.trim();
    if (!voice) throw new Error(`Missing fixed voice: PODCAST_TTS_VOICE_${speaker}`);
    return [speaker, voice];
  }));
  const style = (process.env.PODCAST_TTS_STYLE || DEFAULT_STYLE).trim();
  if (!style || style.length > 300 || /[\r\n]/.test(style)) throw new Error('PODCAST_TTS_STYLE must be one short line (1-300 characters)');
  const model = (process.env.PODCAST_TTS_MODEL || 'gemini-3.8-flash-tts').trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid PODCAST_TTS_MODEL');
  const key = getServerGeminiApiKey();
  if (!key) throw new Error('Gemini API key is not configured');
  const base = (getServerGeminiBaseUrl() || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '').replace(/\/v1(?:beta)?$/, '');
  return { voices, style, model, key, url: `${base}/v1beta/models/${model}:generateContent`,
    retries: Math.floor(numberSetting('PODCAST_TTS_MAX_RETRIES', 5, 0, 10)),
    timeout: numberSetting('PODCAST_TTS_CALL_TIMEOUT_MS', 240000, 1, 600000),
    base: numberSetting('PODCAST_TTS_RETRY_BASE_MS', 1000, 1, 60000),
    cap: numberSetting('PODCAST_TTS_RETRY_CAP_MS', 60000, 1, 300000),
    concurrency: Math.floor(numberSetting('PODCAST_TTS_CONCURRENCY', 2, 1, 5)),
    gap: numberSetting('PODCAST_TTS_TURN_GAP_MS', 180, 0, 2000) };
}
function abortError() { return new Error('TTS cancelled (abort)'); }
export function wait(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(abortError()); };
    const timer = setTimeout(done, Math.max(0, ms));
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export function retryDelayMs(headers, body, now = Date.now()) {
  const header = headers?.get('retry-after');
  let delay = header == null ? 0 : /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(delay)) delay = 0;
  for (const detail of body?.error?.details || []) {
    if (detail?.['@type'] !== 'type.googleapis.com/google.rpc.RetryInfo') continue;
    const d = detail.retryDelay;
    const seconds = typeof d === 'string' && /^\d+(?:\.\d+)?s$/.test(d) ? Number(d.slice(0, -1)) :
      d && typeof d === 'object' ? Number(d.seconds || 0) + Number(d.nanos || 0) / 1e9 : 0;
    if (Number.isFinite(seconds)) delay = Math.max(delay, seconds * 1000);
  }
  return Math.max(0, delay);
}
function checkPcm(pcm) {
  if (!pcm.length || pcm.length % 2) throw new Error('Invalid PCM16 audio length');
  return Buffer.from(pcm); // owned, aligned buffer for Int16Array consumers
}
export function parseAudio(bytes, mime) {
  const type = mime?.split(';')[0].trim().toLowerCase();
  if (type === 'audio/l16') {
    if (!/;\s*rate=24000(?:\s*;|\s*$)/i.test(mime) || (/channels=/i.test(mime) && !/;\s*channels=1(?:\s*;|\s*$)/i.test(mime))) throw new Error('Unsupported raw PCM format');
    if (bytes.subarray(0, 4).toString() === 'RIFF') throw new Error('WAV incorrectly labelled as raw PCM');
    return checkPcm(bytes);
  }
  if (type !== 'audio/wav' && type !== 'audio/x-wav') throw new Error('Unsupported audio MIME type');
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Invalid RIFF/WAVE length');
  let format = false, data = null;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('Truncated WAV chunk');
    const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size + (size % 2) > bytes.length) throw new Error('Truncated WAV chunk');
    if (id === 'fmt ') {
      if (format || size < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 || bytes.readUInt32LE(start + 4) !== 24000 || bytes.readUInt32LE(start + 8) !== 48000 || bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt16LE(start + 14) !== 16) throw new Error('WAV must be PCM16 mono 24000 Hz');
      format = true;
    }
    if (id === 'data') { if (data) throw new Error('Multiple WAV data chunks'); data = bytes.subarray(start, start + size); }
    offset = start + size + (size % 2);
  }
  if (!format || !data) throw new Error('Missing WAV format/data chunk');
  return checkPcm(data);
}
function extractAudio(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const audio = parts.filter(p => p?.inlineData?.data).map(p => {
    const { data, mimeType } = p.inlineData;
    if (typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Invalid audio base64');
    return parseAudio(Buffer.from(data, 'base64'), mimeType);
  });
  if (!audio.length) throw new Error('Response contains no audio');
  return Buffer.concat(audio);
}
async function cached(dir, fingerprint, validate) {
  try {
    const meta = JSON.parse(await readFile(path.join(dir, `${fingerprint}.json`), 'utf8'));
    // Metadata is the commit record and names an immutable PCM generation.
    if (meta.fingerprint !== fingerprint || meta.format !== FORMAT || !/^[a-f0-9-]+\.pcm$/.test(meta.file)) return null;
    const pcm = await readFile(path.join(dir, meta.file));
    if (meta.sha256 !== hash(pcm) || meta.bytes !== pcm.length || meta.duration !== pcm.length / 48000) return null;
    checkPcm(pcm);
    const checked = validate(pcm);
    return { pcm: checked, rawDuration: meta.duration, synthesis: meta.synthesis };
  } catch { return null; }
}
async function cacheWrite(dir, fingerprint, pcm, synthesis) {
  const file = `${fingerprint}-${randomUUID()}.pcm`;
  const temporary = path.join(dir, `${fingerprint}.${randomUUID()}.tmp`);
  try {
    await writeFile(path.join(dir, file), pcm, { flag: 'wx', mode: 0o600 });
    await writeFile(temporary, JSON.stringify({ fingerprint, format: FORMAT, file, sha256: hash(pcm), bytes: pcm.length, duration: pcm.length / 48000, synthesis }), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path.join(dir, `${fingerprint}.json`));
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function synthesizeTurns(turns, { workDir, signal, validate }) {
  const settings = ttsSettings();
  for (const turn of turns) if (!settings.voices[turn.speaker] || typeof turn.text !== 'string' || !turn.text.trim()) throw new Error('Invalid TTS turn: expected LL/DD and nonempty text');
  if (!turns.length) throw new Error('TTS script contains no turns');
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  const controller = new AbortController();
  const sharedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let next = 0, failure, cooldownUntil = 0;
  const results = new Array(turns.length);
  async function cooldown() { while (cooldownUntil > Date.now()) await wait(cooldownUntil - Date.now(), sharedSignal); if (sharedSignal.aborted) throw abortError(); }
  async function voiceTurn(turn, index) {
    const started = Date.now(), voice = settings.voices[turn.speaker];
    const fingerprint = hash(JSON.stringify({ format: FORMAT, model: settings.model, voice, style: settings.style, text: turn.text }));
    const metadata = { index, speaker: turn.speaker, model: settings.model, requestedModel: settings.model, modelVersion: null, voice, fingerprint, attempts: 0, cacheHit: false, attemptTimings: [] };
    const check = pcm => validate(turn, pcm);
    const hit = await cached(workDir, fingerprint, check);
    let pcm = hit?.pcm, rawPcm, invalidResponses = 0;
    if (sharedSignal.aborted) throw abortError();
    if (pcm) { metadata.cacheHit = true; metadata.modelVersion = hit.synthesis?.modelVersion ?? null; }
    else for (let attempt = 0; attempt <= settings.retries; attempt++) {
      await cooldown();
      const attemptStart = Date.now();
      metadata.attempts++;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), settings.timeout);
      let retryable = false, serverDelay = 0, status = 'network';
      try {
        const response = await fetch(settings.url, { method: 'POST', headers: { 'x-goog-api-key': settings.key, 'Content-Type': 'application/json' }, signal: AbortSignal.any([sharedSignal, timeout.signal]), body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: turn.text, speech_metadata: { style: settings.style } }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } } }) });
        status = response.status;
        retryable = [429, 500, 502, 503, 504].includes(response.status);
        let body;
        try { body = await response.json(); } catch (error) { if (response.ok) throw error; }
        if (!response.ok) {
          serverDelay = retryDelayMs(response.headers, body);
          throw new Error(`HTTP ${response.status}`);
        }
        rawPcm = extractAudio(body);
        pcm = check(rawPcm);
        metadata.modelVersion = typeof body.modelVersion === 'string' ? body.modelVersion : null;
      } catch (error) {
        if (sharedSignal.aborted) throw abortError();
        const network = error instanceof TypeError || ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENETUNREACH', 'ECONNREFUSED', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.cause?.code || error?.code);
        const successfulResponse = typeof status === 'number' && status >= 200 && status < 300;
        // Successful HTTP is not necessarily usable speech. Retry bad JSON,
        // decoding and validation failures twice, within the total retry budget.
        // Never turn a permanent HTTP failure into a retry via its body error.
        if (successfulResponse) retryable = ++invalidResponses <= 2;
        else if (status === 'network') retryable ||= timeout.signal.aborted || network;
        const reason = timeout.signal.aborted ? 'timeout' : typeof status === 'number' && status !== 200 ? `HTTP ${status}` : network ? 'network interruption' : 'invalid audio response';
        const delay = Math.max(serverDelay, Math.min(settings.cap, settings.base * 2 ** attempt) * (0.5 + Math.random() * 0.5));
        if (retryable) cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
        metadata.attemptTimings.push({ attempt: attempt + 1, elapsedMs: Date.now() - attemptStart, status: reason });
        if (!retryable || attempt === settings.retries) throw new Error(`TTS turn ${index} (${turn.speaker}, ${settings.model}) failed after ${attempt + 1} attempts: ${reason}`);
        continue;
      } finally { clearTimeout(timer); }
      metadata.attemptTimings.push({ attempt: attempt + 1, elapsedMs: Date.now() - attemptStart, status });
      // Do not interrupt a completed cache commit when a sibling fails.
      // Persist decoded model PCM before trim/levelling; never alter pitch.
      await cacheWrite(workDir, fingerprint, rawPcm, { ...metadata, elapsedMs: Date.now() - started, duration: pcm.length / 48000, rawDuration: rawPcm.length / 48000 });
      break;
    }
    metadata.elapsedMs = Date.now() - started;
    metadata.duration = pcm.length / 48000;
    metadata.rawDuration = rawPcm ? rawPcm.length / 48000 : hit.rawDuration;
    return { pcm, metadata };
  }
  async function worker() {
    while (!failure && next < turns.length) {
      const index = next++;
      try { results[index] = await voiceTurn(turns[index], index); }
      catch (error) { failure ||= error; controller.abort(); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(settings.concurrency, turns.length) }, worker));
  if (failure) throw failure;
  return { results, model: settings.model, gap: settings.gap };
}
