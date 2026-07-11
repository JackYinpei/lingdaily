import { describe, expect, it } from 'vitest'

import {
  normalizePodcastShownotes,
  renderPodcastShownotesHtml,
  renderPodcastShownotesText,
} from '@/app/lib/podcast/shownotes'

describe('podcast shownotes', () => {
  it('normalizes bilingual summaries and vocabulary from stored episode content', () => {
    const shownotes = normalizePodcastShownotes({
      summary: '兼容摘要',
      content: {
        shownotes: {
          summary_zh: ' 今日中文摘要。 ',
          summary_en: ' Today in English. ',
          vocabulary: [
            {
              term: ' watershed ',
              meaning_zh: ' 转折点 ',
              definition_en: 'A major turning point.',
              example_en: 'The vote was a watershed moment.',
            },
            { term: '  ', meaning_zh: '没有词条时应忽略' },
          ],
        },
      },
    })

    expect(shownotes).toEqual({
      summaryZh: '今日中文摘要。',
      summaryEn: 'Today in English.',
      vocabulary: [{
        term: 'watershed',
        meaningZh: '转折点',
        definitionEn: 'A major turning point.',
        exampleEn: 'The vote was a watershed moment.',
      }],
    })
  })

  it('keeps historical episodes with only summary readable', () => {
    const legacy = { summary: '旧节目只有这一段摘要。' }

    expect(normalizePodcastShownotes(legacy)).toEqual({
      summaryZh: '旧节目只有这一段摘要。',
      summaryEn: '',
      vocabulary: [],
    })
    expect(renderPodcastShownotesText(legacy)).toBe('中文摘要\n旧节目只有这一段摘要。')
  })

  it('supports shownotes nested in a stored script content object', () => {
    const shownotes = normalizePodcastShownotes({
      summary: '兼容摘要',
      content: {
        episode_summary: '脚本摘要',
        content: {
          shownotes: {
            summary_zh: '嵌套中文摘要',
            summary_en: 'Nested English summary',
            vocabulary: [],
          },
        },
      },
    })

    expect(shownotes.summaryZh).toBe('嵌套中文摘要')
    expect(shownotes.summaryEn).toBe('Nested English summary')
  })

  it('renders the text artifact with both summaries and vocabulary', () => {
    const text = renderPodcastShownotesText({
      episode_summary: '兼容摘要',
      shownotes: {
        summary_zh: '中文内容',
        summary_en: 'English content',
        vocabulary: [{
          term: 'resilient',
          meaning_zh: '有韧性的',
          definition_en: 'Able to recover quickly.',
          example_en: 'The market remained resilient.',
        }],
      },
    })

    expect(text).toContain('中文摘要\n中文内容')
    expect(text).toContain('English Summary\nEnglish content')
    expect(text).toContain('生词 Vocabulary\n1. resilient')
    expect(text).toContain('中文释义：有韧性的')
    expect(text).toContain('English definition: Able to recover quickly.')
    expect(text).toContain('Example: The market remained resilient.')
  })

  it('escapes every generated field before adding RSS HTML markup', () => {
    const html = renderPodcastShownotesHtml({
      shownotes: {
        summary_zh: '<script>alert("zh")</script>',
        summary_en: 'News & <b>analysis</b>',
        vocabulary: [{
          term: '<img src=x onerror=alert(1)>',
          meaning_zh: 'A & B',
          definition_en: 'Use </li><script>bad()</script>',
          example_en: '"quoted" & dangerous',
        }],
      },
    })

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(&quot;zh&quot;)&lt;/script&gt;')
    expect(html).toContain('News &amp; &lt;b&gt;analysis&lt;/b&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&quot;quoted&quot; &amp; dangerous')
  })
})
