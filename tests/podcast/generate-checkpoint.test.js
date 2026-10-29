import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

vi.mock('@/app/lib/server/geminiConfig', () => ({ createServerGeminiClient: vi.fn() }))
vi.mock('@/app/lib/podcast/news', () => ({ fetchPodcastNews: vi.fn() }))
vi.mock('@/app/lib/podcast/script', async (original) => ({ ...await original(), generatePodcastScript: vi.fn() }))
vi.mock('@/app/lib/podcast/tts', () => ({ synthesizePodcast: vi.fn() }))
vi.mock('@/app/lib/podcast/storage', () => ({ uploadPodcastToCos: vi.fn() }))
vi.mock('@/app/lib/podcast/repository', () => ({ claimPodcastGeneration: vi.fn(), updatePodcastEpisode: vi.fn(), renewPodcastGeneration: vi.fn() }))
vi.mock('@/app/lib/podcast/feed', () => ({
  buildEpisodeEnclosureUrl: (name) => `https://example.test/${name}`,
  loadManifest: vi.fn(async () => []), upsertEpisode: vi.fn(async (_, ep) => [ep]),
  saveManifest: vi.fn(async (file, manifest) => writeFile(file, JSON.stringify(manifest))),
  writeFeed: vi.fn(async (file) => writeFile(file, '<rss/>')),
}))

function validScript(title = '今日新闻') {
  const turns = [
    { speaker: 'LL', text: '今天我们关注世界新闻的重要变化。' },
    { speaker: 'DD', text: 'Today we examine the important changes in world news.' },
    { speaker: 'DD', text: '这条消息影响普通人的生活和工作。' },
    { speaker: 'LL', text: 'This story affects how ordinary people live and work.' },
  ]
  return {
    episode_title: title,
    shownotes: {
      summary_zh: '本期关注国际新闻以及商业科技的重要变化。', summary_en: 'Today we cover changes in world affairs and technology.',
      vocabulary: Array.from({ length: 8 }, (_, i) => ({ term: `term${i}`, meaning_zh: '词语含义', definition_en: 'A useful term in this story.', example_en: 'We use this term in the news.' })),
    },
    chunks: [...['intro', 'world', 'tech', 'business'].map((name) => ({ name, turns: structuredClone(turns) })),
      { name: 'outro', turns: [{ speaker: 'LL', text: '感谢今天的陪伴，拜拜！' }, { speaker: 'DD', text: 'Thanks for listening today. Bye!' }] }],
  }
}
let root, POST, mocks
const date = '2026-10-29'
function request(query = '', secret = 'offline-secret') {
  return new Request(`http://localhost/api/podcast/generate?date=${date}${query}`, { method: 'POST', headers: { 'x-podcast-secret': secret } })
}
async function files(dir) {
  const result = []
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, name.name)
    if (name.isDirectory()) result.push(...await files(file)); else result.push(file)
  }
  return result
}
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  root = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), 'podcast-checkpoint-test-'))
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  vi.stubEnv('PODCAST_SECRET', 'offline-secret')
  vi.stubEnv('PODCAST_CACHE_DIR', '')
  mocks = {
    ...await import('@/app/lib/podcast/news'), ...await import('@/app/lib/podcast/script'),
    ...await import('@/app/lib/podcast/tts'), ...await import('@/app/lib/podcast/storage'),
    ...await import('@/app/lib/podcast/repository'),
  }
  mocks.fetchPodcastNews.mockResolvedValue([])
  mocks.generatePodcastScript.mockImplementation(async () => validScript())
  mocks.claimPodcastGeneration.mockResolvedValue(null)
  mocks.uploadPodcastToCos.mockResolvedValue('https://example.test/audio.mp3')
  mocks.updatePodcastEpisode.mockImplementation(async (_id, _lease, fields) => ({ id: date, date, ...fields }))
  mocks.synthesizePodcast.mockImplementation(async (_script, { workDir, outputMp3Path }) => {
    await mkdir(workDir, { recursive: true })
    await writeFile(path.join(workDir, 'saved-turn.pcm'), 'retained-audio')
    await writeFile(outputMp3Path, 'complete-mp3')
    return { size: 12, duration: 20, model: 'actual-tts-model', metadata: { mode: 'turn', cacheHits: 2 } }
  })
  ;({ POST } = await import('@/app/api/podcast/generate/route'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('private persistent generation checkpoints', () => {
  it('aborts a bounded TTS job and preserves its script for the next attempt', async () => {
    vi.stubEnv('PODCAST_TTS_DEADLINE_MS', '10')
    mocks.synthesizePodcast.mockImplementationOnce(async (_script, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('bounded TTS abort')), { once: true })
    }))
    expect((await POST(request())).status).toBe(500)
    expect(await stat(path.join(root, '.podcast-cache', date, 'script.json'))).toBeDefined()
    expect(mocks.uploadPodcastToCos).not.toHaveBeenCalled()
    expect((await POST(request())).status).toBe(200)
    expect(mocks.generatePodcastScript).toHaveBeenCalledTimes(1)
  })
  it('resumes the same script and audio directory after TTS failure, without fetching news again', async () => {
    const successfulTts = mocks.synthesizePodcast.getMockImplementation()
    let firstDir
    mocks.synthesizePodcast.mockImplementationOnce(async (script, options) => {
      firstDir = options.workDir
      await successfulTts(script, options)
      throw new Error('transient TTS failure')
    })
    expect((await POST(request())).status).toBe(500)
    expect(await readFile(path.join(firstDir, 'saved-turn.pcm'), 'utf8')).toBe('retained-audio')
    expect(await readdir(path.join(root, 'public/podcasts'))).toEqual([])
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.fetchPodcastNews).toHaveBeenCalledTimes(1)
    expect(mocks.generatePodcastScript).toHaveBeenCalledTimes(1)
    expect(mocks.synthesizePodcast.mock.calls[1][1].workDir).toBe(firstDir)
    expect(firstDir.startsWith(path.join(root, '.podcast-cache', date))).toBe(true)
    expect(await readFile(path.join(firstDir, 'saved-turn.pcm'), 'utf8')).toBe('retained-audio')
  })

  it('force writes a new script and uses a distinct fingerprint directory', async () => {
    await POST(request())
    const firstDir = mocks.synthesizePodcast.mock.calls[0][1].workDir
    mocks.generatePodcastScript.mockResolvedValueOnce(validScript('另一份新闻稿'))
    expect((await POST(request('&force=true'))).status).toBe(200)
    expect(mocks.generatePodcastScript).toHaveBeenCalledTimes(2)
    expect(mocks.synthesizePodcast.mock.calls[1][1].workDir).not.toBe(firstDir)
    expect(await stat(firstDir)).toBeDefined()
  })

  it('persists actual model and metadata privately, not generated prose in cron responses', async () => {
    mocks.generatePodcastScript.mockResolvedValueOnce(validScript('error 测试标题'))
    const response = await POST(request())
    const body = await response.json()
    expect(body.model).toBe('actual-tts-model')
    expect(JSON.stringify(body)).not.toContain('error')
    const privateFiles = await files(path.join(root, '.podcast-cache'))
    const sidecar = privateFiles.find((file) => file.endsWith('tts.json'))
    const data = JSON.parse(await readFile(sidecar, 'utf8'))
    expect(data.model).toBe('actual-tts-model')
    expect(data.metadata).toEqual({ mode: 'turn', cacheHits: 2 })
    expect(data.date).toBe(date)
    expect(data.scriptFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect((await stat(path.join(root, '.podcast-cache'))).mode & 0o777).toBe(0o700)
    for (const file of privateFiles.filter((file) => file.endsWith('.json'))) {
      expect((await stat(file)).mode & 0o777).toBe(0o600)
      expect(await readFile(file, 'utf8')).not.toContain('offline-secret')
    }
  })

  it.each(['json', 'checksum', 'schema', 'date', 'invalid-script'])('rejects a corrupted %s checkpoint and regenerates safely', async (kind) => {
    mocks.uploadPodcastToCos.mockRejectedValueOnce(new Error('upload unavailable'))
    expect((await POST(request())).status).toBe(500)
    const checkpoint = path.join(root, '.podcast-cache', date, 'script.json')
    const data = JSON.parse(await readFile(checkpoint, 'utf8'))
    if (kind === 'checksum') data.script.episode_title = '篡改的标题'
    if (kind === 'schema') data.schemaVersion = 999
    if (kind === 'date') data.date = '2000-01-01'
    if (kind === 'invalid-script') {
      data.script.chunks[0].turns[0].speaker = 'DD'
      data.scriptFingerprint = createHash('sha256').update(JSON.stringify(data.script)).digest('hex')
    }
    await writeFile(checkpoint, kind === 'json' ? '{broken' : JSON.stringify(data))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await POST(request())).status).toBe(200)
    expect(mocks.fetchPodcastNews).toHaveBeenCalledTimes(2)
    expect(mocks.generatePodcastScript).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('checkpoint'), expect.stringMatching(/^[A-Z_]+$/))
  })

  it('uses a configured private cache root', async () => {
    vi.stubEnv('PODCAST_CACHE_DIR', path.join(root, 'private-cache'))
    expect((await POST(request())).status).toBe(200)
    expect(mocks.synthesizePodcast.mock.calls[0][1].workDir.startsWith(path.join(root, 'private-cache', date))).toBe(true)
  })

  it('refuses a configured public cache root before TTS or publishing', async () => {
    vi.stubEnv('PODCAST_CACHE_DIR', path.join(root, 'public', 'hidden-cache'))
    expect((await POST(request())).status).toBe(500)
    expect(mocks.synthesizePodcast).not.toHaveBeenCalled()
    expect(mocks.uploadPodcastToCos).not.toHaveBeenCalled()
  })

  it('does not publish invalid structured scripts', async () => {
    mocks.generatePodcastScript.mockResolvedValueOnce({ episode_title: 'incomplete' })
    expect((await POST(request())).status).toBe(500)
    expect(mocks.synthesizePodcast).not.toHaveBeenCalled()
    expect(mocks.uploadPodcastToCos).not.toHaveBeenCalled()
  })
})

describe('checkpoint integrity and privacy', () => {
  it('atomically saves a complete script before TTS and retains earlier force archives', async () => {
    const successfulTts = mocks.synthesizePodcast.getMockImplementation()
    mocks.synthesizePodcast.mockImplementation(async (script, options) => {
      const pointer = JSON.parse(await readFile(path.join(root, '.podcast-cache', date, 'script.json'), 'utf8'))
      expect(pointer.script).toEqual(script)
      expect(pointer.scriptFingerprint).toBe(path.basename(options.workDir))
      expect(pointer.scriptFingerprint).toBe(createHash('sha256').update(JSON.stringify(script)).digest('hex'))
      expect((await stat(options.workDir)).mode & 0o777).toBe(0o700)
      expect((await stat(path.dirname(options.workDir))).mode & 0o777).toBe(0o700)
      return successfulTts(script, options)
    })
    expect((await POST(request())).status).toBe(200)
    const firstDir = mocks.synthesizePodcast.mock.calls[0][1].workDir
    mocks.generatePodcastScript.mockResolvedValueOnce(validScript('新稿保留旧稿'))
    expect((await POST(request('&force=true'))).status).toBe(200)
    expect(JSON.parse(await readFile(path.join(firstDir, 'script.json'), 'utf8')).script.episode_title).toBe('今日新闻')
    expect((await files(path.join(root, '.podcast-cache'))).some((file) => file.endsWith('.tmp'))).toBe(false)
  })

  it('strips request/credential fields from sidecars and skips unsafe response model names', async () => {
    const successfulTts = mocks.synthesizePodcast.getMockImplementation()
    mocks.synthesizePodcast.mockImplementationOnce(async (script, options) => ({
      ...await successfulTts(script, options), model: 'provider-error-model',
      metadata: { mode: 'turn', headers: { authorization: 'sensitive-value' }, nested: { apiKey: 'sensitive-value', cacheHits: 4 }, body: 'sensitive-value' },
    }))
    const script = validScript()
    script.headers = { authorization: 'sensitive-value' }
    mocks.generatePodcastScript.mockResolvedValueOnce(script)
    const body = await (await POST(request())).json()
    expect(body.model).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('error')
    const privateFiles = await files(path.join(root, '.podcast-cache'))
    for (const file of privateFiles.filter((file) => file.endsWith('.json'))) expect(await readFile(file, 'utf8')).not.toContain('sensitive-value')
    const sidecar = JSON.parse(await readFile(privateFiles.find((file) => file.endsWith('tts.json')), 'utf8'))
    expect(sidecar.model).toBe('provider-error-model')
    expect(sidecar.metadata).toEqual({ mode: 'turn', nested: { cacheHits: 4 } })
  })

  it('retains requested and actual model metadata through the real sidecar helper without credentials', async () => {
    const successfulTts = mocks.synthesizePodcast.getMockImplementation()
    mocks.synthesizePodcast.mockImplementationOnce(async (script, options) => ({
      ...await successfulTts(script, options),
      metadata: {
        requestedModel: 'gemini-2.5-pro-preview-tts', modelVersion: 'gemini-2.5-pro-tts-001',
        request: { headers: { authorization: 'credential-sentinel' } },
        requestId: 'credential-sentinel', apiKey: 'credential-sentinel', token: 'credential-sentinel',
        nested: [{ requestedModel: 'gemini-2.5-flash-preview-tts', modelVersion: 'v1', credentials: 'credential-sentinel' }],
      },
    }))
    expect((await POST(request())).status).toBe(200)
    const workDir = mocks.synthesizePodcast.mock.calls[0][1].workDir
    const raw = await readFile(path.join(workDir, 'tts.json'), 'utf8')
    expect(JSON.parse(raw).metadata).toEqual({
      requestedModel: 'gemini-2.5-pro-preview-tts', modelVersion: 'gemini-2.5-pro-tts-001',
      nested: [{ requestedModel: 'gemini-2.5-flash-preview-tts', modelVersion: 'v1' }],
    })
    expect(raw).not.toContain('credential-sentinel')
    expect(raw).not.toContain('offline-secret')
  })

  it.each([null, 123, {}, ['model'], '', 'model with spaces', 'model\nAuthorization: credential-sentinel', 'https://provider.test/?apiKey=credential-sentinel', 'a'.repeat(129)])(
    'rejects unsafe requestedModel metadata %# without dropping modelVersion', async (requestedModel) => {
      const { openPodcastCheckpoint, savePodcastTtsCheckpoint } = await import('@/app/lib/podcast/checkpoint')
      const checkpoint = await openPodcastCheckpoint(date)
      const fingerprint = 'a'.repeat(64)
      await savePodcastTtsCheckpoint(checkpoint, fingerprint, {
        model: 'actual-model', size: 12, duration: 20,
        metadata: { requestedModel, modelVersion: 'v1', nested: { requestedModel, apiKey: 'credential-sentinel' } },
      })
      const raw = await readFile(path.join(checkpoint.dateDir, fingerprint, 'tts.json'), 'utf8')
      expect(JSON.parse(raw).metadata).toEqual({ modelVersion: 'v1', nested: {} })
      expect(raw).not.toContain('credential-sentinel')
    },
  )

  it('rejects a cache alias into public and a symlinked date directory', async () => {
    await mkdir(path.join(root, 'public/cache'), { recursive: true })
    await symlink(path.join(root, 'public/cache'), path.join(root, 'alias-cache'))
    vi.stubEnv('PODCAST_CACHE_DIR', path.join(root, 'alias-cache'))
    expect((await POST(request())).status).toBe(500)
    vi.stubEnv('PODCAST_CACHE_DIR', '')
    await mkdir(path.join(root, '.podcast-cache'))
    await symlink(path.join(root, 'public/cache'), path.join(root, '.podcast-cache', date))
    expect((await POST(request())).status).toBe(500)
    expect(mocks.synthesizePodcast).not.toHaveBeenCalled()
    expect(await readdir(path.join(root, 'public/cache'))).toEqual([])
  })
})

describe('bounded generation lease heartbeat', () => {
  beforeEach(() => {
    vi.stubEnv('PODCAST_LEASE_HEARTBEAT_MS', '10')
    mocks.claimPodcastGeneration.mockResolvedValue({ claimed: true, generationId: 'lease-id' })
    mocks.renewPodcastGeneration.mockResolvedValue({ status: 'script_generated' })
  })

  it.each(['fenced out', 'HTTP failure'])('aborts TTS on %s without upload, retaining private checkpoints', async (reason) => {
    const failure = Object.assign(new Error(reason), { code: reason === 'fenced out' ? 'PODCAST_LEASE_LOST' : undefined })
    mocks.renewPodcastGeneration.mockRejectedValueOnce(failure)
    let signal
    mocks.synthesizePodcast.mockImplementationOnce(async (_script, options) => {
      signal = options.signal
      await writeFile(path.join(options.workDir, 'partial.pcm'), 'private partial')
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
      // A provider may resolve despite abort: route must still refuse publication.
      return { size: 1, duration: 1, mp3Buffer: Buffer.from('x') }
    })
    expect((await POST(request())).status).toBe(500)
    expect(signal.aborted).toBe(true)
    expect(mocks.renewPodcastGeneration).toHaveBeenCalledWith(date, 'lease-id')
    expect(mocks.uploadPodcastToCos).not.toHaveBeenCalled()
    expect(mocks.updatePodcastEpisode.mock.calls.some(([, , fields]) => fields.status === 'completed')).toBe(false)
    expect(await stat(path.join(root, '.podcast-cache', date, 'script.json'))).toBeDefined()
    expect((await files(path.join(root, '.podcast-cache'))).some((file) => file.endsWith('partial.pcm'))).toBe(true)
    expect(await readdir(path.join(root, 'public/podcasts'))).toEqual([])
    const count = mocks.renewPodcastGeneration.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(mocks.renewPodcastGeneration).toHaveBeenCalledTimes(count)
  })

  it('renews without overlap, drains pending renewal before upload and clears timers after completion', async () => {
    let finishTts, finishRenewal
    const successfulTts = mocks.synthesizePodcast.getMockImplementation()
    mocks.synthesizePodcast.mockImplementationOnce(async (script, options) => {
      await new Promise((resolve) => { finishTts = resolve })
      return successfulTts(script, options)
    })
    mocks.renewPodcastGeneration.mockImplementationOnce(() => new Promise((resolve) => { finishRenewal = resolve }))
    const pending = POST(request())
    await vi.waitFor(() => expect(finishRenewal).toBeTypeOf('function'))
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(mocks.renewPodcastGeneration).toHaveBeenCalledTimes(1)
    finishTts()
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(mocks.uploadPodcastToCos).not.toHaveBeenCalled()
    finishRenewal({ status: 'script_generated' })
    expect((await pending).status).toBe(200)
    expect(mocks.updatePodcastEpisode.mock.calls.at(-1)[2].status).toBe('completed')
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(mocks.renewPodcastGeneration).toHaveBeenCalledTimes(1)
  })

  it('blocks publication when the final in-flight renewal fails after TTS resolves', async () => {
    let finishTts, rejectRenewal
    const successfulTts = mocks.synthesizePodcast.getMockImplementation()
    mocks.synthesizePodcast.mockImplementationOnce(async (script, options) => {
      await new Promise((resolve) => { finishTts = resolve })
      return successfulTts(script, options)
    })
    mocks.renewPodcastGeneration.mockImplementationOnce(() => new Promise((_, reject) => { rejectRenewal = reject }))
    const pending = POST(request())
    await vi.waitFor(() => expect(rejectRenewal).toBeTypeOf('function'))
    finishTts()
    await new Promise((resolve) => setTimeout(resolve, 35))
    rejectRenewal(new Error('late renewal failure'))
    expect((await pending).status).toBe(500)
    expect(mocks.synthesizePodcast.mock.calls[0][1].signal.aborted).toBe(true)
    expect(mocks.uploadPodcastToCos).not.toHaveBeenCalled()
    expect(mocks.updatePodcastEpisode.mock.calls.at(-1)[2].status).toBe('failed')
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(mocks.renewPodcastGeneration).toHaveBeenCalledTimes(1)
  })

  it('repeats successful renewals with the same token and preserves database force semantics', async () => {
    let finishTts
    const successfulTts = mocks.synthesizePodcast.getMockImplementation()
    mocks.synthesizePodcast.mockImplementationOnce(async (script, options) => {
      await new Promise((resolve) => { finishTts = resolve })
      return successfulTts(script, options)
    })
    const pending = POST(request('&force=true'))
    await vi.waitFor(() => expect(mocks.renewPodcastGeneration.mock.calls.length).toBeGreaterThanOrEqual(2))
    finishTts()
    expect((await pending).status).toBe(200)
    expect(mocks.claimPodcastGeneration).toHaveBeenCalledWith(date, true)
    for (const call of mocks.renewPodcastGeneration.mock.calls) expect(call).toEqual([date, 'lease-id'])
    const count = mocks.renewPodcastGeneration.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(mocks.renewPodcastGeneration).toHaveBeenCalledTimes(count)
  })

  it('clears heartbeat timers when TTS rejects independently', async () => {
    mocks.synthesizePodcast.mockRejectedValueOnce(new Error('TTS unavailable'))
    expect((await POST(request())).status).toBe(500)
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(mocks.renewPodcastGeneration).not.toHaveBeenCalled()
    expect(mocks.uploadPodcastToCos).not.toHaveBeenCalled()
  })

  it('does not heartbeat in database-unavailable compatibility mode and keeps single-instance exclusion', async () => {
    mocks.claimPodcastGeneration.mockRejectedValueOnce(new Error('DB unavailable'))
    let finishTts
    const successfulTts = mocks.synthesizePodcast.getMockImplementation()
    mocks.synthesizePodcast.mockImplementationOnce(async (script, options) => {
      await new Promise((resolve) => { finishTts = resolve })
      return successfulTts(script, options)
    })
    const pending = POST(request())
    await vi.waitFor(() => expect(finishTts).toBeTypeOf('function'))
    expect((await POST(request('&force=true'))).status).toBe(429)
    await new Promise((resolve) => setTimeout(resolve, 35))
    finishTts()
    expect((await pending).status).toBe(200)
    expect(mocks.renewPodcastGeneration).not.toHaveBeenCalled()
  })
})

describe('existing generation boundaries', () => {
  it('keeps local completed-date idempotency', async () => {
    await POST(request())
    const body = await (await POST(request())).json()
    expect(body.skipped).toBe(true)
    expect(mocks.synthesizePodcast).toHaveBeenCalledTimes(1)
  })
  it('keeps database completed and busy claim boundaries', async () => {
    mocks.claimPodcastGeneration.mockResolvedValueOnce({ claimed: false, episode: { id: date, status: 'completed', title: 'error' } })
    expect(await (await POST(request())).json()).toMatchObject({ ok: true, skipped: true })
    mocks.claimPodcastGeneration.mockResolvedValueOnce({ claimed: false, episode: { status: 'script_generated' } })
    expect((await POST(request())).status).toBe(409)
    expect(mocks.generatePodcastScript).not.toHaveBeenCalled()
  })
  it('retains fencing on failed database publication without exposing a local MP3', async () => {
    mocks.claimPodcastGeneration.mockResolvedValueOnce({ claimed: true, generationId: 'lease-id' })
    mocks.updatePodcastEpisode.mockImplementation(async (_id, _lease, fields) => {
      if (fields.status === 'completed') throw new Error('stale lease')
      return fields
    })
    expect((await POST(request())).status).toBe(500)
    for (const call of mocks.updatePodcastEpisode.mock.calls) expect(call.slice(0, 2)).toEqual([date, 'lease-id'])
    expect(await readdir(path.join(root, 'public/podcasts'))).toEqual([])
  })
  it('rejects concurrent requests and unauthorized/path-traversal requests', async () => {
    expect((await POST(request('', 'wrong'))).status).toBe(401)
    expect((await POST(new Request('http://localhost/?date=../../escape', { headers: { 'x-podcast-secret': 'offline-secret' } }))).status).toBe(400)
    let release
    mocks.fetchPodcastNews.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const pending = POST(request())
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1))
    expect((await POST(request())).status).toBe(429)
    release([])
    expect((await pending).status).toBe(200)
  })
})
