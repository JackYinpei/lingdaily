import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  SELECTED_NEWS_STORAGE_KEY,
  TALK_MODE_STORAGE_KEY,
  clearSelectedNewsFromStorage,
  loadSelectedNewsFromStorage,
  loadTalkModeFromStorage,
  saveSelectedNewsToStorage,
  saveTalkModeToStorage,
} from '@/app/talk/_lib/storage'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function failingStorage() {
  const fail = () => { throw new Error('quota exceeded') }
  return { getItem: fail, setItem: fail, removeItem: fail }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('talk page storage', () => {
  it('keeps the existing storage keys', () => {
    expect(SELECTED_NEWS_STORAGE_KEY).toBe('selectedNews')
    expect(TALK_MODE_STORAGE_KEY).toBe('talk-mode')
  })

  it('round-trips selected news as JSON and clears it', () => {
    const storage = memoryStorage()
    const news = { id: 'a1', title: 'Headline', translatedTitle: '标题' }

    saveSelectedNewsToStorage(news, storage)
    expect(storage.getItem('selectedNews')).toBe(JSON.stringify(news))
    expect(loadSelectedNewsFromStorage(storage)).toEqual(news)

    clearSelectedNewsFromStorage(storage)
    expect(loadSelectedNewsFromStorage(storage)).toBeNull()
  })

  it('stores the raw mode and only loads known modes', () => {
    const storage = memoryStorage()

    saveTalkModeToStorage('scenario', storage)
    expect(storage.getItem('talk-mode')).toBe('scenario')
    expect(loadTalkModeFromStorage(storage)).toBe('scenario')

    storage.setItem('talk-mode', 'unknown')
    expect(loadTalkModeFromStorage(storage)).toBeNull()
  })

  it('logs storage failures instead of throwing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = failingStorage()

    expect(() => saveSelectedNewsToStorage({ id: 'a1' }, storage)).not.toThrow()
    expect(loadSelectedNewsFromStorage(storage)).toBeNull()
    expect(() => clearSelectedNewsFromStorage(storage)).not.toThrow()
    expect(() => saveTalkModeToStorage('news', storage)).not.toThrow()
    expect(loadTalkModeFromStorage(storage)).toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(5)
  })

  it('logs instead of throwing when reading localStorage itself is blocked', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Access denied', 'SecurityError') },
    })

    try {
      expect(() => saveSelectedNewsToStorage({ id: 'a1' })).not.toThrow()
      expect(loadSelectedNewsFromStorage()).toBeNull()
      expect(() => clearSelectedNewsFromStorage()).not.toThrow()
      expect(() => saveTalkModeToStorage('news')).not.toThrow()
      expect(loadTalkModeFromStorage()).toBeNull()
      expect(errorSpy).toHaveBeenCalledTimes(5)
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete globalThis.localStorage
    }
  })

  it('returns null for malformed selected news JSON', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const storage = memoryStorage()
    storage.setItem('selectedNews', '{not json')
    expect(loadSelectedNewsFromStorage(storage)).toBeNull()
  })
})
