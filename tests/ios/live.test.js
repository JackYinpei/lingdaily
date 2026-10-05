import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { authTokens = { create } } }))
vi.mock('@/app/lib/server/geminiConfig', () => ({ getServerGeminiApiKey: () => 'synthetic-server-secret' }))
import { POST } from '@/app/api/ios/live-token/route'
import { createLiveTokenCoordinator, issueLiveToken, IOS_LIVE_WS_URL } from '@/app/lib/server/iosLive'
import { liveTokenRequestSchema } from '@/app/lib/ios/live'
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
    for (const input of [ {}, { ...body(), model: 'expensive' }, { ...body(), wsURL: 'wss://evil.test' },
      { ...body(), context: 'a'.repeat(501) }, { ...body(), scenario: { ...body().scenario, goals: ['one'] } },
      { ...body(), stepIndex: 3 }, { ...body(), scenario: { ...body().scenario, extra: 'prompt' } } ]) {
      expect((await POST(request(input))).status).toBe(400)
    }
    expect(create).not.toHaveBeenCalled()
    expect(liveTokenRequestSchema.safeParse({ scenario: body().scenario }).success).toBe(true)
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
    expect(locked.config.outputAudioTranscription).toEqual({})
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
