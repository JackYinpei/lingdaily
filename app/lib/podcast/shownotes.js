function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function contentFrom(source) {
  if (!source || typeof source !== 'object') return {}
  if (source.content && typeof source.content === 'object') return source.content
  return source
}

function normalizeVocabulary(value) {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => ({
      term: cleanText(item?.term),
      meaningZh: cleanText(item?.meaning_zh),
      definitionEn: cleanText(item?.definition_en),
      exampleEn: cleanText(item?.example_en),
    }))
    .filter((item) => item.term)
}

/**
 * Normalize both current podcast scripts and historical episode rows.
 *
 * Current rows expose the generated script at `episode.content`, while the
 * generation route passes that script directly. Historical rows may only have
 * a `summary`, so that value remains a readable fallback.
 */
export function normalizePodcastShownotes(source) {
  const content = contentFrom(source)
  const nestedContent = content.content && typeof content.content === 'object'
    ? content.content
    : {}
  const shownotesSource = content.shownotes || nestedContent.shownotes
  const shownotes = shownotesSource && typeof shownotesSource === 'object'
    ? shownotesSource
    : {}
  const compatibilitySummary = cleanText(
    source?.summary
      || content.episode_summary
      || nestedContent.episode_summary
      || source?.episode_summary,
  )

  return {
    summaryZh: cleanText(shownotes.summary_zh) || compatibilitySummary,
    summaryEn: cleanText(shownotes.summary_en),
    vocabulary: normalizeVocabulary(shownotes.vocabulary),
  }
}

export function renderPodcastShownotesText(source) {
  const shownotes = normalizePodcastShownotes(source)
  const lines = []

  if (shownotes.summaryZh) {
    lines.push('中文摘要', shownotes.summaryZh)
  }
  if (shownotes.summaryEn) {
    if (lines.length) lines.push('')
    lines.push('English Summary', shownotes.summaryEn)
  }
  if (shownotes.vocabulary.length) {
    if (lines.length) lines.push('')
    lines.push('生词 Vocabulary')
    shownotes.vocabulary.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.term}`)
      if (item.meaningZh) lines.push(`   中文释义：${item.meaningZh}`)
      if (item.definitionEn) lines.push(`   English definition: ${item.definitionEn}`)
      if (item.exampleEn) lines.push(`   Example: ${item.exampleEn}`)
    })
  }

  return lines.join('\n')
}

export function escapePodcastHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlText(value) {
  return escapePodcastHtml(value).replace(/\r?\n/g, '<br />')
}

/**
 * Render a small, sanitized HTML fragment suitable for RSS CDATA fields.
 * Every generated value is escaped before any markup is introduced.
 */
export function renderPodcastShownotesHtml(source) {
  const shownotes = normalizePodcastShownotes(source)
  const sections = []

  if (shownotes.summaryZh) {
    sections.push(`<h3>中文摘要</h3><p lang="zh-CN">${htmlText(shownotes.summaryZh)}</p>`)
  }
  if (shownotes.summaryEn) {
    sections.push(`<h3>English Summary</h3><p lang="en">${htmlText(shownotes.summaryEn)}</p>`)
  }
  if (shownotes.vocabulary.length) {
    const items = shownotes.vocabulary.map((item) => {
      const details = []
      if (item.meaningZh) details.push(`<span lang="zh-CN">${htmlText(item.meaningZh)}</span>`)
      if (item.definitionEn) details.push(`<span lang="en">${htmlText(item.definitionEn)}</span>`)
      if (item.exampleEn) details.push(`<em lang="en">Example: ${htmlText(item.exampleEn)}</em>`)
      return `<li><strong>${htmlText(item.term)}</strong>${details.length ? `<br />${details.join('<br />')}` : ''}</li>`
    }).join('')
    sections.push(`<h3>生词 Vocabulary</h3><ol>${items}</ol>`)
  }

  return `<section><h2>Show Notes</h2>${sections.join('')}</section>`
}
