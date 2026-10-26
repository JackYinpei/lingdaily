import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { authTokens = { create } } }))
vi.mock('@/app/lib/server/geminiConfig', () => ({ getServerGeminiApiKey: () => 'synthetic-server-secret' }))
import { POST } from '@/app/api/ios/live-token/route'
import { createLiveTokenCoordinator, issueLiveToken, IOS_LIVE_WS_URL } from '@/app/lib/server/iosLive'
import { liveTokenRequestSchema, voiceForPartner, LIVE_VOICES } from '@/app/lib/ios/live'
import { liveWebSocketEndpoint, isLiveWebSocketEndpoint, LIVE_WS_PATH } from '@/app/lib/ios/liveEndpoint.mjs'

const pairing = 'b'.repeat(64)
const body = () => ({ scenario: { title: 'Deadline', partner: 'Alex', partnerRole: 'Colleague', setting: 'At work',
  goals: ['Explain', 'Propose', 'Confirm'] }, goal: 'Thursday', context: 'Synthetic test' })
const request = (input = body(), credential = pairing, headers = {}) => new Request('http://localhost:8000/api/ios/live-token', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}`, ...headers }, body: JSON.stringify(input),
})
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('IOS_PRACTICE_DEV_ENABLED', '1'); vi.stubEnv('IOS_PRACTICE_DEV_TOKEN', pairing)
  vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-for-ios-session-tests')
  vi.stubEnv('GEMINI_LIVE_WS_BASE_URL', ''); vi.stubEnv('NEXT_PUBLIC_GEMINI_BASE_URL', '')
  create.mockReset().mockResolvedValue({ name: 'auth_tokens/synthetic-single-use' })
  delete globalThis[Symbol.for('lingdaily.iosLiveToken.v2')]
})
afterEach(() => vi.unstubAllEnvs())

describe('iOS Live development token', () => {
  it('selects the approved JP relay on the server without changing locked token configuration', async () => {
    vi.stubEnv('NEXT_PUBLIC_GEMINI_BASE_URL', 'https://lingdailyapi.yasobi.xyz')
    vi.stubEnv('GEMINI_LIVE_WS_BASE_URL', 'https://lingdailyapi-jp.yasobi.xyz/')
    const response = await POST(request())
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(result.wsURL).toBe(`wss://lingdailyapi-jp.yasobi.xyz${LIVE_WS_PATH}`)
    expect(result.wsURL).not.toContain('access_token')
    expect(create.mock.calls[0][0].config.uses).toBe(1)
    expect(create.mock.calls[0][0].config.liveConnectConstraints.config.responseModalities).toEqual(['AUDIO'])
  })
  it('supports the existing relay explicitly while keeping iOS defaults independent of browser configuration', async () => {
    vi.stubEnv('NEXT_PUBLIC_GEMINI_BASE_URL', 'https://lingdailyapi.yasobi.xyz')
    expect((await (await POST(request())).json()).wsURL).toBe(IOS_LIVE_WS_URL)
    vi.stubEnv('GEMINI_LIVE_WS_BASE_URL', 'https://lingdailyapi.yasobi.xyz')
    expect((await (await POST(request())).json()).wsURL).toBe(`wss://lingdailyapi.yasobi.xyz${LIVE_WS_PATH}`)
    expect(liveWebSocketEndpoint('wss://lingdailyapi-jp.yasobi.xyz:443')).toBe(`wss://lingdailyapi-jp.yasobi.xyz${LIVE_WS_PATH}`)
    expect(liveWebSocketEndpoint('')).toBe(IOS_LIVE_WS_URL)
  })
  it('rejects insecure, arbitrary, credential-bearing or malformed relay settings before issuing tokens', async () => {
    for (const base of ['http://lingdailyapi-jp.yasobi.xyz', 'https://evil.test', 'https://lingdailyapi-jp.yasobi.xyz.evil.test',
      'https://user:password@lingdailyapi-jp.yasobi.xyz', 'https://lingdailyapi-jp.yasobi.xyz:8443',
      'https://lingdailyapi-jp.yasobi.xyz/custom', 'https://lingdailyapi-jp.yasobi.xyz/?secret=synthetic',
      'https://lingdailyapi-jp.yasobi.xyz/#fragment', 'malformed']) {
      vi.stubEnv('GEMINI_LIVE_WS_BASE_URL', base)
      delete globalThis[Symbol.for('lingdaily.iosLiveToken.v2')] // Each case gets its own issuance budget.
      const response = await POST(request())
      expect(response.status).toBe(503)
      expect(JSON.stringify(await response.json())).not.toMatch(/password|secret|fragment|evil/)
    }
    expect(create).not.toHaveBeenCalled()
    expect(isLiveWebSocketEndpoint(`wss://lingdailyapi-jp.yasobi.xyz${LIVE_WS_PATH}`)).toBe(true)
    expect(isLiveWebSocketEndpoint(`wss://lingdailyapi-jp.yasobi.xyz${LIVE_WS_PATH}?access_token=synthetic`)).toBe(false)
  })
  it('rejects the pairing token in production and without explicit enablement', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect((await POST(request())).status).toBe(401)
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('IOS_PRACTICE_DEV_ENABLED', '')
    expect((await POST(request())).status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })
  it('requires pairing before parsing JSON', async () => {
    expect((await POST(request({}, 'bad'))).status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })
  it('strictly validates scenario, goals, optional context and arbitrary config before provisioning', async () => {
    for (const input of [ {}, { ...body(), model: 'x'.repeat(101) }, { ...body(), wsURL: 'wss://evil.test' },
      { ...body(), context: 'a'.repeat(501) }, { ...body(), scenario: { ...body().scenario, goals: ['one'] } },
      { ...body(), stepIndex: 3 }, { ...body(), scenario: { ...body().scenario, extra: 'prompt' } } ]) {
      expect((await POST(request(input))).status).toBe(400)
    }
    expect(create).not.toHaveBeenCalled()
    expect(liveTokenRequestSchema.safeParse({ scenario: body().scenario }).success).toBe(true)
  })
  it('lets the learner pick only a listed Live model; anything else falls back to the server default', async () => {
    vi.stubEnv('GEMINI_LIVE_MODEL', 'gemini-3.1-flash-live-preview')
    const issued = async model => {
      delete globalThis[Symbol.for('lingdaily.iosLiveToken.v2')]
      const response = await POST(request({ ...body(), model }))
      const locked = create.mock.calls.at(-1)[0].config.liveConnectConstraints
      return { status: response.status, model: (await response.json()).model, locked: locked.model, prompt: locked.config.systemInstruction }
    }
    expect(await issued('gemini-3.8-live')).toMatchObject({ status: 200, model: 'gemini-3.8-live', locked: 'gemini-3.8-live' })
    const unlisted = await issued('gemini-ultra-expensive')
    expect(unlisted).toMatchObject({ status: 200, model: 'gemini-3.1-flash-live-preview', locked: 'gemini-3.1-flash-live-preview' })
    expect(unlisted.prompt).not.toContain('gemini-ultra-expensive')
  })
  it('lets the learner pick only a listed pause length, kept out of the prompt', async () => {
    const issued = async pauseMs => {
      delete globalThis[Symbol.for('lingdaily.iosLiveToken.v2')]
      expect((await POST(request({ ...body(), pauseMs }))).status).toBe(200)
      return create.mock.calls.at(-1)[0].config.liveConnectConstraints.config
    }
    expect((await issued(4000)).realtimeInputConfig.automaticActivityDetection.silenceDurationMs).toBe(4000)
    const unlisted = await issued(60_000)
    expect(unlisted.realtimeInputConfig.automaticActivityDetection.silenceDurationMs).toBe(1500)
    expect(unlisted.systemInstruction).not.toContain('pauseMs')
    delete globalThis[Symbol.for('lingdaily.iosLiveToken.v2')]
    expect((await POST(request({ ...body(), pauseMs: '4000' }))).status).toBe(400)
  })
  it('keeps HTTP body and media limits', async () => {
    expect((await POST(request(body(), pairing, { 'Content-Type': 'text/plain' }))).status).toBe(415)
    expect((await POST(request({ huge: 'a'.repeat(49 * 1024) }))).status).toBe(413)
    expect(create).not.toHaveBeenCalled()
  })
  it('locks all Live configuration, single use and expiry, exposing only the ephemeral credential', async () => {
    vi.stubEnv('GEMINI_LIVE_MODEL', 'gemini-3.1-flash-live-preview')
    const before = Date.now()
    const response = await POST(request())
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(result).toEqual({ token: 'auth_tokens/synthetic-single-use', model: 'gemini-3.1-flash-live-preview',
      wsURL: IOS_LIVE_WS_URL, expiresAt: expect.any(String) })
    expect(JSON.stringify(result)).not.toContain('synthetic-server-secret')
    const config = create.mock.calls[0][0].config
    expect(config.uses).toBe(1)
    expect(Date.parse(config.expireTime) - before).toBeGreaterThanOrEqual(30 * 60_000)
    expect(Date.parse(config.expireTime) - before).toBeLessThan(30 * 60_000 + 1000)
    expect(Date.parse(config.newSessionExpireTime) - before).toBeGreaterThanOrEqual(2 * 60_000)
    expect(config.httpOptions.apiVersion).toBe('v1alpha')
    expect(config).not.toHaveProperty('lockAdditionalFields')
    const locked = config.liveConnectConstraints
    expect(locked.model).toBe(result.model)
    expect(locked.config.responseModalities).toEqual(['AUDIO'])
    expect(locked.config.systemInstruction).toContain('UNTRUSTED')
    expect(locked.config.systemInstruction).toContain('中文教练规则')
    expect(locked.config.systemInstruction).toContain('native AUDIO-TO-AUDIO')
    expect(locked.config.systemInstruction).toContain('natural rhythm, varied intonation')
    expect(locked.config.systemInstruction).toContain('every 你 there is the learner, never you')
    expect(locked.config.tools[0].functionDeclarations.map(tool => tool.name)).toEqual([
      'record_language_correction', 'record_unfamiliar_learning_items', 'mark_task_complete',
    ])
    expect(locked.config.inputAudioTranscription).toEqual({})
    expect(locked.config.realtimeInputConfig).toEqual({ automaticActivityDetection: {
      disabled: false, startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', prefixPaddingMs: 300,
      endOfSpeechSensitivity: 'END_SENSITIVITY_LOW', silenceDurationMs: 1500,
    } })
    expect(locked.config.systemInstruction).toContain('Never wrap up')
    expect(locked.config.realtimeInputConfig.activityHandling).toBeUndefined() // barge-in stays on
    expect(locked.config.outputAudioTranscription).toEqual({})
  })
  it('gives each partner a stable voice of their own', () => {
    expect(voiceForPartner('Alex', '')).toBe('Puck')
    expect(voiceForPartner('Jamie', '')).toBe('Aoede')
    expect(voiceForPartner('Taylor', '')).toBe('Kore')
    expect(voiceForPartner('Emma', '')).toBe(voiceForPartner('emma', ''))
    for (const name of ['Emma', 'Sarah', 'Ms. Lee']) expect(LIVE_VOICES.female).toContain(voiceForPartner(name, ''))
    for (const name of ['Mike', 'David', 'Mr. Brown']) expect(LIVE_VOICES.male).toContain(voiceForPartner(name, ''))
    expect([...LIVE_VOICES.female, ...LIVE_VOICES.male]).toContain(voiceForPartner('Skyler', ''))
    expect(voiceForPartner('Alex', 'Charon')).toBe('Charon')
    expect(voiceForPartner('Alex', 'NotAVoice')).toBe('Aoede')
  })
  it("locks the partner's voice and retries once with the original voice if it is rejected", async () => {
    const voice = () => create.mock.calls.at(-1)[0].config.liveConnectConstraints.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName
    expect((await POST(request())).status).toBe(200)
    expect(voice()).toBe('Puck')
    create.mockReset()
      .mockRejectedValueOnce(Object.assign(new Error('synthetic invalid voice'), { status: 400 }))
      .mockResolvedValue({ name: 'auth_tokens/synthetic-single-use' })
    expect((await POST(request())).status).toBe(200)
    expect(create).toHaveBeenCalledTimes(2)
    expect(voice()).toBe('Aoede')
    vi.stubEnv('GEMINI_LIVE_VOICE', 'Aoede')
    expect((await POST(request())).status).toBe(200)
    expect(voice()).toBe('Aoede')
  })
  it('follows the chosen level and treats review items as scenario data', async () => {
    const instruction = async input => {
      expect((await POST(request(input))).status).toBe(200)
      return create.mock.calls.at(-1)[0].config.liveConnectConstraints.config.systemInstruction
    }
    expect(await instruction(body())).toContain('short, natural A2–B1 English')
    const easy = await instruction({ ...body(), level: 'easy' })
    expect(easy).toContain('A1–A2')
    expect(easy).not.toContain('A2–B1')
    expect(await instruction({ ...body(), level: 'challenge' })).toContain('ONE realistic complication')
    const review = await instruction({ ...body(), reviewItems: [{ text: 'availability', meaning: '空闲时间' }] })
    expect(review).toContain('REVIEW:')
    expect(review.split('UNTRUSTED_SCENARIO_JSON:')[1]).toContain('availability')
    expect(review.split('UNTRUSTED_SCENARIO_JSON:')[0]).not.toContain('availability')
    expect(liveTokenRequestSchema.safeParse({ ...body(), level: 'expert' }).success).toBe(false)
  })
  it('sanitizes upstream failures and never falls back to unconstrained tokens', async () => {
    create.mockRejectedValue(new Error('synthetic-server-secret provider body wss://private'))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toMatch(/synthetic|provider|wss/)
    expect(create).toHaveBeenCalledTimes(1)
  })
  it('issues a fresh credential each time and applies per-minute route limits', async () => {
    for (let i = 0; i < 6; i++) expect((await POST(request())).status).toBe(200)
    const limited = await POST(request())
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('15')
    expect(create).toHaveBeenCalledTimes(6)
  })
  it('caps active issuance, releases failed slots and resets the time window', async () => {
    const finishes = []; let now = 0
    const generate = vi.fn(() => new Promise(resolve => { finishes.push(resolve) }))
    const coordinated = createLiveTokenCoordinator({ generate, now: () => now })
    const first = coordinated(body()); const second = coordinated(body())
    await expect(coordinated(body())).rejects.toMatchObject({ status: 429 })
    // Resolve both independently via the mock returned promises.
    finishes.forEach(finish => finish({}))
    // Complete first via a separate coordinator to exercise failed-slot cleanup.
    await Promise.all([first, second])
    const fail = createLiveTokenCoordinator({ generate: async () => { throw new Error('offline') }, now: () => now })
    for (let i = 0; i < 6; i++) await expect(fail(body())).rejects.toThrow('offline')
    await expect(fail(body())).rejects.toMatchObject({ status: 429 })
    now = 60_000
    await expect(fail(body())).rejects.toThrow('offline')
  })
  it('uses server configuration and rejects invalid server model settings', async () => {
    vi.stubEnv('GEMINI_LIVE_MODEL', 'models/arbitrary')
    await expect(issueLiveToken(body())).rejects.toMatchObject({ status: 503 })
    expect(create).not.toHaveBeenCalled()
  })
})
