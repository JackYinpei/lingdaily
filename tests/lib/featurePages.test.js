// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ nativeCode: 'en', toggleTheme: vi.fn() }))
vi.mock('@/app/contexts/LanguageContext', () => ({
  useLanguage: () => ({ nativeLanguage: { code: state.nativeCode }, learningLanguage: { code: 'en' } }),
}))
vi.mock('@/app/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'system', toggleTheme: state.toggleTheme }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => React.createElement('a', { ...props, href: typeof href === 'string' ? href : `${href.pathname}?${new URLSearchParams(href.query)}` }, children) }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'test-user' } } }) }))
vi.mock('@/app/components/LanguageSelector', () => ({ default: () => React.createElement('span', null, 'English') }))

import FeatureShell, { FeatureHeading } from '@/app/components/FeatureShell'
import HistoryClient from '@/app/history/history-client'
import ProgressClient from '@/app/progress/progress-client'
import VocabularyPage from '@/app/vocabulary/page'
import { featureCopy } from '@/app/lib/featureCopy'

let container
let root
beforeEach(() => {
  globalThis.React = React
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  state.nativeCode = 'en'
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(Component, props) {
  await act(async () => { root.render(React.createElement(Component, props)); })
}
function respond(data) { return { ok: true, json: async () => data } }

describe('editorial feature pages', () => {
  it.each(['en', 'zh', 'ja'])('uses styled line breaks instead of punctuation in %s feature headings', async (lang) => {
    const copy = featureCopy[lang]
    for (const value of Object.values(copy)) {
      if (typeof value === 'string') expect(value).not.toMatch(/[，。！？、,.!?;:：；…「」“”]/)
    }
    expect(copy.practiceEmptyTitle.split('\n')).toHaveLength(2)
    for (const key of ['practiceTitle', 'historyTitle', 'vocabularyTitle', 'progressTitle']) {
      expect(copy[key].split('\n')).toHaveLength(2)
      expect(copy[key]).not.toMatch(/[，。！？、,.!?;:：；]/)
    }
    await render(FeatureHeading, { title: copy.practiceTitle, description: copy.practiceDescription })
    const heading = container.querySelector('h1')
    expect(heading.textContent).toBe(copy.practiceTitle)
    expect(heading.querySelectorAll(':scope > span')).toHaveLength(2)
    expect(heading.querySelector('.feature-heading-emphasis').textContent).toBe(copy.practiceTitle.split('\n')[1])
  })

  it.each([['en', 'History'], ['zh-CN', '对话历史'], ['ja', '会話履歴']])('shows icon navigation and current-page semantics for %s', async (code, label) => {
    state.nativeCode = code
    await render(FeatureShell, { active: 'history' })
    const active = container.querySelector('[aria-current="page"]')
    expect(active.textContent).toBe(label)
    expect(active.getAttribute('href')).toBe('/history')
    expect(active.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(container.querySelectorAll('nav a')).toHaveLength(5)
    await act(async () => container.querySelector('.feature-theme-toggle').click())
    expect(state.toggleTheme).toHaveBeenCalled()
  })

  it('keeps source filters and continuation URLs while using English history copy', async () => {
    const fetchMock = vi.fn(async () => respond({ data: [{ id: 'conversation-1', title: 'At the café', sourceType: 'scenario', userTurnCount: 4, updatedAt: '2026-01-10T12:00:00Z' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await render(HistoryClient)
    expect(container.querySelector('h1').textContent).toBe(featureCopy.en.historyTitle)
    expect(container.querySelector('a[href="/talk?conversation=conversation-1"]').textContent).toContain('Continue conversation')
    const news = [...container.querySelectorAll('.feature-filters button')].find(button => button.textContent === 'News')
    await act(async () => news.click())
    expect(news.getAttribute('aria-pressed')).toBe('true')
    expect(fetchMock.mock.calls.at(-1)[0]).toContain('sourceType=news')
  })

  it.each([[0, '0 turns'], [1, '1 turn'], [2, '2 turns']])('formats %s English history turns', async (count, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ data: [{ id: 'one', title: 'A conversation', userTurnCount: count }] })))
    await render(HistoryClient)
    expect(container.querySelector('.feature-history-meta').textContent).toContain(expected)
    expect(container.querySelector('.feature-history-meta').textContent).not.toContain('1 turns')
  })

  it.each([['en', 'Start practicing'], ['ja', '練習を始める']])('localizes history empty states in %s', async (lang, action) => {
    state.nativeCode = lang
    vi.stubGlobal('fetch', vi.fn(async () => respond({ data: [] })))
    await render(HistoryClient)
    expect(container.querySelector('.feature-empty').textContent).toContain(action)
  })

  it.each(['en', 'zh', 'ja'])('localizes progress data and labels in %s', async (lang) => {
    state.nativeCode = lang
    vi.stubGlobal('fetch', vi.fn(async (url) => respond({ data: url.includes('/items') ? [] : { totalConversations: 3, lastActiveDate: '2026-01-10', recent7Days: [{ date: '2026-01-10', userTurns: 8 }] } })))
    await render(ProgressClient)
    expect(container.querySelector('h1').textContent).toBe(featureCopy[lang].progressTitle)
    expect(container.textContent).toContain(featureCopy[lang].savedWords)
    expect(container.querySelector('[role="list"]').getAttribute('aria-label')).toBe(featureCopy[lang].recentLabel)
  })

  it.each([['en', 'Start practicing'], ['zh-CN', '开始练习'], ['ja', '練習を始める']])('uses localized functional copy and a neutral empty-vocabulary action in %s', async (lang, label) => {
    state.nativeCode = lang
    vi.stubGlobal('fetch', vi.fn(async () => respond({ data: [] })))
    await render(VocabularyPage)
    const action = container.querySelector('.feature-empty a')
    const copy = featureCopy[lang === 'zh-CN' ? 'zh' : lang]
    expect(container.querySelector('h1').textContent).toBe(copy.vocabularyTitle)
    expect(container.querySelector('.feature-description').textContent).toBe(copy.vocabularyDescription)
    expect(action.textContent).toContain(label)
    expect(action.getAttribute('href')).toBe('/talk')
    expect(action.className).toContain('feature-action')
    expect(action.className).not.toMatch(/red|destructive/)
    expect(container.querySelector('.feature-filters')).toBeNull()
  })

  it('distinguishes an empty vocabulary filter from having no saved items', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond({ data: [{ id: 'vocab-1', items: [{ text: 'resilient', type: 'word' }] }] })))
    await render(VocabularyPage)
    const grammar = [...container.querySelectorAll('.feature-filters button')].find(button => button.textContent.startsWith('Grammar'))
    await act(async () => grammar.click())
    expect(container.querySelector('.feature-empty h2').textContent).toBe('No items in this category')
    expect(container.querySelector('.feature-empty').textContent).not.toContain('No saved items yet')
  })

  it('consolidates the weekly summary into one chart while keeping all-time metrics', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => respond({ data: url.includes('/items') ? [] : {
      totalConversations: 3, totalUserTurns: 29, activeDays: 2, currentStreak: 2,
      recent7Days: [{ date: '2026-01-09', userTurns: 8 }, { date: '2026-01-10', userTurns: 13 }],
    } })))
    await render(ProgressClient)
    expect(container.querySelectorAll('.feature-progress-summary > [data-slot="card"]')).toHaveLength(2)
    expect(container.querySelectorAll('[role="list"]')).toHaveLength(1)
    expect(container.querySelector('.feature-chart-total strong').textContent).toContain('21')
    expect([...container.querySelectorAll('.feature-progress-metrics dd')].map(el => Number.parseInt(el.textContent, 10)))
      .toEqual([3, 29, 2, 2])
    expect(container.querySelectorAll('.feature-progress-links a')).toHaveLength(2)
  })
})
