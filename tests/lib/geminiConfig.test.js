import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { constructed } = vi.hoisted(() => ({ constructed: [] }))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { constructor(options) { constructed.push(options) } } }))

import { createServerGeminiClient, GEMINI_REQUEST_TIMEOUT_MS } from '@/app/lib/server/geminiConfig'

const relay = 'https://relay.example.test'
const build = options => {
  constructed.length = 0
  return createServerGeminiClient(options) && constructed[0]
}

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'synthetic-key'); vi.stubEnv('GOOGLE_API_KEY', '')
  vi.stubEnv('GEMINI_BASE_URL', relay); vi.stubEnv('GOOGLE_GEMINI_BASE_URL', ''); vi.stubEnv('NEXT_PUBLIC_GEMINI_BASE_URL', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('createServerGeminiClient', () => {
  it('returns null without an API key', () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    expect(createServerGeminiClient()).toBeNull()
  })

  it('follows the configured relay by default', () => {
    expect(build()).toEqual({ apiKey: 'synthetic-key', httpOptions: { baseUrl: relay } })
    vi.stubEnv('GEMINI_BASE_URL', '')
    expect(build()).toEqual({ apiKey: 'synthetic-key' })
  })

  it('builds the web realtime token client through the relay on v1alpha', () => {
    expect(build({ apiVersion: 'v1alpha' }))
      .toEqual({ apiKey: 'synthetic-key', httpOptions: { baseUrl: relay, apiVersion: 'v1alpha' } })
  })

  it('builds the iOS Live token client on the official endpoint', () => {
    expect(build({ baseUrl: 'official', apiVersion: 'v1alpha', timeout: GEMINI_REQUEST_TIMEOUT_MS }))
      .toEqual({ apiKey: 'synthetic-key', httpOptions: { apiVersion: 'v1alpha', timeout: 25000 } })
  })

  it('builds the iOS practice client with an explicit base URL override', () => {
    expect(build({ baseUrl: 'https://practice.example.test', timeout: GEMINI_REQUEST_TIMEOUT_MS }))
      .toEqual({ apiKey: 'synthetic-key', httpOptions: { baseUrl: 'https://practice.example.test', timeout: 25000 } })
  })
})
