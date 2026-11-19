import { describe, expect, it, vi } from 'vitest'

import {
  cancelLiveConnectionAttempt,
  fetchRealtimeTokenAfterPriming,
} from '@/app/talk/_lib/liveConnection'

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

describe('cancelLiveConnectionAttempt', () => {
  it('invalidates the attempt, aborts the token request and disconnects the service', () => {
    const controller = new AbortController()
    const attemptRef = { current: 3 }
    const abortControllerRef = { current: controller }
    const service = { disconnect: vi.fn() }

    cancelLiveConnectionAttempt({ attemptRef, abortControllerRef, service })

    expect(attemptRef.current).toBe(0)
    expect(controller.signal.aborted).toBe(true)
    expect(abortControllerRef.current).toBeNull()
    expect(service.disconnect).toHaveBeenCalledTimes(1)
  })

  it('tolerates a missing controller and service', () => {
    const attemptRef = { current: 0 }
    const abortControllerRef = { current: null }

    expect(() => cancelLiveConnectionAttempt({ attemptRef, abortControllerRef, service: null })).not.toThrow()
    expect(abortControllerRef.current).toBeNull()
  })
})
