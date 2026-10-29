import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
vi.mock('@/app/lib/server/geminiConfig', () => ({ getServerGeminiApiKey: () => 'test-key', getServerGeminiBaseUrl: () => 'https://relay.test/v1beta/' }));
import { estimateChunkSeconds, synthesizePodcast } from '@/app/lib/podcast/tts';
import { parseAudio, retryDelayMs } from '@/app/lib/podcast/tts-rest';
const pcm = Buffer.alloc(24000 * 2);
for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(Math.sin(i / 7) * 8000), i);
function response(bytes = pcm, mimeType = 'audio/L16;rate=24000') { return new Response(JSON.stringify({ modelVersion: 'gemini-3.8-flash-tts-actual', candidates: [{ content: { parts: [{ inlineData: { mimeType, data: bytes.toString('base64') } }] } }] })); }
function wav(bytes = pcm) {
 const b = Buffer.alloc(56 + bytes.length); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('JUNK', 36); b.writeUInt32LE(4, 40); b.write('data', 48); b.writeUInt32LE(bytes.length, 52); bytes.copy(b, 56); return b;
}
const turns = [{ speaker: 'LL', text: '早上好。' }, { speaker: 'DD', text: 'Good morning.' }, { speaker: 'DD', text: '今天的新闻。' }, { speaker: 'LL', text: 'Today in news.' }];
let dir;
beforeEach(async () => { dir = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), 'tts-test-')); vi.stubEnv('PODCAST_TTS_VOICE_LL', 'voice_ll'); vi.stubEnv('PODCAST_TTS_VOICE_DD', 'voice_dd'); vi.stubEnv('PODCAST_TTS_RETRY_BASE_MS', '1'); vi.stubEnv('PODCAST_TTS_RETRY_CAP_MS', '2'); });
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
const run = (dir, ts = turns, extra = {}) => synthesizePodcast({ chunks: [{ turns: ts }] }, { outputMp3Path: path.join(dir, 'out.mp3'), workDir: path.join(dir, 'cache'), ...extra });
const invalidResponses = [
 ['malformed JSON', () => new Response('{')],
 ['missing audio', () => new Response('{}')],
 ['invalid base64', () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: '***' } }] } }] }))],
 ['odd PCM length', () => response(Buffer.alloc(3))],
 ['invalid WAV', () => response(wav().subarray(0, 60), 'audio/wav')],
 ['unsupported MIME', () => response(pcm, 'audio/mpeg')],
 ['silence', () => response(Buffer.alloc(48000))],
 ['looped audio', () => response(Buffer.concat(Array(20).fill(pcm)))],
];
describe('Gemini 3.8 REST turn synthesis', () => {
 it.each(invalidResponses)('recovers from HTTP 200 %s without changing the request', async (_, badResponse) => {
  const fetch = vi.fn().mockImplementationOnce(async () => badResponse()).mockImplementation(async () => response()); vi.stubGlobal('fetch', fetch);
  const result = await run(dir, turns.slice(0, 1));
  expect(fetch).toHaveBeenCalledTimes(2); expect(result.metadata.turns[0].attempts).toBe(2);
  expect(fetch.mock.calls[0][0]).toBe(fetch.mock.calls[1][0]); expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  const files = await readdir(path.join(dir, 'cache')); expect(files.filter(f => f.endsWith('.pcm'))).toHaveLength(1); expect(files.filter(f => f.endsWith('.json'))).toHaveLength(1);
  const reused = await run(dir, turns.slice(0, 1)); expect(reused.metadata.turns[0].cacheHit).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
 });
 it.each(invalidResponses)('bounds HTTP 200 %s retries and leaves no cache or partial MP3', async (_, badResponse) => {
  const fetch = vi.fn(async () => badResponse()); vi.stubGlobal('fetch', fetch);
  await expect(run(dir, turns.slice(0, 1))).rejects.toThrow('3 attempts'); expect(fetch).toHaveBeenCalledTimes(3);
  expect(await readdir(path.join(dir, 'cache'))).toEqual([]); expect(await readdir(dir)).toEqual(['cache']);
 });
 it.each([0, 1])('respects the total retry limit %i for invalid HTTP 200 responses', async retries => {
  vi.stubEnv('PODCAST_TTS_MAX_RETRIES', String(retries)); const fetch = vi.fn(async () => new Response('{')); vi.stubGlobal('fetch', fetch);
  await expect(run(dir, turns.slice(0, 1))).rejects.toThrow(`${retries + 1} attempts`); expect(fetch).toHaveBeenCalledTimes(retries + 1);
 });
 it('rejects a 0.2s clipped take for a 3.8s turn without caching or publishing it', async () => {
  const turn = { speaker: 'LL', text: '今天我们关注全球市场的重要变化。' }; expect(estimateChunkSeconds({ turns: [turn] })).toBeCloseTo(3.8);
  const fetch = vi.fn(async () => response(pcm.subarray(0, 9600))); vi.stubGlobal('fetch', fetch);
  await expect(run(dir, [turn])).rejects.toThrow('invalid audio response'); expect(fetch).toHaveBeenCalledTimes(3);
  expect(await readdir(path.join(dir, 'cache'))).toEqual([]); expect(await readdir(dir)).toEqual(['cache']);
  fetch.mockImplementation(async () => response(Buffer.concat([pcm, pcm, pcm])));
  const recovered = await run(dir, [turn]); expect(recovered.metadata.turns[0].cacheHit).toBe(false); expect(recovered.metadata.turns[0].duration).toBe(3);
 });
 it('stores new cache files privately', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response())); await run(dir, turns.slice(0, 1));
  const cache = path.join(dir, 'cache'); expect((await stat(cache)).mode & 0o777).toBe(0o700);
  for (const file of await readdir(cache)) expect((await stat(path.join(cache, file))).mode & 0o777).toBe(0o600);
 });
 it('revalidates legacy clipped cache even when its checksum and metadata agree', async () => {
  const turn = { speaker: 'LL', text: '今天我们关注全球市场的重要变化。' };
  const fetch = vi.fn(async () => response(Buffer.concat([pcm, pcm, pcm]))); vi.stubGlobal('fetch', fetch); await run(dir, [turn]);
  const cache = path.join(dir, 'cache'); const files = await readdir(cache); const metadataPath = path.join(cache, files.find(f => f.endsWith('.json')));
  const meta = JSON.parse(await readFile(metadataPath, 'utf8')); const clipped = pcm.subarray(0, 9600);
  await writeFile(path.join(cache, meta.file), clipped); await writeFile(metadataPath, JSON.stringify({ ...meta, bytes: clipped.length, duration: 0.2, sha256: createHash('sha256').update(clipped).digest('hex') }));
  const result = await run(dir, [turn]); expect(fetch).toHaveBeenCalledTimes(2); expect(result.metadata.turns[0].cacheHit).toBe(false); expect(result.metadata.turns[0].duration).toBe(3);
 });
 it('uses fixed single voices, exact new contract and stable order under concurrency', async () => {
  let active = 0, peak = 0; const fetch = vi.fn(async () => { peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 5)); active--; return response(wav(), 'audio/wav'); }); vi.stubGlobal('fetch', fetch);
  const result = await run(dir);
  expect(peak).toBe(2); expect(result.model).toBe('gemini-3.8-flash-tts'); expect(result.metadata.turns.map(t => t.speaker)).toEqual(['LL', 'DD', 'DD', 'LL']);
  expect(result.size).toBeGreaterThan(1000); expect((await readFile(path.join(dir, 'out.mp3'))).length).toBe(result.size);
  expect(result.metadata.turns[0]).toMatchObject({ requestedModel: 'gemini-3.8-flash-tts', modelVersion: 'gemini-3.8-flash-tts-actual' });
  fetch.mock.calls.forEach(([url, options], i) => { expect(url).toBe('https://relay.test/v1beta/models/gemini-3.8-flash-tts:generateContent'); const body = JSON.parse(options.body); expect(body.contents).toEqual([{ role: 'user', parts: [{ text: turns[i].text, speech_metadata: { style: expect.stringContaining('upbeat') } }] }]); expect(body.generationConfig).toEqual({ responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: i === 0 || i === 3 ? 'voice_ll' : 'voice_dd' } } }); });
 });
 it('fails clearly with missing fixed voice before fetching', async () => { vi.stubEnv('PODCAST_TTS_VOICE_LL', ''); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); await expect(run(dir)).rejects.toThrow('PODCAST_TTS_VOICE_LL'); expect(fetch).not.toHaveBeenCalled(); });
 it('reuses validated cache, invalidates text/style/voice/model and repairs corruption', async () => {
  const fetch = vi.fn(async () => response()); vi.stubGlobal('fetch', fetch);
  await run(dir, turns.slice(0, 1)); const cached = await run(dir, turns.slice(0, 1)); expect(fetch).toHaveBeenCalledTimes(1); expect(cached.metadata.turns[0].cacheHit).toBe(true);
  expect(cached.metadata.turns[0].modelVersion).toBe('gemini-3.8-flash-tts-actual');
  await run(dir, [{ ...turns[0], text: '另一条新闻。' }]); vi.stubEnv('PODCAST_TTS_STYLE', 'bright, upbeat'); await run(dir, turns.slice(0, 1)); vi.stubEnv('PODCAST_TTS_VOICE_LL', 'other'); await run(dir, turns.slice(0, 1)); vi.stubEnv('PODCAST_TTS_MODEL', 'another-model'); await run(dir, turns.slice(0, 1)); expect(fetch).toHaveBeenCalledTimes(5);
  const files = await readdir(path.join(dir, 'cache')); for (const f of files.filter(f => f.endsWith('.pcm'))) await writeFile(path.join(dir, 'cache', f), 'broken');
  await run(dir, turns.slice(0, 1)); expect(fetch).toHaveBeenCalledTimes(6);
 });
 it.each([400, 401, 403, 404, 501, 505])('does not retry permanent %i or leak API error text', async status => { const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'secret API echo' } }), { status })); vi.stubGlobal('fetch', fetch); await expect(run(dir, turns.slice(0, 1))).rejects.toThrow(`HTTP ${status}`); expect(fetch).toHaveBeenCalledTimes(1); });
 it('retries 429 on the same voice, honors Retry-After and shares cooldown', async () => {
  vi.stubEnv('PODCAST_TTS_CONCURRENCY', '1'); const times = []; const fetch = vi.fn(async () => { times.push(Date.now()); return times.length === 1 ? new Response('{}', { status: 429, headers: { 'Retry-After': '0.04' } }) : response(); }); vi.stubGlobal('fetch', fetch);
  const result = await run(dir, turns.slice(0, 2)); expect(times[1] - times[0]).toBeGreaterThanOrEqual(35); expect(result.metadata.turns[0].attempts).toBe(2); expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('parses RetryInfo and HTTP-date delay', () => { const now = Date.parse('2026-10-29T00:00:00Z'); expect(retryDelayMs(new Headers({ 'Retry-After': 'Thu, 29 Oct 2026 00:00:03 GMT' }), {}, now)).toBe(3000); expect(retryDelayMs(new Headers(), { error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1.25s' }] } }, now)).toBe(1250); });
 it('retries network failure and timed out fetch', async () => { vi.stubEnv('PODCAST_TTS_CALL_TIMEOUT_MS', '10'); const fetch = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockImplementationOnce((url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))).mockImplementation(async () => response()); vi.stubGlobal('fetch', fetch); const result = await run(dir, turns.slice(0, 1)); expect(result.metadata.turns[0].attempts).toBe(3); });
 it('aborts fetches and sleeps promptly', async () => { const c = new AbortController(); const fetch = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })); vi.stubGlobal('fetch', fetch); const pending = run(dir, turns.slice(0, 1), { signal: c.signal }); const assertion = expect(pending).rejects.toThrow(/abort|cancel/i); setTimeout(() => c.abort(), 20); await assertion; expect(fetch).toHaveBeenCalledTimes(1); });
 it('bounds retry budget and never falls back', async () => { vi.stubEnv('PODCAST_TTS_MAX_RETRIES', '2'); const fetch = vi.fn(async () => new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetch); await expect(run(dir, turns.slice(0, 1))).rejects.toThrow('3 attempts'); expect(fetch).toHaveBeenCalledTimes(3); });
 it('defaults to six attempts, not six retries', async () => { const fetch = vi.fn(async () => new Response('{}', { status: 429 })); vi.stubGlobal('fetch', fetch); await expect(run(dir, turns.slice(0, 1))).rejects.toThrow('6 attempts'); expect(fetch).toHaveBeenCalledTimes(6); });
 it('retries interrupted response-body reads', async () => { const fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new TypeError('terminated'); } }).mockImplementation(async () => response()); vi.stubGlobal('fetch', fetch); await run(dir, turns.slice(0, 1)); expect(fetch).toHaveBeenCalledTimes(2); });
 it('cancels an in-flight fetch on caller abort', async () => { const controller = new AbortController(); let aborted = false; const fetch = vi.fn((url, { signal }) => new Promise((_, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }); setTimeout(() => controller.abort(), 5); })); vi.stubGlobal('fetch', fetch); await expect(run(dir, turns.slice(0, 1), { signal: controller.signal })).rejects.toThrow(/abort|cancel/i); expect(aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1); });
 it('decodes every WAV inline part without concatenating RIFF headers', async () => { const data = wav().toString('base64'); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data } }, { inlineData: { mimeType: 'audio/wav', data } }] } }] })))); const result = await run(dir, turns.slice(0, 1)); expect(result.metadata.turns[0].duration).toBe(2); });
 it('persists untouched raw PCM while trimming only the rendered take', async () => {
  const original = Buffer.concat([pcm, Buffer.alloc(4 * 48000)]); const fetch = vi.fn(async () => response(original)); vi.stubGlobal('fetch', fetch);
  const first = await run(dir, turns.slice(0, 1)); const files = await readdir(path.join(dir, 'cache')); const stored = await readFile(path.join(dir, 'cache', files.find(f => f.endsWith('.pcm'))));
  expect(stored).toEqual(original); expect(first.metadata.turns[0].duration).toBeLessThan(2); expect(first.metadata.turns[0].rawDuration).toBe(5);
  const second = await run(dir, turns.slice(0, 1)); expect(second.mp3Buffer).toEqual(first.mp3Buffer); expect(second.metadata.turns[0].cacheHit).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
 });
 it.each([500, 502, 503, 504])('retries transient HTTP %i', async status => { const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status })).mockImplementation(async () => response()); vi.stubGlobal('fetch', fetch); await run(dir, turns.slice(0, 1)); expect(fetch).toHaveBeenCalledTimes(2); });
 it('makes another worker respect episode-wide 429 cooldown', async () => {
  const calls = []; const fetch = vi.fn(async (url, { body }) => {
   const text = JSON.parse(body).contents[0].parts[0].text; calls.push({ text, time: Date.now() });
   if (calls.length === 1) return new Response('{}', { status: 429, headers: { 'Retry-After': '0.08' } });
   await new Promise(r => setTimeout(r, 5)); return response();
  }); vi.stubGlobal('fetch', fetch); await run(dir);
  // One request was already in flight with the 429. All newly started work waits.
  expect(calls.length).toBe(5); expect(calls.slice(2).every(c => c.time - calls[0].time >= 70)).toBe(true);
 });
 it('preserves completed turns after sibling failure and resumes only missing work', async () => {
  vi.stubEnv('PODCAST_TTS_CONCURRENCY', '1');
  const fetch = vi.fn().mockImplementationOnce(async () => response()).mockResolvedValueOnce(new Response('{}', { status: 403 })); vi.stubGlobal('fetch', fetch);
  await expect(run(dir, turns.slice(0, 2))).rejects.toThrow('HTTP 403');
  fetch.mockImplementation(async () => response()); const resumed = await run(dir, turns.slice(0, 2));
  expect(fetch).toHaveBeenCalledTimes(3); expect(resumed.metadata.turns.map(t => t.cacheHit)).toEqual([true, false]);
 });
 it('allows concurrent cache writers without corrupting the next read', async () => {
  const fetch = vi.fn(async () => { await new Promise(r => setTimeout(r, 5)); return response(); }); vi.stubGlobal('fetch', fetch);
  await Promise.all([run(dir, turns.slice(0, 1)), run(dir, turns.slice(0, 1), { outputMp3Path: path.join(dir, 'other.mp3') })]);
  const reused = await run(dir, turns.slice(0, 1)); expect(reused.metadata.turns[0].cacheHit).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('keeps byte-for-byte assembly order even when later turns finish first', async () => {
  const fetch = vi.fn(async (url, { body }) => { const text = JSON.parse(body).contents[0].parts[0].text; const index = turns.findIndex(t => t.text === text); await new Promise(r => setTimeout(r, index === 0 ? 25 : 1)); return response(pcm.subarray(0, pcm.length - index * 2000)); }); vi.stubGlobal('fetch', fetch);
  const parallel = await run(dir); vi.stubEnv('PODCAST_TTS_CONCURRENCY', '1');
  const sequential = await run(dir, turns, { workDir: path.join(dir, 'sequential') }); expect(parallel.mp3Buffer).toEqual(sequential.mp3Buffer);
 });
});
describe('strict audio decoding', () => {
 it('walks WAV chunks rather than dropping a fixed 44-byte header', () => { expect(parseAudio(wav(), 'audio/wav')).toEqual(pcm); });
 it('rejects incompatible WAV, malformed data and untyped PCM', () => { const b = wav(); b.writeUInt16LE(2, 22); expect(() => parseAudio(b, 'audio/wav')).toThrow(); expect(() => parseAudio(wav().subarray(0, 60), 'audio/wav')).toThrow(); expect(() => parseAudio(Buffer.alloc(3), 'audio/L16;rate=24000')).toThrow(); expect(() => parseAudio(pcm, '')).toThrow(); });
});
