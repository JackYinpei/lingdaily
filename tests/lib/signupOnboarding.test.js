// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SignUpClient from '@/app/sign-up/sign-up-client'
import SignInClient from '@/app/sign-in/sign-in-client'
import OnboardingGuide from '@/app/components/OnboardingGuide'

const { signIn, push } = vi.hoisted(() => ({ signIn: vi.fn(), push: vi.fn() }))
vi.mock('next-auth/react', () => ({ signIn }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('next/link', () => ({ default: ({ children, ...props }) => React.createElement('a', props, children) }))

let root
let container

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  localStorage.clear()
  window.history.replaceState({}, '', '/sign-in')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function render(component) {
  await act(async () => root.render(component))
}

async function click(text) {
  const button = [...document.querySelectorAll('button')].find((el) => el.textContent.includes(text))
  expect(button).toBeTruthy()
  await act(async () => button.click())
}

async function register() {
  await render(React.createElement(SignUpClient, { linuxDoEnabled: true }))
  await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}

describe('signup practice destination', () => {
  it('keeps email-confirmation sign-in but continues to practice after registration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }))
    await register()
    await act(async () => vi.advanceTimersByTime(800))
    expect(push).toHaveBeenCalledWith('/sign-in?callbackUrl=%2Ftalk')
  })

  it.each([
    { ok: false, body: { error: 'Registration rejected' }, message: 'Registration rejected' },
    { ok: false, body: {}, message: 'Registration failed' },
  ])('does not navigate on registration failure: $message', async ({ ok, body, message }) => {
    push.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }))
    await register()
    await act(async () => vi.advanceTimersByTime(800))
    expect(push).not.toHaveBeenCalled()
    expect(container.textContent).toContain(message)
  })

  it('sends signup-page OAuth to practice', async () => {
    await render(React.createElement(SignUpClient, { linuxDoEnabled: true }))
    await click('Continue with Linux.do')
    expect(signIn).toHaveBeenCalledWith('linux-do', { redirectTo: '/talk' })
  })

  it.each(['', '?callbackUrl=%2Ftalk', '?callbackUrl=https://evil.example', '?callbackUrl=%2F%2Fevil.example'])('defaults shared OAuth signup/signin to practice safely (%s)', async (query) => {
    window.history.replaceState({}, '', `/sign-in${query}`)
    await render(React.createElement(SignInClient, { googleEnabled: true, linuxDoEnabled: true }))
    await click('Continue with Google')
    expect(signIn).toHaveBeenLastCalledWith('google', { redirectTo: '/talk' })
    await click('Continue with Linux.do')
    expect(signIn).toHaveBeenLastCalledWith('linux-do', { redirectTo: '/talk' })
  })

  it('preserves explicit existing destinations', async () => {
    window.history.replaceState({}, '', '/sign-in?callbackUrl=%2Fhistory')
    await render(React.createElement(SignInClient, { googleEnabled: true }))
    await click('Continue with Google')
    expect(signIn).toHaveBeenLastCalledWith('google', { redirectTo: '/history' })
  })
})

describe('onboarding news skip', () => {
  async function showGuide(props = {}) {
    const target = document.createElement('div')
    target.dataset.tour = 'mode-toggle'
    target.getBoundingClientRect = () => ({ top: 10, left: 10, width: 100, height: 30 })
    document.body.appendChild(target)
    await render(React.createElement(OnboardingGuide, props))
    await act(async () => vi.advanceTimersByTime(800))
    await act(async () => vi.advanceTimersByTime(16))
  }

  it('selects news, dismisses the entire tour and remembers completion', async () => {
    const onSkipToNews = vi.fn()
    await showGuide({ onSkipToNews })
    await click('跳过（使用新闻模式）')
    expect(onSkipToNews).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain('下一步')
    expect(localStorage.getItem('onboarding-completed')).toBe('1')
  })

  it('dismisses without an optional mode callback', async () => {
    await showGuide()
    await click('跳过（使用新闻模式）')
    expect(localStorage.getItem('onboarding-completed')).toBe('1')
  })

  it('still dismisses when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const onSkipToNews = vi.fn()
    await showGuide({ onSkipToNews })
    await click('跳过（使用新闻模式）')
    expect(onSkipToNews).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain('下一步')
  })
})
