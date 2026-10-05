import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { MODEL_CHOICES, MODEL_FEATURES, modelCatalog, resolveModel } from '@/app/lib/ios/models'

describe('app model choices', () => {
  it('accepts only listed models and otherwise keeps the server default', () => {
    expect(resolveModel('suggest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite')).toBe('gemini-3.5-flash-lite')
    expect(resolveModel('suggest', 'gemini-ultra', 'gemini-3.1-flash-lite')).toBe('gemini-3.1-flash-lite')
    expect(resolveModel('suggest', undefined, 'gemini-3.1-flash-lite')).toBe('gemini-3.1-flash-lite')
    expect(resolveModel('practice', 'gemini-3.8-live', 'gemini-3.1-flash-lite')).toBe('gemini-3.1-flash-lite')
    expect(resolveModel('live', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-live-preview')).toBe('gemini-3.1-flash-live-preview')
    // A server default outside the list (set by env) is still allowed.
    expect(resolveModel('suggest', 'custom-env-model', 'custom-env-model')).toBe('custom-env-model')
  })
  it('lists every feature with its default first available', () => {
    const catalog = modelCatalog({ practice: 'gemini-3.1-flash-lite', suggest: 'custom-env-model', translate: 'gemini-3.1-flash-lite', live: 'gemini-3.1-flash-live-preview' })
    expect(Object.keys(catalog)).toEqual([...MODEL_FEATURES])
    expect(catalog.suggest.choices[0]).toEqual({ id: 'custom-env-model', note: '服务端默认' })
    expect(catalog.practice.choices).toEqual(MODEL_CHOICES.practice)
    expect(catalog.live.default).toBe('gemini-3.1-flash-live-preview')
  })
})
