import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { generate, db } = vi.hoisted(() => ({ generate: vi.fn(), db: { rows: [], calls: [] } }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: generate } } }))
vi.mock('@/app/lib/server/geminiConfig', () => ({ getServerGeminiApiKey: () => 'fake', getServerGeminiBaseUrl: () => '' }))
vi.mock('@/app/lib/history/server', async original => ({
  ...await original(),
  getHistoryDatabaseConfig: () => ({ baseUrl: 'https://db.test', serviceRoleKey: 'x', schema: 'public' }),
  historyDatabaseRequest: async (_config, resource, { body, params, prefer } = {}) => {
    db.calls.push({ resource, body, params: params?.toString(), prefer })
    if (resource === 'ai_usage') {
      if (body.report_id && db.rows.some(row => row.user_id === body.user_id && row.report_id === body.report_id)) return { ok: true, status: 201, data: null }
      db.rows.push({ ...body, created_at: new Date().toISOString() })
      return { ok: true, status: 201, data: null }
    }
    if (resource === 'rpc/ai_usage_summary') {
      const rows = db.rows.filter(row => !body.p_user_id || row.user_id === body.p_user_id).map(row => ({
        day: row.created_at.slice(0, 10), feature: row.feature, model: row.model, user_id: row.user_id, calls: 1,
        input_tokens: row.input_tokens, output_tokens: row.output_tokens, thinking_tokens: row.thinking_tokens || 0,
        input_audio_tokens: row.input_audio_tokens || 0, output_audio_tokens: row.output_audio_tokens || 0, total_tokens: row.total_tokens,
      }))
      return { ok: true, status: 200, data: { rows } }
    }
    throw new Error(`unexpected ${resource}`)
  },
}))

import { POST as SUGGEST } from '@/app/api/ios/suggest/route'
import { GET as OWN_USAGE, POST as REPORT_LIVE } from '@/app/api/ios/usage/route'
import { estimateCost, tokensFromUsageMetadata, usageSummary } from '@/app/lib/server/aiUsage'
import { issueIOSSession } from '@/app/lib/server/iosAuth'

const userA = '11111111-2222-4333-8444-555555555555'
const userB = '99999999-2222-4333-8444-555555555555'
const call = async (handler, userId, body, method = 'POST', query = '') => {
  const { sessionToken } = await issueIOSSession(userId)
  const response = await handler(new Request(`https://lingdaily.test/api/ios/x${query}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  return { status: response.status, data: await response.json() }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const liveReport = (overrides = {}) => ({ reportId: randomUUID(), model: 'gemini-3.1-flash-live-preview', inputTokens: 397,
  outputTokens: 113, inputAudioTokens: 42, outputAudioTokens: 113, totalTokens: 510, ...overrides })

beforeEach(() => {
  db.rows = []; db.calls = []
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-for-ios-session-tests')
  for (const key of Object.getOwnPropertySymbols(globalThis)) if (String(key).includes('lingdaily.')) delete globalThis[key]
})
afterEach(() => vi.unstubAllEnvs())

describe('token accounting', () => {
  it('records every billed attempt of a text call, including the corrective retry', async () => {
    const good = { hint: '先说做完了。', keywords: 'done', reply: 'It is done.', meaning: '做完了。' }
    generate
      .mockResolvedValueOnce({ text: '{broken', candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20, totalTokenCount: 320 } })
      .mockResolvedValueOnce({ text: JSON.stringify(good), candidates: [{ finishReason: 'STOP' }], modelVersion: 'm', usageMetadata: { promptTokenCount: 310, candidatesTokenCount: 70, thoughtsTokenCount: 40, totalTokenCount: 420 } })
    const response = await call(SUGGEST, userA, { requestId: randomUUID(), goal: '', context: '', stepIndex: 0,
      scenario: { title: 'T', partner: 'Alex', partnerRole: 'c', setting: 's', goals: ['a', 'b', 'c'] }, messages: [{ role: 'partner', text: 'Hi?' }] })
    expect(response.status).toBe(200)
    await flush()
    expect(db.rows).toEqual([expect.objectContaining({ user_id: userA, feature: 'suggest', model: 'gemini-3.1-flash-lite',
      input_tokens: 610, output_tokens: 90, thinking_tokens: 40, total_tokens: 740 })])
  })

  it('stores a Live report once per reportId and validates it', async () => {
    const report = liveReport()
    expect((await call(REPORT_LIVE, userA, report)).status).toBe(200)
    expect((await call(REPORT_LIVE, userA, report)).status).toBe(200)
    expect(db.rows).toHaveLength(1)
    expect(db.calls.at(-1)).toMatchObject({ params: 'on_conflict=user_id%2Creport_id', prefer: 'resolution=ignore-duplicates,return=minimal' })
    expect((await call(REPORT_LIVE, userA, liveReport({ inputAudioTokens: 9999 }))).status).toBe(400)
    expect((await call(REPORT_LIVE, userA, { ...liveReport(), extra: 1 })).status).toBe(400)
  })

  it('shows a learner only their own tokens, without prices', async () => {
    vi.stubEnv('AI_PRICING_JSON', JSON.stringify({ 'gemini-3.1-flash-live-preview': { input: 1, output: 2 } }))
    await call(REPORT_LIVE, userA, liveReport())
    await call(REPORT_LIVE, userB, liveReport({ totalTokens: 9000, inputTokens: 5000, outputTokens: 4000 }))
    const { status, data } = await call(OWN_USAGE, userA, undefined, 'GET', '?days=7')
    expect(status).toBe(200)
    expect(data.total).toMatchObject({ calls: 1, total_tokens: 510 })
    expect(data.total.cost).toBeUndefined()
    expect(data.byFeature.map(row => row.key)).toEqual(['live'])
  })

  it('estimates cost only for priced models, billing thinking as output and audio at its own rate', async () => {
    const row = { input_tokens: 1000, input_audio_tokens: 200, output_tokens: 500, output_audio_tokens: 100, thinking_tokens: 50 }
    const prices = { live: { input: 1, output: 2, audioInput: 10, audioOutput: 20 } }
    // (800*1 + 200*10 + (400+50)*2 + 100*20) / 1e6
    expect(estimateCost('live', row, prices)).toBeCloseTo(0.0057, 6)
    expect(estimateCost('unpriced-model', row, prices)).toBeNull()
    expect(tokensFromUsageMetadata({ promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }, undefined))
      .toEqual({ input: 1, output: 2, thinking: 0, total: 3 })
    db.rows = [{ user_id: userA, feature: 'live', model: 'unpriced-model', input_tokens: 10, output_tokens: 5, total_tokens: 15, created_at: new Date().toISOString() }]
    const summary = await usageSummary({ since: new Date(0), prices })
    expect(summary.total).toMatchObject({ total_tokens: 15, unpriced: true, cost: 0 })
    expect(summary.users).toBe(1)
  })
})
