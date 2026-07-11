import { describe, expect, it, vi } from 'vitest'

import { fetchRealtimeTokenAfterPriming } from '@/app/talk/_lib/liveConnection'

describe('fetchRealtimeTokenAfterPriming', () => {
  it('primes output audio synchronously before starting the token request', async () => {
    const calls = []
    const controller = new AbortController()
    const service = {
      primeOutputAudio: vi.fn(() => calls.push('prime')),
    }
    const fetchImpl = vi.fn((url, options) => {
      calls.push('fetch')
      expect(url).toBe('/api/realtime-token')
      expect(options).toMatchObject({ method: 'POST', signal: controller.signal })
      return Promise.resolve({
        ok: true,
        json: async () => ({ token: 'ephemeral-token' }),
      })
    })

    const tokenPromise = fetchRealtimeTokenAfterPriming({
      service,
      signal: controller.signal,
      fetchImpl,
    })

    expect(calls).toEqual(['prime', 'fetch'])
    await expect(tokenPromise).resolves.toBe('ephemeral-token')
  })

  it('surfaces the API error without attempting a real network request', async () => {
    const service = { primeOutputAudio: vi.fn() }
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    }))

    await expect(fetchRealtimeTokenAfterPriming({ service, fetchImpl }))
      .rejects.toThrow('Unauthorized')
    expect(service.primeOutputAudio).toHaveBeenCalledOnce()
  })
})
