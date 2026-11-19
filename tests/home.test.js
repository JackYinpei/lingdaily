// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomeStart from '@/app/components/home/HomeStart'
import ScenePreview from '@/app/components/home/ScenePreview'
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
      })
    )
    await act(async () =>
      root.render(
        React.createElement(HomeStart, { t: HOME_COPY.en, signedIn: false })
      )
    )
    expect(container.querySelector('#home-learning-language').value).toBe('es')
    expect(
      [...container.querySelector('#home-learning-language').options].map(
        (o) => o.value
      )
    ).not.toContain('zh-CN')
    expect(
      [...container.querySelector('#home-native-language').options].map(
        (o) => o.value
      )
    ).not.toContain('es')
    await act(async () =>
      container
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
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
        React.createElement(HomeStart, { t: HOME_COPY.zh, signedIn: true })
      )
    )
    await act(async () =>
      container
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(mocks.push).toHaveBeenCalledWith('/talk')
  })

  it('does not navigate with preferences still loading', async () => {
    mocks.preferences.loading = true
    await act(async () =>
      root.render(
        React.createElement(HomeStart, { t: HOME_COPY.en, signedIn: false })
      )
    )
    expect(container.querySelector('button').disabled).toBe(true)
    await act(async () =>
      container
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )
    expect(mocks.preferences.commitPreferences).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})

describe('Illustrative conversation', () => {
  it.each(['en', 'zh', 'ja'])(
    'supports keyboard scenario selection and explicit sample labeling in %s',
    async (locale) => {
      const t = HOME_COPY[locale].preview
      await act(async () =>
        root.render(React.createElement(ScenePreview, { t }))
      )
      const tabs = container.querySelectorAll('[role="tab"]')
      expect(container.textContent).toContain(t.note)
      expect(
        container.querySelector('[role="tabpanel"]').textContent
      ).toContain(t.scenes[0].correction)
      await act(async () =>
        tabs[0].dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
        )
      )
      expect(document.activeElement).toBe(tabs[1])
      expect(tabs[1].getAttribute('aria-selected')).toBe('true')
      expect(tabs[0].tabIndex).toBe(-1)
      expect(
        container
          .querySelector('[role="tabpanel"]')
          .getAttribute('aria-labelledby')
      ).toBe(tabs[1].id)
      expect(container.textContent).toContain(t.scenes[1].correction)
      expect(container.textContent).not.toContain(t.scenes[0].prompt)
      await act(async () =>
        tabs[1].dispatchEvent(
          new KeyboardEvent('keydown', { key: 'End', bubbles: true })
        )
      )
      expect(document.activeElement).toBe(tabs[2])
      await act(async () =>
        tabs[2].dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
        )
      )
      expect(document.activeElement).toBe(tabs[0])
    }
  )
})
