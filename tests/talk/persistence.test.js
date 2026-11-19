// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ props: null, service: null, config: null }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'account' } }, status: 'authenticated' }) }))
vi.mock('@/app/contexts/LanguageContext', () => ({ useLanguage: () => ({ learningLanguage: { code: 'en', label: 'English' }, nativeLanguage: { code: 'en', label: 'English' }, loading: false }) }))
vi.mock('@/app/components/NewsFeed', () => ({ default: () => null }))
vi.mock('@/app/components/ScenarioFeed', () => ({ default: () => null }))
vi.mock('@/app/components/ModeToggle', () => ({ ModeToggle: () => null }))
vi.mock('@/app/components/OnboardingGuide', () => ({ default: () => null }))
vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/app/components/History', () => ({ History: props => { state.props = props; return null } }))
vi.mock('@/app/lib/GeminiLiveService', () => ({
  GeminiLiveServiceImpl: class {
    constructor(config) {
      state.service = this
      state.config = config
      this.primeOutputAudio = vi.fn()
      this.disconnect = vi.fn()
      this.connect = vi.fn(async () => { config.onConnectionUpdate(true); return true })
      this.sendContextMessage = vi.fn(async () => {})
      this.sendText = vi.fn(async text => { config.onMessage(text, true, 'user'); return true })
    }
  },
}))

import Talk from '@/app/talk/page'

const user = { itemId: 'u', type: 'message', role: 'user', content: [{ type: 'input_text', text: 'I goes' }], metadata: { isFinal: true } }
const correction = { original: 'I goes', corrected: 'I go', explanation: 'Use the base form.', category: 'grammar' }
const savedCard = { itemId: 'c', type: 'correction', role: 'assistant', correction, metadata: { isFinal: true } }
let root, container, posts, responseHistory, fetchMock

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  window.history.replaceState(null, '', '/talk?conversation=saved')
  localStorage.clear()
  state.props = null
  state.config = null
  posts = []
  responseHistory = [user]
  fetchMock = vi.fn(async (url, options) => {
    if (url === '/api/realtime-token') return Response.json({ token: 'token' })
    if (options?.method === 'POST') {
      const payload = JSON.parse(options.body)
      posts.push({ ...payload, keepalive: options.keepalive })
      return Response.json({ ok: true, data: { id: 'saved', revision: posts.length + 1, history: payload.history } })
    }
    return Response.json({ data: { id: 'saved', sourceType: 'news', newsContent: { title: 'Topic' }, newsKey: 'Topic', revision: 1, history: responseHistory } })
  })
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mountAndConnect(strict = false) {
  await act(async () => root.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Talk)) : React.createElement(Talk)))
  expect(state.props.isConnecting).toBe(false)
  await act(async () => state.props.connect())
  expect(state.config).not.toBeNull()
}

describe('talk persistence lifecycle', () => {
  it.each([0, 1])('silently accepts an already-saved navigation snapshot after %i conflict retries', async missingAttempts => {
    await mountAndConnect(true)
    const originalFetch = fetchMock.getMockImplementation()
    fetchMock.mockImplementation(async (url, options) => {
      const response = await originalFetch(url, options)
      if (options?.method !== 'POST') return response
      const payload = posts.at(-1)
      return Response.json({ error: 'This conversation was updated in another session', current: {
        id: 'saved', revision: posts.length + 1,
        history: posts.length <= missingAttempts ? [user] : payload.history,
      } }, { status: 409 })
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => state.config.onMessage('Final reply', true, 'model'))
    await act(async () => vi.advanceTimersByTimeAsync(400))
    expect(posts).toHaveLength(0)
    await act(async () => root.unmount())
    expect(posts).toHaveLength(missingAttempts + 1)
    expect(posts.every(post => post.keepalive)).toBe(true)
    expect(error).not.toHaveBeenCalled()
    responseHistory = posts.at(-1).history
    root = createRoot(container)
    await mountAndConnect(true)
    expect(state.props.history.at(-1).content[0].text).toBe('Final reply')
  })

  it.each(['Second message', 'First message'])('keeps two accepted text sends unique through StrictMode save, unload merge and resume (%s)', async secondText => {
    responseHistory = []
    await mountAndConnect(true)
    await act(async () => { expect(await state.props.sendTextMessage('First message')).toBe(true) })
    await act(async () => state.config.onMessage('First reply', true, 'model'))
    await act(async () => vi.advanceTimersByTimeAsync(800))
    await act(async () => { expect(await state.props.sendTextMessage(secondText)).toBe(true) })
    const visibleUsers = state.props.history.filter(item => item.role === 'user')
    expect(visibleUsers.map(item => item.content[0].text)).toEqual(['First message', secondText])
    expect(new Set(visibleUsers.map(item => item.itemId)).size).toBe(2)
    await act(async () => window.dispatchEvent(new Event('pagehide')))
    responseHistory = posts.at(-1).history
    await act(async () => root.unmount())
    root = createRoot(container)
    await mountAndConnect(true)
    expect(state.props.history.filter(item => item.role === 'user')).toEqual(visibleUsers)
  })

  it.each(['success', 'conflict', 'network failure'])('supersedes queued saves and late ordinary %s after an immediate keepalive flush', async result => {
    await mountAndConnect(true)
    const originalFetch = fetchMock.getMockImplementation()
    let finishOrdinary, failOrdinary, ordinaryResponse
    let keepaliveAttempts = 0
    fetchMock.mockImplementation(async (url, options) => {
      const response = await originalFetch(url, options)
      if (options?.method !== 'POST') return response
      if (!options.keepalive && !finishOrdinary) {
        ordinaryResponse = response
        return new Promise((resolve, reject) => { finishOrdinary = resolve; failOrdinary = reject })
      }
      if (options.keepalive && ++keepaliveAttempts === 1) {
        return Response.json({ current: { id: 'saved', revision: 2, history: posts[0].history } }, { status: 409 })
      }
      return response
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => state.config.onMessage('First reply', true, 'model'))
    await act(async () => vi.advanceTimersByTimeAsync(800))
    expect(posts).toHaveLength(1)
    await act(async () => state.props.sendTextMessage('Next user message'))
    await act(async () => vi.advanceTimersByTimeAsync(800))
    expect(posts).toHaveLength(1)
    await act(async () => {
      state.config.onMessage('Final reply', true, 'model')
      state.config.onCorrection(correction)
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(posts.map(post => post.keepalive)).toEqual([false, true, true])
    expect(posts[2].revision).toBe(2)
    expect(posts[2].history.some(item => item.type === 'correction')).toBe(true)
    await act(async () => {
      if (result === 'success') finishOrdinary(ordinaryResponse)
      else if (result === 'conflict') finishOrdinary(Response.json({ error: 'This conversation was updated in another session', current: { id: 'saved', revision: 4, history: posts[2].history } }, { status: 409 }))
      else failOrdinary(new Error('network failure'))
    })
    expect(posts).toHaveLength(3)
    expect(error).not.toHaveBeenCalled()
    expect(state.props.history.filter(item => item.role === 'user')).toHaveLength(2)
    await act(async () => state.props.sendTextMessage('After returning to the page'))
    await act(async () => vi.advanceTimersByTimeAsync(800))
    expect(posts).toHaveLength(4)
    expect(posts[3].history.at(-1).content[0].text).toBe('After returning to the page')
  })

  it('debounces partial assistant transcripts even without turnComplete', async () => {
    await mountAndConnect()
    await act(async () => state.config.onMessage('A partial', false, 'model'))
    await act(async () => vi.advanceTimersByTimeAsync(700))
    expect(posts).toHaveLength(0)
    await act(async () => state.config.onMessage(' reply', false, 'model'))
    await act(async () => vi.advanceTimersByTimeAsync(799))
    expect(posts).toHaveLength(0)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(posts).toHaveLength(1)
    expect(posts[0].history.at(-1)).toMatchObject({ role: 'assistant', content: [{ text: 'A partial reply' }], metadata: { isFinal: false } })
  })

  it('flushes the latest streamed reply synchronously on pagehide, before the debounce fires', async () => {
    await mountAndConnect()
    await act(async () => state.config.onMessage('Last reply', false, 'model'))
    expect(posts).toHaveLength(0)
    await act(async () => window.dispatchEvent(new Event('pagehide')))
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ keepalive: true, mergeOnServer: true })
    expect(posts[0].history.map(item => item.role)).toEqual(['user', 'assistant'])
    expect(posts[0].history.at(-1).content[0].text).toBe('Last reply')
  })

  it('schedules saves for corrections and finalizes the preceding assistant through interleaved cards', async () => {
    await mountAndConnect()
    await act(async () => state.config.onMessage('The reply', false, 'model'))
    await act(async () => state.config.onCorrection(correction))
    await act(async () => state.config.onMessage('', true, 'model'))
    await act(async () => vi.advanceTimersByTimeAsync(800))
    expect(posts).toHaveLength(1)
    const history = posts[0].history.filter(item => item.role !== 'system')
    expect(history.map(item => item.type)).toEqual(['message', 'message', 'correction'])
    expect(history[1]).toMatchObject({ content: [{ text: 'The reply' }], metadata: { isFinal: true } })
    expect(history[2].correction).toEqual(correction)
  })

  it('saves a correction that arrives after a completed save, rejecting invalid tool payloads', async () => {
    await mountAndConnect()
    await act(async () => state.config.onCorrection({ original: '', corrected: 'bad' }))
    await act(async () => vi.advanceTimersByTimeAsync(800))
    expect(posts).toHaveLength(0)
    await act(async () => state.config.onCorrection(correction))
    await act(async () => vi.advanceTimersByTimeAsync(800))
    expect(posts).toHaveLength(1)
    expect(posts[0].history.at(-1).correction).toEqual(correction)
  })

  it('restores persisted cards as CorrectionCards while keeping them out of Live replay', async () => {
    responseHistory = [user, savedCard]
    await mountAndConnect()
    expect(state.props.history.find(item => item.type === 'correction')).toMatchObject(savedCard)
    const prompt = state.service.sendContextMessage.mock.calls[0][0]
    expect(prompt).toContain('User: I goes')
    expect(prompt).not.toContain('Use the base form.')
    expect(prompt).not.toContain('Assistant: I go')
  })
})
