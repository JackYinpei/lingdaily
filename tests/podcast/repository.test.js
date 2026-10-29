import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
let repository
beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('SUPABASE_URL', 'https://database.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://database.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'mock-key')
  vi.stubGlobal('fetch', vi.fn())
  repository = await import('@/app/lib/podcast/repository')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('podcast lease renewal', () => {
  it.each(['timeout', 'disconnect'])('does not demote committed completion after a response %s', async (failure) => {
    vi.useFakeTimers()
    vi.stubEnv('PODCAST_LEASE_TIMEOUT_MS', '20')
    let status = 'script_generated'
    fetch.mockImplementation(async (url, options) => {
      const fields = JSON.parse(options.body)
      const activeOnly = new URL(url).searchParams.get('status') === 'in.(in_progress,script_generated)'
      if (activeOnly && !['in_progress', 'script_generated'].includes(status)) return Response.json([])
      status = fields.status
      if (status === 'completed') return {
        ok: true,
        text: () => failure === 'timeout' ? new Promise(() => {}) : Promise.reject(new Error('response disconnected')),
      }
      return Response.json([{ date_folder: '2026-10-29', status }])
    })
    const completion = expect(repository.updatePodcastEpisode('2026-10-29', 'lease-id', { status: 'completed' })).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(20)
    await completion
    await expect(repository.updatePodcastEpisode('2026-10-29', 'lease-id', { status: 'failed' })).rejects.toMatchObject({ code: 'PODCAST_LEASE_LOST' })
    expect(status).toBe('completed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('still records failure while the generation is active', async () => {
    fetch.mockResolvedValue(Response.json([{ date_folder: '2026-10-29', status: 'failed' }]))
    await expect(repository.updatePodcastEpisode('2026-10-29', 'lease-id', { status: 'failed' })).resolves.toMatchObject({ status: 'failed' })
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('status')).toBe('in.(in_progress,script_generated)')
  })
  it('PATCHes only updated_at with generation and active-status fencing', async () => {
    fetch.mockResolvedValue(Response.json([{ date_folder: '2026-10-29', status: 'script_generated' }]))
    await repository.renewPodcastGeneration('2026-10-29', 'lease-id')
    const [url, options] = fetch.mock.calls[0]
    const params = new URL(url).searchParams
    expect(params.get('generation_id')).toBe('eq.lease-id')
    expect(params.get('category')).toBe('eq.daily')
    expect(params.get('date_folder')).toBe('eq.2026-10-29')
    expect(params.get('status')).toBe('in.(in_progress,script_generated)')
    expect(options.method).toBe('PATCH')
    expect(options.headers.Prefer).toBe('return=representation')
    expect(JSON.parse(options.body)).toEqual({ updated_at: expect.any(String) })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects a fenced-out renewal', async () => {
    fetch.mockResolvedValue(Response.json([]))
    await expect(repository.renewPodcastGeneration('2026-10-29', 'stale-id')).rejects.toMatchObject({ code: 'PODCAST_LEASE_LOST' })
  })

  it.each(['fetch', 'body'])('bounds a stalled %s and aborts the HTTP request', async (stage) => {
    vi.useFakeTimers()
    vi.stubEnv('PODCAST_LEASE_TIMEOUT_MS', '20')
    let signal
    fetch.mockImplementation((_url, options) => {
      signal = options.signal
      return stage === 'fetch' ? new Promise(() => {}) : Promise.resolve({ ok: true, text: () => new Promise(() => {}) })
    })
    const result = expect(repository.renewPodcastGeneration('2026-10-29', 'lease-id')).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(20)
    await result
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects HTTP failure and missing generation ID', async () => {
    fetch.mockResolvedValue(Response.json({ message: 'unavailable' }, { status: 503 }))
    await expect(repository.renewPodcastGeneration('2026-10-29', 'lease-id')).rejects.toThrow('unavailable')
    await expect(repository.renewPodcastGeneration('2026-10-29', null)).rejects.toThrow(/lease is required/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
