import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { auth, generateContent, historyRequest } = vi.hoisted(() => ({
  auth: vi.fn(), generateContent: vi.fn(), historyRequest: vi.fn(),
}))
vi.mock('@/app/auth', () => ({ auth }))
vi.mock('@/app/lib/server/geminiConfig', () => ({
  createServerGeminiClient: () => ({ models: { generateContent } }),
}))
vi.mock('@/app/lib/history/server', async original => ({
  ...await original(),
  getHistoryDatabaseConfig: () => ({ baseUrl: 'https://db.test', serviceRoleKey: 'x', schema: 'public' }),
  historyDatabaseRequest: historyRequest,
}))

import { GET as NEWS } from '@/app/api/news/route'
import { POST as TRANSLATE } from '@/app/api/translate/route'
import { GET as HISTORY } from '@/app/api/chat-history/route'

beforeEach(() => {
  delete globalThis[Symbol.for('lingdaily.newsFeedCache.v1')]
  delete globalThis[Symbol.for('lingdaily.headlineTranslations.v1')]
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('/api/news feed cache', () => {
  const news = category => NEWS(new Request(`https://lingdaily.test/api/news?category=${category}`))

  it('serves repeat and concurrent requests from one upstream fetch, per category', async () => {
    const fetchMock = vi.fn(async url => new Response(`<rss>${url}</rss>`, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([news('world'), news('world')])
    expect(await a.text()).toBe('<rss>https://news.kagi.com/world.xml</rss>')
    expect(await b.text()).toBe('<rss>https://news.kagi.com/world.xml</rss>')
    expect((await news('world')).headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await news('tech')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refetches after five minutes and never caches a failure', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockRejectedValueOnce(new Error('network'))
      .mockImplementation(async () => new Response('<rss/>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await news('world')).status).toBe(502)
    expect((await news('world')).status).toBe(500)
    expect((await news('world')).status).toBe(200)
    expect((await news('world')).status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1)
    await news('world')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('/api/translate headline cache', () => {
  const translate = (text, targetLang = 'zh-CN') => TRANSLATE(new Request('https://lingdaily.test/api/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, targetLang }),
  }))

  it('translates a headline once for everyone, without thinking and with a timeout', async () => {
    auth.mockResolvedValue({ user: { id: 'user-1' } })
    generateContent.mockResolvedValue({ text: ' 标题 ' })
    expect(await (await translate('Headline')).json()).toEqual({ ok: true, translation: '标题', sourceText: 'Headline', targetLanguage: 'zh-CN' })
    auth.mockResolvedValue({ user: { id: 'user-2' } })
    expect((await (await translate('Headline')).json()).translation).toBe('标题')
    expect(generateContent).toHaveBeenCalledTimes(1)
    const { config } = generateContent.mock.calls[0][0]
    expect(config).toMatchObject({ temperature: 0, maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } })
    expect(config.abortSignal).toBeInstanceOf(AbortSignal)

    await translate('Headline', 'ja')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures and still requires sign-in', async () => {
    auth.mockResolvedValue(null)
    expect((await translate('Headline')).status).toBe(401)
    auth.mockResolvedValue({ user: { id: 'user-1' } })
    generateContent.mockResolvedValueOnce({ text: '' }).mockResolvedValueOnce({ text: '标题' })
    expect((await translate('Headline')).status).toBe(502)
    expect((await (await translate('Headline')).json()).translation).toBe('标题')
    expect(generateContent).toHaveBeenCalledTimes(2)
  })
})

describe('/api/chat-history list', () => {
  const user = 'user-1'
  const row = (overrides = {}) => ({
    id: '11111111-2222-4333-8444-555555555555', news_key: 'practice:abc', news_title: '', revision: 2, source_type: 'practice',
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z',
    history: [{ role: 'user', content: 'Hello there' }, { role: 'assistant', content: 'Hi!' }],
    ...overrides,
  })
  const list = () => HISTORY(new Request('https://lingdaily.test/api/chat-history'))

  it('reads only the title fields of the news snapshot and builds the same list item', async () => {
    auth.mockResolvedValue({ user: { id: user } })
    historyRequest.mockResolvedValue({ ok: true, status: 200, data: [row({ news_original_title: null, news_embedded_title: 'From news', news_embedded_id: 7 })] })
    const body = await (await list()).json()
    const select = historyRequest.mock.calls[0][2].params.get('select')
    expect(select).not.toBe('*')
    expect(select).toContain('news_embedded_title:news->title')
    expect(body.data).toEqual([expect.objectContaining({ title: 'From news', sourceType: 'practice', preview: 'Hi!', userTurnCount: 1, revision: 2 })])
  })

  it('falls back to whole rows on a schema without the newer columns', async () => {
    auth.mockResolvedValue({ user: { id: user } })
    historyRequest
      .mockResolvedValueOnce({ ok: false, status: 400, data: { code: '42703', message: 'column chat_history.revision does not exist' } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: [row({ revision: undefined, source_type: undefined, news: { originalTitle: 'Old' } })] })
    const body = await (await list()).json()
    expect(historyRequest.mock.calls[1][2].params.get('select')).toBe('*')
    expect(body.data).toEqual([expect.objectContaining({ title: 'Old', sourceType: 'practice', revision: 1 })])
  })
})
