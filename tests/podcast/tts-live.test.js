// Explicit opt-in only. Never runs billable synthesis in the normal suite.
import { it, expect, vi } from 'vitest'
// Supply the same env-only config getters without Next's server-only marker.
// The renderer, HTTP fetch, audio parsing, retries and cache remain real.
vi.mock('@/app/lib/server/geminiConfig', () => ({
  createServerGeminiClient: () => { throw new Error('Writing is outside this live audio test') },
  getServerGeminiApiKey: () => (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim(),
  getServerGeminiBaseUrl: () => (process.env.GEMINI_BASE_URL || process.env.GOOGLE_GEMINI_BASE_URL || process.env.NEXT_PUBLIC_GEMINI_BASE_URL || '').trim(),
}))
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { synthesizePodcast } from '@/app/lib/podcast/tts'

it.skipIf(process.env.LINGDAILY_LIVE_TTS !== '1')('renders the approved bilingual fixture through the production renderer', async () => {
  const source = process.env.LINGDAILY_SAMPLE_SCRIPT
  const output = process.env.LINGDAILY_SAMPLE_DIR
  if (!source || !output) throw new Error('Explicit sample input/output paths required')
  const script = JSON.parse(await readFile(source, 'utf8'))
  await mkdir(output, { recursive: true, mode: 0o700 })
  const options = { workDir: path.join(output, 'turns'), outputMp3Path: path.join(output, 'morning-gemini38.mp3'), signal: AbortSignal.timeout(1_800_000) }
  const result = await synthesizePodcast(script, options)
  const { mp3Buffer, ...metadata } = result
  await writeFile(path.join(output, 'result.json'), JSON.stringify(metadata, null, 2), { mode: 0o600 })
  expect(mp3Buffer.length).toBeGreaterThan(10000)
  // Real second pass must reuse every successful turn, not make another API call.
  const resumed = await synthesizePodcast(script, options)
  expect(resumed.metadata.turns.every(turn => turn.cacheHit && turn.attempts === 0)).toBe(true)
  expect(resumed.mp3Buffer.equals(mp3Buffer)).toBe(true)
  await writeFile(path.join(output, 'resume-verification.json'), JSON.stringify({ cacheHits: resumed.metadata.turns.length, identicalMp3: true }), { mode: 0o600 })
}, 1_900_000)
