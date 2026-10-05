import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { db, verifyApple, findUser, deleteUser, revoke } = vi.hoisted(() => ({
  db: { tables: {} }, verifyApple: vi.fn(), findUser: vi.fn(), deleteUser: vi.fn(), revoke: vi.fn(),
}))

// Minimal PostgREST stand-in: eq./not.is.null filters, upsert on id, the chat RPC.
function matches(row, params) {
  for (const [key, raw] of params?.entries() || []) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(key)) continue
    if (raw === 'not.is.null') { if (row[key] == null) return false; continue }
    if (raw.startsWith('eq.') && String(row[key]) !== raw.slice(3)) return false
  }
  return true
}
vi.mock('@/app/lib/history/server', () => ({
  getHistoryDatabaseConfig: () => ({ baseUrl: 'https://db.test', serviceRoleKey: 'x', schema: 'public' }),
  historyDatabaseRequest: async (_config, resource, { method = 'GET', params, body } = {}) => {
    if (resource === 'rpc/save_chat_history') {
      const rows = db.tables.chat_history ||= []
      const current = rows.find(row => row.user_id === body.p_user_id && row.news_key === body.p_news_key)
      const fields = { news_title: body.p_news_title, news: body.p_news, history: body.p_history, source_type: body.p_source_type }
      if (current) Object.assign(current, fields, { revision: current.revision + 1 })
      else rows.push({ id: randomUUID(), user_id: body.p_user_id, news_key: body.p_news_key, revision: 1, ...fields })
      return { ok: true, status: 200, data: null }
    }
    const rows = db.tables[resource] ||= []
    if (method === 'GET') {
      const found = rows.filter(row => matches(row, params))
      return { ok: true, status: 200, data: params?.get('order')?.startsWith('timestamp.asc') ? found.sort((a, b) => a.timestamp.localeCompare(b.timestamp)) : found }
    }
    if (method === 'POST') {
      const existing = rows.find(row => row.id === body.id)
      if (existing && params?.get('on_conflict') === 'id') Object.assign(existing, body)
      else if (existing) return { ok: false, status: 409, data: { code: '23505' } }
      else rows.push({ ...body })
      return { ok: true, status: 201, data: null }
    }
    if (method === 'PATCH') { rows.filter(row => matches(row, params)).forEach(row => Object.assign(row, body)); return { ok: true, status: 204, data: null } }
    if (method === 'DELETE') { db.tables[resource] = rows.filter(row => !matches(row, params)); return { ok: true, status: 204, data: null } }
    throw new Error(`unexpected ${method} ${resource}`)
  },
}))
vi.mock('@/app/lib/server/iosAuth', async original => ({ ...await original(), verifyAppleIdentityToken: verifyApple }))
vi.mock('@/app/lib/server/supabaseAuthUser', () => ({ findAuthUserIdByEmail: findUser, deleteAuthUser: deleteUser }))
vi.mock('@/app/lib/server/appleRevoke', () => ({ revokeAppleAuthorization: revoke }))

import { GET, POST } from '@/app/api/ios/sync/route'
import { POST as DELETE_ACCOUNT } from '@/app/api/ios/account/delete/route'
import { issueIOSSession } from '@/app/lib/server/iosAuth'
import { expressionRowId } from '@/app/lib/server/iosSync'

const userA = '11111111-2222-4333-8444-555555555555'
const userB = '99999999-2222-4333-8444-555555555555'
const tokenFor = async userId => (await issueIOSSession(userId)).sessionToken
const call = async (handler, userId, body, method = 'POST') => {
  const bearer = typeof userId === 'string' && userId.length > 40 ? userId : await tokenFor(userId)
  const response = await handler(new Request('https://lingdaily.test/api/ios/sync', {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  return { status: response.status, data: await response.json() }
}
const session = (overrides = {}) => ({
  id: 'A3B1C2D4-1111-4222-8333-444455556666', updatedAt: '2026-10-05T10:00:00.000Z', personalGoal: '',
  scenario: { id: 'deadline', title: '把延期说清楚', steps: [] }, stepIndex: 1, phase: 'review',
  messages: [
    { id: randomUUID(), role: 'partner', kind: 'prompt', text: 'How is it going?', stepIndex: 0, createdAt: '2026-10-05T09:59:00.000Z' },
    { id: randomUUID(), role: 'user', kind: 'answer', text: 'I need two more days.', stepIndex: 0, createdAt: '2026-10-05T10:00:00.000Z' },
  ],
  ...overrides,
})
const scenario = (overrides = {}) => ({
  id: 'custom-0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D', title: '退押金', subtitle: '和房东确认', category: '日常', symbol: 'text.bubble',
  partner: 'Morgan', partnerRole: '房东', setting: '你下周搬走，想确认押金何时退还。',
  steps: [0, 1, 2].map(index => ({ id: `step-${index}`, goal: `目标${index}`, prompt: `Prompt ${index}?`, translation: '译文',
    hint: '提示', keywords: 'deposit', expression: 'When will I get my deposit back?', meaning: '押金什么时候退？' })),
  ...overrides,
})

beforeEach(() => {
  db.tables = {}
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-for-ios-session-tests')
  delete globalThis[Symbol.for('lingdaily.iosSyncLimiter.v1')]
  verifyApple.mockReset(); findUser.mockReset(); deleteUser.mockReset().mockResolvedValue(true); revoke.mockReset().mockResolvedValue('skipped')
})
afterEach(() => vi.unstubAllEnvs())

describe('iOS cloud sync into the shared tables', () => {
  it('stores rehearsals as practice chat history the web can read, and returns them losslessly', async () => {
    const { status, data } = await call(POST, userA, { sessions: { upsert: [session()] } })
    expect(status).toBe(200)
    const [row] = db.tables.chat_history
    expect(row).toMatchObject({ user_id: userA, news_key: 'practice:a3b1c2d4-1111-4222-8333-444455556666', source_type: 'practice', news_title: '把延期说清楚' })
    expect(row.history.map(item => [item.role, item.content])).toEqual([['assistant', 'How is it going?'], ['user', 'I need two more days.']])
    expect(data.sessions).toHaveLength(1)
    expect(data.sessions[0].session).toMatchObject({ stepIndex: 1, phase: 'review' })
  })

  it('never lets an older copy overwrite a newer one from another device', async () => {
    await call(POST, userA, { sessions: { upsert: [session({ updatedAt: '2026-10-05T12:00:00.000Z', stepIndex: 2 })] } })
    const { data } = await call(POST, userA, { sessions: { upsert: [session({ updatedAt: '2026-10-05T11:00:00.000Z', stepIndex: 1 })] } })
    expect(data.sessions[0].session.stepIndex).toBe(2)
    expect(db.tables.chat_history[0].revision).toBe(1)
  })

  it('merges vocabulary with web learning events and deletes across both', async () => {
    db.tables.unfamiliar_english = [{
      id: randomUUID(), user_id: userA, items: [{ text: 'Deadline', type: 'word', meaning: '截止日期' }, { text: 'on track', type: 'phrase', meaning: '按计划' }],
      context: 'Web news', timestamp: '2026-10-01T00:00:00.000Z', learning_language_code: 'en', native_language_code: 'zh-CN',
    }]
    const saved = { text: 'a little more time', meaning: '多一点时间', source: '把延期说清楚', createdAt: '2026-10-05T10:00:00.000Z', kind: 'phrase' }
    await call(POST, userA, { expressions: { upsert: [saved] } })
    const { data } = await call(POST, userA, { expressions: { upsert: [saved] } })
    expect(db.tables.unfamiliar_english).toHaveLength(2)
    expect(db.tables.unfamiliar_english[1].id).toBe(expressionRowId(userA, 'a little more time'))
    expect(data.expressions.map(item => item.key).sort()).toEqual(['a little more time', 'deadline', 'on track'])

    const after = await call(POST, userA, { expressions: { delete: ['DEADLINE', 'a little more time'] } })
    expect(after.data.expressions.map(item => item.key)).toEqual(['on track'])
    expect(db.tables.unfamiliar_english).toHaveLength(1)
    expect(db.tables.unfamiliar_english[0].items).toEqual([{ text: 'on track', type: 'phrase', meaning: '按计划' }])
  })

  it('saves own scenarios as private web scenarios with the full practice plan', async () => {
    const { data } = await call(POST, userA, { scenarios: { upsert: [scenario()] } })
    const [row] = db.tables.scenarios
    expect(row).toMatchObject({ id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', user_id: userA, is_public: false, category_slug: 'daily_life' })
    expect(row.system_prompt).toContain('Morgan')
    expect(data.scenarios).toEqual([scenario()])
    expect((await call(POST, userB, { scenarios: { upsert: [scenario({ title: '劫持' })] } })).status).toBe(409)
    expect(row.title_zh).toBe('退押金')
    await call(POST, userA, { scenarios: { delete: [scenario().id] } })
    expect(db.tables.scenarios).toHaveLength(0)
  })

  it('isolates accounts and refuses the local development pairing', async () => {
    await call(POST, userA, { sessions: { upsert: [session()] }, expressions: { upsert: [{ text: 'x', meaning: 'y', source: '', createdAt: '2026-10-05T10:00:00.000Z' }] } })
    const other = await call(GET, userB, undefined, 'GET')
    expect(other.data).toEqual({ sessions: [], expressions: [], scenarios: [] })
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('IOS_PRACTICE_DEV_ENABLED', '1'); vi.stubEnv('IOS_PRACTICE_DEV_TOKEN', 'c'.repeat(64))
    expect((await call(GET, 'c'.repeat(64), undefined, 'GET')).status).toBe(400)
  })

  it('rejects a malformed request, and skips only the session that cannot be stored', async () => {
    expect((await call(POST, userA, { unknown: true })).status).toBe(400)
    const broken = { ...session({ id: 'B0000000-1111-4222-8333-444455556666' }), messages: 'oops' }
    const { status, data } = await call(POST, userA, { sessions: { upsert: [broken, session()] } })
    expect(status).toBe(200)
    expect(data.rejectedSessions).toEqual(['b0000000-1111-4222-8333-444455556666'])
    expect(db.tables.chat_history).toHaveLength(1)
  })
})

describe('account deletion', () => {
  const confirm = { identityToken: 'x'.repeat(40), nonce: 'n'.repeat(32), authorizationCode: 'code' }
  it('requires the confirming Apple ID to be the signed-in account', async () => {
    verifyApple.mockResolvedValue({ email: 'other@example.com' }); findUser.mockResolvedValue(userB)
    db.tables.chat_history = [{ user_id: userA, news_key: 'news:1' }]
    expect((await call(DELETE_ACCOUNT, userA, confirm)).status).toBe(403)
    expect(db.tables.chat_history).toHaveLength(1)
    expect(deleteUser).not.toHaveBeenCalled()
  })
  it('removes web and app data, revokes Apple and deletes the auth user', async () => {
    verifyApple.mockResolvedValue({ email: 'me@example.com' }); findUser.mockResolvedValue(userA)
    for (const table of ['chat_history', 'unfamiliar_english', 'scenarios', 'user_preferences']) {
      db.tables[table] = [{ user_id: userA, id: randomUUID() }, { user_id: userB, id: randomUUID() }]
    }
    const { status, data } = await call(DELETE_ACCOUNT, userA, confirm)
    expect(status).toBe(200)
    expect(data).toEqual({ deleted: true })
    for (const table of ['chat_history', 'unfamiliar_english', 'scenarios', 'user_preferences']) {
      expect(db.tables[table].map(row => row.user_id)).toEqual([userB])
    }
    expect(revoke).toHaveBeenCalledWith('code')
    expect(deleteUser).toHaveBeenCalledWith(userA)
  })
})
