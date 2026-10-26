import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/app/lib/podcast/repository', () => ({ listPodcastEpisodes: vi.fn() }))
vi.mock('@/app/lib/server/geminiConfig', () => ({ getServerGeminiApiKey: () => 'fake-provider-secret', getServerGeminiBaseUrl: () => '' }))

import { GET } from '@/app/api/ios/today/route'
import { createTodayService, todayDTO } from '@/app/lib/server/iosToday'

const vocabulary = Array.from({ length: 8 }, (_, index) => ({
  term: `term ${index}`, meaning_zh: `含义${index}`, definition_en: 'definition', example_en: `Example ${index}.`,
}))
const episode = (overrides = {}) => ({
  date: '2026-10-26', title: 'LingDaily 每日播客 10/26', summary: 'legacy', duration: 611.6,
  audioUrl: 'https://cos.example.test/2026-10-26.mp3',
  content: { shownotes: { summary_zh: '今天聊折叠屏和航运。', summary_en: 'Foldables and shipping.', vocabulary }, chunks: [] },
  ...overrides,
})
const draft = {
  title: '聊聊折叠屏', subtitle: '说说你的看法', category: '社交', partner: 'Riley', partnerRole: '爱聊新闻的同事',
  setting: '今天的 LingDaily 播客聊到折叠屏手机降价了。', steps: [],
}
const now = () => Date.parse('2026-10-26T12:00:00Z')

describe('today card', () => {
  let loadLatest, generate
  beforeEach(() => {
    loadLatest = vi.fn().mockResolvedValue(episode())
    generate = vi.fn().mockResolvedValue({ model: 'test-model', scenario: draft })
  })
  afterEach(() => vi.useRealTimers())

  it('returns the podcast with its eight terms and a rehearsal generated once for everyone', async () => {
    const today = createTodayService({ loadLatest, generate, now })
    const first = await today('user-a')
    expect(first.today).toEqual({
      date: '2026-10-26', title: 'LingDaily 每日播客 10/26', summary: '今天聊折叠屏和航运。',
      audioURL: 'https://cos.example.test/2026-10-26.mp3', duration: 612,
      vocabulary: vocabulary.map((item, index) => ({ term: `term ${index}`, meaning: `含义${index}`, example: `Example ${index}.` })),
      scenario: draft,
    })
    await today('user-b')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(loadLatest).toHaveBeenCalledTimes(1)
  })
  it('shows nothing when there is no recent episode or the podcast store is down', async () => {
    expect(await createTodayService({ loadLatest: vi.fn().mockResolvedValue(null), generate, now })('u')).toEqual({ today: null })
    const stale = vi.fn().mockResolvedValue(episode({ date: '2026-10-10' }))
    expect(await createTodayService({ loadLatest: stale, generate, now })('u')).toEqual({ today: null })
    const down = vi.fn().mockRejectedValue(new Error('db down'))
    expect(await createTodayService({ loadLatest: down, generate, now })('u')).toEqual({ today: null })
    expect(generate).not.toHaveBeenCalled()
  })
  it('keeps the podcast when the rehearsal fails, and retries it later', async () => {
    let time = now()
    generate.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'MODEL_BUSY' }))
    const today = createTodayService({ loadLatest, generate, now: () => time })
    expect((await today('u')).today).toMatchObject({ title: 'LingDaily 每日播客 10/26', scenario: null })
    expect((await today('u')).today.scenario).toBeNull()
    expect(generate).toHaveBeenCalledTimes(1)
    time += 11 * 60_000
    expect((await today('u')).today.scenario).toEqual(draft)
    expect(generate).toHaveBeenCalledTimes(2)
  })
  it('does not hold the card for a slow first generation', async () => {
    generate.mockReturnValue(new Promise(() => {}))
    const result = await createTodayService({ loadLatest, generate, now, wait: 5 })('u')
    expect(result.today).toMatchObject({ date: '2026-10-26', scenario: null })
  })
  it('drops audio that is not served over https', () => {
    expect(todayDTO(episode({ audioUrl: 'http://cos.example.test/a.mp3', duration: 0 }))).toMatchObject({ audioURL: null, duration: null })
  })
  it('requires an iOS session', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-for-ios-session-tests')
    const response = await GET(new Request('http://localhost:8000/api/ios/today', { headers: { Authorization: 'Bearer invalid' } }))
    expect(response.status).toBe(401)
    vi.unstubAllEnvs()
  })
})
