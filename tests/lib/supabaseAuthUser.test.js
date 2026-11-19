import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureAuthUser } from '@/app/lib/server/supabaseAuthUser'

const uuid = '00000000-0000-4000-8000-000000000001'
const response = (status, body = {}) => new Response(JSON.stringify(body), { status })
const listed = () => response(200, { users: [{ id: uuid, email: 'Learner@Example.com' }] })

describe('ensureAuthUser', () => {
  let fetchMock
  let errorLog
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the created user id', async () => {
    fetchMock.mockResolvedValueOnce(response(200, { id: uuid }))
    await expect(ensureAuthUser({ email: 'learner@example.com' })).resolves.toBe(uuid)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(errorLog).not.toHaveBeenCalled()
  })

  it('looks up an existing user on 422 without logging an error', async () => {
    fetchMock.mockResolvedValueOnce(response(422, { msg: 'already registered' })).mockResolvedValueOnce(listed())
    await expect(ensureAuthUser({ email: 'learner@example.com' })).resolves.toBe(uuid)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(errorLog).not.toHaveBeenCalled()
  })

  it.each([401, 429, 500])('logs only the status of a %i create failure and still tries the lookup', async status => {
    fetchMock.mockResolvedValueOnce(response(status, { msg: 'learner@example.com' })).mockResolvedValueOnce(listed())
    await expect(ensureAuthUser({ email: 'learner@example.com' })).resolves.toBe(uuid)
    expect(errorLog).toHaveBeenCalledWith('[auth] Supabase admin create user failed', { status })
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('learner@example.com')
  })

  it('returns null when the create fails and the lookup fails too', async () => {
    fetchMock.mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(503))
    await expect(ensureAuthUser({ email: 'learner@example.com' })).resolves.toBeNull()
    expect(errorLog).toHaveBeenCalledWith('[auth] Supabase admin create user failed', { status: 503 })
  })
})
