// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeStart from '@/app/components/home/HomeStart'
import FeatureStage from '@/app/components/home/FeatureStage'
import { HOME_COPY } from '@/app/components/home/copy'
import {
  LEARNING_LANGUAGE_OPTIONS,
  NATIVE_LANGUAGE_OPTIONS,
} from '@/app/lib/languages'

const mocks = vi.hoisted(() => ({ push: vi.fn(), preferences: {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/app/contexts/LanguageContext', () => ({
  useLanguage: () => mocks.preferences,
}))

let root
let container
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  mocks.preferences = {
    loading: false,
    nativeLanguage: { code: 'zh-CN' },
    learningLanguage: { code: 'es' },
    nativeOptions: NATIVE_LANGUAGE_OPTIONS,
    learningOptions: LEARNING_LANGUAGE_OPTIONS,
    setNativeLanguage: vi.fn(),
    setLearningLanguage: vi.fn(),
    commitPreferences: vi.fn().mockResolvedValue(),
  }
  mocks.push.mockClear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

describe('Homepage language entry', () => {
  it('saves choices before sending a visitor through the practice login callback', async () => {
    let complete
    mocks.preferences.commitPreferences.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    await act(async () =>
      root.render(
        React.createElement(HomeStart, { t: HOME_COPY.en, signedIn: false }),
      ),
    )
    expect(container.querySelector('#home-learning-language').value).toBe('es')
    expect(
      [...container.querySelector('#home-learning-language').options].map(
        (o) => o.value,
      ),
    ).not.toContain('zh-CN')
    expect(
      [...container.querySelector('#home-native-language').options].map(
        (o) => o.value,
      ),
    ).not.toContain('es')
    await act(async () =>
      container
        .querySelector('form')
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    )
    expect(container.querySelector('button').disabled).toBe(true)
    expect(mocks.push).not.toHaveBeenCalled()
    await act(async () => complete())
    expect(mocks.preferences.commitPreferences).toHaveBeenCalledOnce()
    expect(mocks.push).toHaveBeenCalledWith('/sign-in?callbackUrl=%2Ftalk')
  })

  it('does not strand an existing learner when server preference sync is unavailable', async () => {
    mocks.preferences.commitPreferences.mockRejectedValue(new Error('offline'))
    await act(async () =>
      root.render(
        React.createElement(HomeStart, { t: HOME_COPY.zh, signedIn: true }),
      ),
    )
    await act(async () =>
      container
        .querySelector('form')
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    )
    expect(mocks.push).toHaveBeenCalledWith('/talk')
  })

  it('does not navigate with preferences still loading', async () => {
    mocks.preferences.loading = true
    await act(async () =>
      root.render(
        React.createElement(HomeStart, { t: HOME_COPY.en, signedIn: false }),
      ),
    )
    expect(container.querySelector('button').disabled).toBe(true)
    await act(async () =>
      container
        .querySelector('form')
        .dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
    )
    expect(mocks.preferences.commitPreferences).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})

describe('Feature stage', () => {
  const render = (locale, signedIn = false) =>
    act(async () =>
      root.render(
        React.createElement(FeatureStage, {
          t: HOME_COPY[locale].stage,
          signedIn,
        }),
      ),
    )
  const scene = () =>
    container.querySelector('.home-stage').getAttribute('data-scene')
  const shownPanels = () =>
    [...container.querySelectorAll('[role="tabpanel"]')].filter(
      (panel) => !panel.hasAttribute('inert'),
    )

  it.each(['en', 'zh', 'ja'])(
    'supports keyboard feature selection and explicit sample labeling in %s',
    async (locale) => {
      const t = HOME_COPY[locale].stage
      await render(locale)
      const tabs = container.querySelectorAll('[role="tab"]')
      expect(tabs).toHaveLength(t.features.length)
      expect(container.textContent).toContain(t.note)
      expect(shownPanels()).toHaveLength(1)
      expect(shownPanels()[0].textContent).toContain(
        t.features[0].sample.correction,
      )
      await act(async () =>
        tabs[0].dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        ),
      )
      expect(document.activeElement).toBe(tabs[1])
      expect(tabs[1].getAttribute('aria-selected')).toBe('true')
      expect(tabs[0].tabIndex).toBe(-1)
      expect(shownPanels()).toHaveLength(1)
      expect(shownPanels()[0].getAttribute('aria-labelledby')).toBe(tabs[1].id)
      expect(shownPanels()[0].textContent).toContain(
        t.features[1].sample.episode,
      )
      expect(scene()).toBe('1')
      await act(async () =>
        tabs[1].dispatchEvent(
          new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
        ),
      )
      expect(document.activeElement).toBe(tabs[2])
      await act(async () =>
        tabs[2].dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        ),
      )
      expect(document.activeElement).toBe(tabs[0])
    },
  )

  it('keeps the settled slogans as two styled lines without punctuation', async () => {
    await render('zh')
    const slogans = [...container.querySelectorAll('[role="tabpanel"] h2')].map(
      (heading) => [...heading.children].map((line) => line.textContent),
    )
    expect(slogans).toEqual([
      ['练的就是', '会发生的事'],
      ['耳朵先迎接', '新一天'],
      ['别让好表达', '聊完就忘'],
    ])
  })

  it('sends signed-out visitors through sign-in for private features only', async () => {
    await render('en')
    const links = () =>
      [...container.querySelectorAll('[role="tabpanel"] a')].map((a) =>
        a.getAttribute('href'),
      )
    expect(links()).toEqual([
      '/sign-in?callbackUrl=%2Ftalk',
      '/podcasts',
      '/sign-in?callbackUrl=%2Fvocabulary',
    ])
    await render('en', true)
    expect(links()).toEqual(['/talk', '/podcasts', '/vocabulary'])
  })

  it('turns to the next feature on its own until the visitor picks one', async () => {
    vi.useFakeTimers()
    try {
      await render('en')
      expect(scene()).toBe('0')
      await act(async () => vi.advanceTimersByTime(7000))
      expect(scene()).toBe('1')
      await act(async () =>
        container.querySelectorAll('[role="tab"]')[0].click(),
      )
      expect(scene()).toBe('0')
      await act(async () => vi.advanceTimersByTime(30000))
      expect(scene()).toBe('0')
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells the art which way each figure is moving so shoes stay on the floor', async () => {
    await render('zh')
    const learner = () =>
      container
        .querySelector('.home-art-learner .ill-move[data-shift]')
        ?.getAttribute('data-shift')
    const tabs = container.querySelectorAll('[role="tab"]')
    expect(learner()).toBeUndefined()
    await act(async () => tabs[1].click())
    expect(learner()).toBe('up')
    await act(async () => tabs[0].click())
    expect(learner()).toBe('down')
  })

  it('does not turn on its own for visitors who ask for reduced motion', async () => {
    vi.useFakeTimers()
    window.matchMedia = vi.fn(() => ({ matches: true }))
    try {
      await render('en')
      await act(async () => vi.advanceTimersByTime(30000))
      expect(scene()).toBe('0')
    } finally {
      delete window.matchMedia
      vi.useRealTimers()
    }
  })
})
