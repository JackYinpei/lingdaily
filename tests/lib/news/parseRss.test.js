// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cleanKagiDescription,
  extractKagiImage,
  parseKagiRss,
  stripKagiSources,
} from '@/app/lib/news/parseRss'

const kagiDescription = [
  "<img src='https://kagi.example/img/flood.jpg' alt='Flooded street'>",
  '<p>Heavy rain flooded the city centre &amp; closed schools (Reuters)</p>',
  '<h3>Highlights</h3>',
  '<ul><li>Officials said it&#x27;s the worst flood in 50 years</li>',
  '<li>Trains between A &lt;-&gt; B were halted [bbc.com]</li></ul>',
  '<p>Recovery may take&nbsp;weeks.<br/>Residents  were\tevacuated &quot;quickly&quot;.</p>',
  "<h3>Sources:</h3><ul><li><a href='https://reuters.com/x'>Reuters</a></li></ul>",
].join('')

const rssFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Kagi News - World</title>
    <item>
      <title>City hit by record floods</title>
      <link>https://kagi.example/world/floods</link>
      <description><![CDATA[${kagiDescription}]]></description>
      <pubDate>Wed, 18 Nov 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <description><![CDATA[<p>(AP)</p>]]></description>
    </item>
  </channel>
</rss>`

describe('stripKagiSources', () => {
  it('drops everything from the Sources heading onwards', () => {
    expect(stripKagiSources('<p>Body</p><h3>Sources:</h3><ul><li>x</li></ul>')).toBe('<p>Body</p>')
  })

  it('keeps descriptions without a Sources heading', () => {
    expect(stripKagiSources('<p>Body</p>')).toBe('<p>Body</p>')
  })
})

describe('extractKagiImage', () => {
  it('reads the first single-quoted img src', () => {
    expect(extractKagiImage("<p>a</p><img src='https://x/1.jpg'><img src='https://x/2.jpg'>")).toBe('https://x/1.jpg')
  })

  it('ignores double-quoted img src and returns null', () => {
    expect(extractKagiImage('<img src="https://x/1.jpg">')).toBeNull()
  })
})

describe('cleanKagiDescription', () => {
  it('converts Kagi markup to formatted plain text', () => {
    expect(cleanKagiDescription(stripKagiSources(kagiDescription))).toBe(
      'Heavy rain flooded the city centre & closed schools\n' +
        'Highlights\n\n' +
        "• Officials said it's the worst flood in 50 years\n" +
        '• Trains between A <-> B were halted Recovery may take&nbsp;weeks.\n' +
        'Residents were evacuated "quickly".',
    )
  })

  it('decodes numeric and hex entities', () => {
    expect(cleanKagiDescription('caf&#233; &#x2F; na&#xEF;ve')).toBe('café / naïve')
  })

  it('strips a trailing parenthetical on every line', () => {
    expect(cleanKagiDescription('<p>First (AP)</p><p>Second (The Hindu)</p>')).toBe('First\nSecond')
  })

  it('removes bracketed link or file references but keeps plain brackets', () => {
    expect(cleanKagiDescription('See [example.com] [#12] [image.jpeg] and [note]')).toBe('See and [note]')
  })
})

describe('parseKagiRss', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps feed items to the NewsFeed article shape', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'))

    const articles = parseKagiRss(rssFixture, 'world', {
      categoryId: 'world',
      categoryName: 'World',
      sourceLanguage: 'en',
    })

    expect(articles).toEqual([
      {
        id: 'world-0',
        title: 'City hit by record floods',
        link: 'https://kagi.example/world/floods',
        description: cleanKagiDescription(stripKagiSources(kagiDescription)),
        urlToImage: 'https://kagi.example/img/flood.jpg',
        category: 'World',
        sourceLanguage: 'en',
        date: 'Wed, 18 Nov 2026 08:00:00 GMT',
      },
      {
        id: 'world-1',
        title: 'Untitled',
        link: '',
        description: 'No description available',
        urlToImage: null,
        category: 'World',
        sourceLanguage: 'en',
        date: '2026-11-19T00:00:00.000Z',
      },
    ])
  })

  it('falls back to generic category metadata when the category is unknown', () => {
    const [article] = parseKagiRss(rssFixture, 'mystery', undefined)

    expect(article.id).toBe('mystery-0')
    expect(article.category).toBe('News')
    expect(article.sourceLanguage).toBe('en')
  })

  it('returns no articles for a feed without items', () => {
    expect(parseKagiRss('<rss><channel></channel></rss>', 'world', undefined)).toEqual([])
  })
})
