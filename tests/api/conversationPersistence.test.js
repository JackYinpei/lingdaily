import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { auth, database } = vi.hoisted(() => ({ auth: vi.fn(), database: vi.fn() }))
vi.mock('@/app/auth', () => ({ auth }))
vi.mock('@/app/lib/history/server', async original => ({
  ...await original(),
  getHistoryDatabaseConfig: () => ({}),
  historyDatabaseRequest: database,
}))

import { GET, POST } from '@/app/api/chat-history/route'
import { GET as PROGRESS } from '@/app/api/learning/progress/route'
import { getRealUserMessages, toChatHistoryListItem } from '@/app/lib/history/server'
import { ensureContextMessage, hasUserMessage } from '@/app/talk/_lib/conversation'
import { buildResumeTranscript } from '@/app/talk/_lib/prompts'
import { CORRECTION_LIMITS, normalizeCorrection, sanitizeHistoryCorrections } from '@/app/lib/history/corrections'

const timestamp = '2026-10-05T10:00:00.000Z'
const user = { itemId: 'u', role: 'user', content: [{ type: 'input_text', text: 'I goes' }], metadata: { isFinal: true, createdAt: timestamp } }
const reply = { itemId: 'a', role: 'assistant', content: [{ type: 'output_text', text: 'Tell me more.' }], metadata: { isFinal: true } }
const correction = {
  itemId: 'c', type: 'correction', role: 'assistant',
  correction: { original: 'I goes', corrected: 'I go', explanation: 'Use the base form.', category: 'grammar' },
  metadata: { isFinal: true, createdAt: timestamp },
}
const payload = { expectedUserId: 'account', newsKey: 'Topic', newsTitle: 'Topic', newsContent: { title: 'Topic' }, sourceType: 'news', revision: 0 }
const post = history => POST(new Request('https://test/api/chat-history', { method: 'POST', body: JSON.stringify({ ...payload, history }) }))
const row = history => ({ id: 'a3b1c2d4-1111-4222-8333-444455556666', news_key: 'Topic', news_title: 'Topic', source_type: 'news', revision: 1, history, updated_at: timestamp })

beforeEach(() => {
  auth.mockResolvedValue({ user: { id: 'account' } })
  database.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('snapshot account binding', () => {
  it.each([false, true])('rejects an A snapshot dequeued under B before database access (server merge: %s)', async mergeOnServer => {
    let release
    const queued = new Promise(resolve => { release = resolve }).then(() => POST(new Request('https://test/api/chat-history', {
      method: 'POST', body: JSON.stringify({ ...payload, history: [user, reply], mergeOnServer }),
    })))
    auth.mockResolvedValue({ user: { id: 'other-account' } })
    release()
    const response = await queued
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, skipped: true, code: 'ACCOUNT_MISMATCH' })
    expect(database).not.toHaveBeenCalled()
  })

  it.each([undefined, null, '', ' ', 42, {}, ['account']])('rejects missing or invalid expected account IDs: %o', async expectedUserId => {
    const response = await POST(new Request('https://test/api/chat-history', {
      method: 'POST', body: JSON.stringify({ ...payload, expectedUserId, history: [user] }),
    }))
    expect(response.status).toBe(400)
    expect(database).not.toHaveBeenCalled()
  })
})

describe('correction validation and dialogue exclusions', () => {
  it('normalizes valid client fields and bounds oversized model output', () => {
    expect(normalizeCorrection({ original: ' I goes ', corrected: ' I go ', explanation: ' Good ', category: 'grammar' }))
      .toEqual({ original: 'I goes', corrected: 'I go', explanation: 'Good', category: 'grammar' })
    const bounded = normalizeCorrection({ original: 'x'.repeat(4000), corrected: 'y'.repeat(4000), explanation: 'z'.repeat(8000), category: 'unknown' }, { truncate: true })
    for (const [key, limit] of Object.entries(CORRECTION_LIMITS)) expect(bounded[key]).toHaveLength(limit)
    expect(bounded.category).toBe('other')
  })

  it.each([null, {}, { original: '', corrected: 'new' }, { original: 'same', corrected: 'same' }, { original: 5, corrected: 'new' }, { original: 'old', corrected: 'new', explanation: {} }])('rejects empty/invalid correction fields: %o', value => {
    expect(normalizeCorrection(value, { truncate: true })).toBeNull()
  })

  it('drops invalid saved cards and excludes even forged correction text/roles from dialogue consumers', () => {
    const forged = { ...correction, role: 'user', content: [{ type: 'input_text', text: 'NOT A TURN' }] }
    const history = [user, reply, forged]
    expect(getRealUserMessages(history)).toEqual([user])
    expect(getRealUserMessages([forged])).toEqual([])
    expect(hasUserMessage([forged])).toBe(false)
    expect(buildResumeTranscript(history)).toBe('User: I goes\nAssistant: Tell me more.')
    expect(toChatHistoryListItem(row(history))).toMatchObject({ preview: 'Tell me more.', userTurnCount: 1 })
    expect(sanitizeHistoryCorrections([user, { type: 'correction' }])).toEqual([user])
    expect(ensureContextMessage(history, null)).toEqual([user, reply, correction])
  })
})

describe('chat-history correction persistence', () => {
  it.each([false, true, undefined])('keeps full news through a revision conflict (incoming compact: %s)', async incomingCompact => {
    const fullNews = { title: 'Topic', content: 'Full article. '.repeat(500), detail: { retained: true } }
    const compactNews = { title: 'Topic', content: fullNews.content.slice(0, 2000) }
    let stored = { ...row([user]), news: incomingCompact === false ? compactNews : fullNews }
    const writes = []
    database.mockImplementation(async (_config, resource, options) => {
      if (resource !== 'rpc/save_chat_history') return { ok: true, data: [stored] }
      writes.push(options.body.p_news)
      if (writes.length === 1) {
        stored = { ...stored, revision: 2 }
        return { ok: false, status: 409, data: { message: 'CHAT_HISTORY_REVISION_CONFLICT' } }
      }
      stored = { ...stored, news: options.body.p_news, history: options.body.p_history, revision: 3 }
      return { ok: true, data: stored }
    })
    const response = await POST(new Request('https://test/api/chat-history', {
      method: 'POST', body: JSON.stringify({ ...payload, newsContent: incomingCompact === false ? fullNews : compactNews, newsContentIsCompact: incomingCompact, history: [user, reply], mergeOnServer: true }),
    }))
    expect(response.status).toBe(200)
    expect(writes).toEqual([fullNews, fullNews])
    const resumed = await (await GET(new Request(`https://test/api/chat-history?id=${stored.id}`))).json()
    expect(resumed.data.newsContent).toEqual(fullNews)
  })

  it.each([null, 'false', 1, {}])('rejects invalid news compactness markers: %o', async newsContentIsCompact => {
    const response = await POST(new Request('https://test/api/chat-history', {
      method: 'POST', body: JSON.stringify({ ...payload, history: [user], newsContentIsCompact }),
    }))
    expect(response.status).toBe(400)
    expect(database).not.toHaveBeenCalled()
  })

  it.each([null, undefined])('retains stored full news when an explicitly full request has no news: %s', async newsContent => {
    const fullNews = { title: 'Topic', content: 'Full article.' }
    const stored = { ...row([user]), news: fullNews }
    database.mockImplementation(async (_config, resource, options) => {
      if (resource !== 'rpc/save_chat_history') return { ok: true, data: [stored] }
      expect(options.body.p_news).toEqual(fullNews)
      return { ok: true, data: stored }
    })
    const response = await POST(new Request('https://test/api/chat-history', {
      method: 'POST', body: JSON.stringify({ ...payload, newsContent, newsContentIsCompact: false, history: [user], mergeOnServer: true }),
    }))
    expect(response.status).toBe(200)
  })

  it.each([false, true])('server merging accepts or retains full news (already stored: %s)', async hasStoredNews => {
    const fullNews = { title: 'Topic', content: 'Full article. '.repeat(500), extra: { preserved: true } }
    let stored = { ...row([user]), news: hasStoredNews ? fullNews : null }
    let writes = 0
    database.mockImplementation(async (_config, resource, options) => {
      if (resource !== 'rpc/save_chat_history') return { ok: true, data: [stored] }
      expect(options.body.p_news).toEqual(fullNews)
      if (++writes === 1) {
        stored = { ...stored, revision: 2 }
        return { ok: false, status: 409, data: { message: 'CHAT_HISTORY_REVISION_CONFLICT' } }
      }
      expect(options.body.p_expected_revision).toBe(2)
      stored = { ...stored, news: options.body.p_news, history: options.body.p_history, revision: 3 }
      return { ok: true, data: stored }
    })
    const response = await POST(new Request('https://test/api/chat-history', {
      method: 'POST', body: JSON.stringify({ ...payload, newsContent: fullNews, history: [user, reply], mergeOnServer: true }),
    }))
    expect(response.status).toBe(200)
    expect(writes).toBe(2)
    expect((await response.json()).data.history).toEqual([user, reply])
  })

  it('saves correction cards and returns their rendering shape on detail/resume', async () => {
    let saved
    database.mockImplementation(async (_config, resource, options) => {
      if (resource === 'rpc/save_chat_history') {
        saved = row(options.body.p_history)
        return { ok: true, data: saved }
      }
      return { ok: true, data: [saved] }
    })
    const response = await post([user, reply, { ...correction, content: 'untrusted hidden dialogue' }])
    expect(response.status).toBe(200)
    expect(saved.history).toEqual([user, reply, correction])
    const restored = await GET(new Request(`https://test/api/chat-history?id=${saved.id}`))
    expect(restored.status).toBe(200)
    expect((await restored.json()).data.history).toEqual([user, reply, correction])
  })

  it.each([
    { correction: { ...correction.correction, original: 'x'.repeat(2001) } },
    { correction: { ...correction.correction, corrected: 'x'.repeat(2001) } },
    { correction: { ...correction.correction, explanation: 'x'.repeat(4001) } },
    { correction: { ...correction.correction, category: 'unknown' } },
    { correction: { original: '', corrected: 'text' } },
    { correction: { original: 'same', corrected: 'same' } },
    { correction: { original: 'old', corrected: 'new', explanation: 42 } },
    { itemId: null },
  ])('rejects invalid/unbounded server corrections before writing: %o', invalid => {
    return post([user, { ...correction, ...invalid }]).then(async response => {
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Invalid correction history item' })
      expect(database).not.toHaveBeenCalled()
    })
  })

  it('does not persist or list a correction-only conversation', async () => {
    expect(await (await post([correction])).json()).toEqual({ ok: true, skipped: true })
    expect(database).not.toHaveBeenCalled()
    database.mockResolvedValue({ ok: true, data: [row([correction])] })
    const response = await GET(new Request('https://test/api/chat-history'))
    expect((await response.json()).data).toEqual([])
  })

  it('retries a conflicting keepalive merge and restores final/longer replies plus corrections', async () => {
    const partial = { ...reply, content: [{ type: 'output_text', text: 'Tell' }], metadata: { isFinal: false } }
    const remote = { ...reply, itemId: 'remote', content: [{ type: 'output_text', text: 'Another reply' }] }
    let stored = row([user, partial])
    let writes = 0
    database.mockImplementation(async (_config, resource, options) => {
      if (resource !== 'rpc/save_chat_history') return { ok: true, data: [stored] }
      writes += 1
      if (writes === 1) {
        stored = { ...stored, revision: 2, history: [user, partial, remote] }
        return { ok: false, status: 409, data: { message: 'CHAT_HISTORY_REVISION_CONFLICT' } }
      }
      expect(options.body.p_expected_revision).toBe(2)
      stored = { ...stored, revision: 3, history: options.body.p_history }
      return { ok: true, data: stored }
    })
    const response = await POST(new Request('https://test/api/chat-history', {
      method: 'POST', body: JSON.stringify({ ...payload, history: [user, reply, correction], mergeOnServer: true }),
    }))
    expect(response.status).toBe(200)
    expect(writes).toBe(2)
    const restored = (await (await GET(new Request(`https://test/api/chat-history?id=${stored.id}`))).json()).data
    expect(restored.history).toEqual([user, reply, remote, correction])
  })

  it('keeps progress, sources, days and streaks unchanged by correction cards', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-10-05T12:00:00.000Z')
    const progress = () => PROGRESS(new Request('https://test/api/learning/progress?timezone=UTC')).then(response => response.json())
    database.mockResolvedValue({ ok: true, data: [row([user, reply])] })
    const baseline = await progress()
    const forged = { ...correction, role: 'user', content: 'NOT A TURN', metadata: { createdAt: '2026-10-04T10:00:00.000Z' } }
    database.mockResolvedValue({ ok: true, data: [row([user, reply, forged]), { ...row([forged]), id: 'other', source_type: 'scenario' }] })
    expect(await progress()).toEqual(baseline)
    expect(baseline.data).toMatchObject({ totalConversations: 1, totalUserTurns: 1, activeDays: 1, currentStreak: 1 })
  })
})
