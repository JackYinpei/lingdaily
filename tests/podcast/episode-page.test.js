import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/podcast/repository', () => ({ getPodcastEpisode: vi.fn() }))

const { getPodcastEpisode } = await import('@/app/lib/podcast/repository')
const { generateMetadata } = await import('@/app/podcasts/[date]/page.jsx')

const metadataFor = (date) => generateMetadata({ params: Promise.resolve({ date }) })

beforeEach(() => {
  getPodcastEpisode.mockReset()
})

describe('podcast episode page metadata', () => {
  it('uses the episode title and shownotes summary', async () => {
    getPodcastEpisode.mockResolvedValue({
      date: '2026-11-18',
      title: '美联储降息与AI芯片出口新规',
      content: { shownotes: { summary_zh: '今天聊美联储降息。', summary_en: 'Today: the Fed cuts rates.' } },
    })

    await expect(metadataFor('2026-11-18')).resolves.toEqual({
      title: '美联储降息与AI芯片出口新规 | LingDaily Podcasts',
      description: '今天聊美联储降息。',
    })
    expect(getPodcastEpisode).toHaveBeenCalledWith('2026-11-18')
  })

  it('falls back to the date when the episode has no title or summary', async () => {
    getPodcastEpisode.mockResolvedValue({ date: '2026-11-18', title: '', content: {} })

    await expect(metadataFor('2026-11-18')).resolves.toEqual({ title: '2026-11-18 | LingDaily Podcasts' })
  })

  it('returns no overrides for a missing episode, a failed lookup or an invalid date', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getPodcastEpisode.mockResolvedValueOnce(null)
    await expect(metadataFor('2026-11-17')).resolves.toEqual({})

    getPodcastEpisode.mockRejectedValueOnce(new Error('database down'))
    await expect(metadataFor('2026-11-16')).resolves.toEqual({})

    await expect(metadataFor('not-a-date')).resolves.toEqual({})
    expect(getPodcastEpisode).toHaveBeenCalledTimes(2)
  })
})
