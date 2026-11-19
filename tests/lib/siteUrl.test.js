import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SITE_URL, getSiteUrl } from '@/app/lib/siteUrl.cjs'
import { renderFeedXml } from '@/app/lib/podcast/feed'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getSiteUrl', () => {
  it('uses NEXT_PUBLIC_SITE_URL when set', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.example')
    expect(getSiteUrl()).toBe('https://staging.example')
  })

  it('falls back to the production origin when unset', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    expect(getSiteUrl()).toBe(DEFAULT_SITE_URL)
    expect(DEFAULT_SITE_URL).toBe('https://lingdaily.yasobi.xyz')
  })
})

describe('podcast feed base URL', () => {
  const render = () => renderFeedXml({ episodes: [] })

  it('prefers PODCAST_PUBLIC_URL over the site URL', () => {
    vi.stubEnv('PODCAST_PUBLIC_URL', 'https://podcast.example/')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example')
    expect(render()).toContain('https://podcast.example/podcasts/feed.xml')
  })

  it('uses the shared site URL default when no env is set', () => {
    vi.stubEnv('PODCAST_PUBLIC_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    const xml = render()
    expect(xml).toContain(`${DEFAULT_SITE_URL}/podcasts/feed.xml`)
    expect(xml).not.toContain('localhost')
  })
})
