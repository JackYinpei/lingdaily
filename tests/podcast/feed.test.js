import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderFeedXml } from '@/app/lib/podcast/feed'

afterEach(() => {
  vi.unstubAllEnvs()
})

function episode(overrides = {}) {
  return {
    id: '2026-07-11',
    title: '今日新闻',
    summary: '兼容摘要',
    pubDate: '2026-07-11T05:00:00.000Z',
    filename: '2026-07-11.mp3',
    size: 1024,
    duration: 125,
    enclosureUrl: 'https://cdn.example.com/2026-07-11.mp3',
    ...overrides,
  }
}

describe('podcast RSS feed', () => {
  it('publishes bilingual summaries and vocabulary in all episode note fields', () => {
    vi.stubEnv('PODCAST_PUBLIC_URL', 'https://lingdaily.example')
    const xml = renderFeedXml({
      episodes: [episode({
        content: {
          shownotes: {
            summary_zh: '中文摘要内容。',
            summary_en: 'English summary content.',
            vocabulary: [{
              term: 'momentum',
              meaning_zh: '势头',
              definition_en: 'The force that keeps something developing.',
              example_en: 'The project gained momentum.',
            }],
          },
        },
      })],
    })

    expect(xml).toContain('<description><![CDATA[<section><h2>Show Notes</h2>')
    expect(xml).toContain('<itunes:summary><![CDATA[中文摘要')
    expect(xml).toContain('<content:encoded><![CDATA[<section><h2>Show Notes</h2>')
    for (const value of [
      '中文摘要内容。',
      'English summary content.',
      'momentum',
      '势头',
      'The force that keeps something developing.',
      'The project gained momentum.',
    ]) {
      expect(xml).toContain(value)
    }
  })

  it('escapes generated markup and neutralizes a CDATA terminator', () => {
    const xml = renderFeedXml({
      episodes: [episode({
        title: '<title>& unsafe',
        content: {
          shownotes: {
            summary_zh: '<script>bad()</script> ]]>',
            summary_en: '<b onclick="bad()">English</b>',
            vocabulary: [{
              term: '<img src=x>',
              meaning_zh: '&危险',
              definition_en: '</li><script>bad()</script>',
              example_en: 'safe ]]> tail',
            }],
          },
        },
      })],
    })

    const itemXml = xml.match(/<item>([\s\S]*?)<\/item>/)?.[1]
    const description = itemXml?.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
    const encoded = itemXml?.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/)?.[1]

    expect(xml).toContain('<title>&lt;title&gt;&amp; unsafe</title>')
    expect(description).not.toContain('<script>bad()</script>')
    expect(description).not.toContain('<img src=x>')
    expect(encoded).not.toContain('<script>bad()</script>')
    expect(encoded).not.toContain('<img src=x>')
    expect(description).toContain('&lt;script&gt;bad()&lt;/script&gt;')
    expect(encoded).toContain('&lt;img src=x&gt;')
    expect(xml).toContain('safe ]]]]><![CDATA[> tail')
  })

  it('keeps plain-text iTunes summaries free of double XML encoding', () => {
    const xml = renderFeedXml({
      episodes: [episode({
        content: {
          shownotes: {
            summary_zh: '研发 & 市场',
            summary_en: 'Research & development <overview>',
            vocabulary: [],
          },
        },
      })],
    })
    const itemXml = xml.match(/<item>([\s\S]*?)<\/item>/)?.[1]
    const summary = itemXml?.match(/<itunes:summary><!\[CDATA\[([\s\S]*?)\]\]><\/itunes:summary>/)?.[1]

    expect(summary).toContain('研发 & 市场')
    expect(summary).toContain('Research & development <overview>')
    expect(summary).not.toContain('&amp;')
    expect(summary).not.toContain('&lt;overview&gt;')
  })

  it('keeps legacy summary-only manifest entries valid', () => {
    const xml = renderFeedXml({ episodes: [episode({ summary: '历史节目摘要。' })] })

    expect(xml).toContain('中文摘要')
    expect(xml).toContain('历史节目摘要。')
    expect(xml).toContain('<itunes:duration>02:05</itunes:duration>')
  })
})
