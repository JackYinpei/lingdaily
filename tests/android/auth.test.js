import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { deleteData, userEmail, deleteUser } = vi.hoisted(() => ({
  deleteData: vi.fn(), userEmail: vi.fn(), deleteUser: vi.fn(),
}))
vi.mock('@/app/lib/server/iosSync', () => ({ deleteAccountData: deleteData }))
vi.mock('@/app/lib/server/supabaseAuthUser', () => ({ authUserEmail: userEmail, deleteAuthUser: deleteUser }))

import { POST as DELETE_ACCOUNT } from '@/app/api/android/account/delete/route'
import { POST as SIGN_IN } from '@/app/api/android/auth/password/route'
import { POST as REGISTER } from '@/app/api/android/auth/register/route'
import { authorizeIOSRequest, issueIOSSession } from '@/app/lib/server/iosAuth'

const userA = '11111111-2222-4333-8444-555555555555'
const userB = '99999999-2222-4333-8444-555555555555'
const password = 'synthetic-password'
const json = (path, payload, bearer) => new Request(`https://lingdaily.test${path}`, {
  method: 'POST', body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
})
const call = async (handler, path, payload, bearer) => {
  const response = await handler(json(path, payload, bearer))
  return { status: response.status, data: await response.json() }
}
const signIn = payload => call(SIGN_IN, '/api/android/auth/password', payload)
const register = payload => call(REGISTER, '/api/android/auth/register', payload)
// Stand-in for Supabase Auth: one reply per request, recorded for inspection.
let supabase
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-for-android-session-tests')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon-key')
  delete globalThis[Symbol.for('lingdaily.androidAuthLimiter.v1')]
  supabase = vi.fn(async () => reply(200, { access_token: 'supabase-token', user: { id: userA, email: 'Learner@Example.com' } }))
  vi.stubGlobal('fetch', supabase)
  deleteData.mockReset().mockResolvedValue(undefined)
  userEmail.mockReset().mockResolvedValue('learner@example.com')
  deleteUser.mockReset().mockResolvedValue(true)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Android password sign-in', () => {
  it('checks the password with Supabase and issues a session the native routes accept', async () => {
    const { status, data } = await signIn({ email: ' Learner@Example.com ', password })
    expect(status).toBe(200)
    expect(data.account).toEqual({ id: userA, email: 'learner@example.com', isPrivateEmail: false })
    expect(Date.parse(data.expiresAt)).toBeGreaterThan(Date.now() + 59 * 86_400_000)
    const [url, options] = supabase.mock.calls[0]
    expect(url).toBe('https://auth.test/auth/v1/token?grant_type=password')
    expect(JSON.parse(options.body)).toEqual({ email: 'learner@example.com', password })
    expect(options.headers.apikey).toBe('synthetic-anon-key')
    await expect(authorizeIOSRequest(json('/api/ios/practice', {}, data.sessionToken))).resolves.toEqual({ userId: userA })
    // Supabase's own tokens stay on the server.
    expect(JSON.stringify(data)).not.toContain('supabase-token')
  })
  it('rejects a wrong password, an unconfirmed address and malformed requests without a session', async () => {
    supabase.mockResolvedValueOnce(reply(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }))
    const wrong = await signIn({ email: 'learner@example.com', password: 'nope' })
    expect(wrong).toMatchObject({ status: 401, data: { code: 'INVALID_CREDENTIALS' } })
    expect(wrong.data.sessionToken).toBeUndefined()
    supabase.mockResolvedValueOnce(reply(400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' }))
    expect(await signIn({ email: 'learner@example.com', password })).toMatchObject({ status: 403, data: { code: 'EMAIL_NOT_CONFIRMED' } })
    for (const payload of [{ email: 'not-an-email', password }, { email: 'learner@example.com' }, { email: 'learner@example.com', password, extra: 1 }]) {
      expect((await signIn(payload)).status).toBe(400)
    }
    expect(supabase).toHaveBeenCalledTimes(2)
  })
  it('reports an unreachable or failing auth service as unavailable, never as a wrong password', async () => {
    supabase.mockRejectedValueOnce(new Error('network down'))
    expect(await signIn({ email: 'learner@example.com', password })).toMatchObject({ status: 503, data: { code: 'ACCOUNT_UNAVAILABLE' } })
    supabase.mockResolvedValueOnce(reply(502, {}))
    expect((await signIn({ email: 'learner@example.com', password })).status).toBe(503)
    supabase.mockResolvedValueOnce(reply(200, { access_token: 'x' }))
    expect((await signIn({ email: 'learner@example.com', password })).status).toBe(503)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    expect(await signIn({ email: 'learner@example.com', password })).toMatchObject({ status: 503, data: { code: 'NOT_CONFIGURED' } })
  })
  it('limits attempts per address without blocking other learners', async () => {
    supabase.mockImplementation(async () => reply(400, { error_code: 'invalid_credentials' }))
    for (let i = 0; i < 5; i++) expect((await signIn({ email: 'a@example.com', password: `guess-${i}` })).status).toBe(401)
    expect((await signIn({ email: 'A@example.com', password: 'guess-6' })).status).toBe(429)
    expect(supabase).toHaveBeenCalledTimes(5)
    expect((await signIn({ email: 'b@example.com', password: 'guess' })).status).toBe(401)
  })
})

describe('Android registration', () => {
  it('signs a new account in at once when Supabase returns a session', async () => {
    const { status, data } = await register({ email: 'New@Example.com', password })
    expect(status).toBe(200)
    expect(supabase.mock.calls[0][0]).toBe('https://auth.test/auth/v1/signup')
    expect(data.account).toEqual({ id: userA, email: 'learner@example.com', isPrivateEmail: false })
    await expect(authorizeIOSRequest(json('/api/ios/practice', {}, data.sessionToken))).resolves.toEqual({ userId: userA })
  })
  it('asks for email confirmation when Supabase returns only the pending user', async () => {
    supabase.mockResolvedValueOnce(reply(200, { id: userA, email: 'new@example.com', confirmation_sent_at: '2026-11-20T00:00:00Z' }))
    expect(await register({ email: 'new@example.com', password })).toEqual({ status: 200, data: { confirmationRequired: true } })
  })
  it('explains a taken address, a weak password and a short password', async () => {
    supabase.mockResolvedValueOnce(reply(422, { error_code: 'user_already_exists', msg: 'User already registered' }))
    expect(await register({ email: 'new@example.com', password })).toMatchObject({ status: 409, data: { code: 'EMAIL_TAKEN' } })
    supabase.mockResolvedValueOnce(reply(422, { error_code: 'weak_password', msg: 'Password should be at least 8 characters' }))
    expect(await register({ email: 'new@example.com', password })).toMatchObject({ status: 400, data: { code: 'WEAK_PASSWORD' } })
    expect((await register({ email: 'new@example.com', password: '12345' })).status).toBe(400)
    expect(supabase).toHaveBeenCalledTimes(2)
  })
})

describe('Android account deletion', () => {
  const path = '/api/android/account/delete'
  const bearer = async userId => (await issueIOSSession(userId)).sessionToken
  it('deletes the data and the auth user after the password is confirmed again', async () => {
    const { status, data } = await call(DELETE_ACCOUNT, path, { password }, await bearer(userA))
    expect({ status, data }).toEqual({ status: 200, data: { deleted: true } })
    expect(userEmail).toHaveBeenCalledWith(userA)
    expect(JSON.parse(supabase.mock.calls[0][1].body)).toEqual({ email: 'learner@example.com', password })
    expect(deleteData).toHaveBeenCalledWith(userA)
    expect(deleteUser).toHaveBeenCalledWith(userA)
  })
  it('keeps the account for a wrong password, another account or a missing session', async () => {
    supabase.mockResolvedValueOnce(reply(400, { error_code: 'invalid_credentials' }))
    // 403, not 401: the app signs out on 401.
    expect(await call(DELETE_ACCOUNT, path, { password: 'nope' }, await bearer(userA))).toMatchObject({ status: 403, data: { code: 'WRONG_PASSWORD' } })
    supabase.mockResolvedValueOnce(reply(200, { access_token: 'x', user: { id: userB, email: 'learner@example.com' } }))
    expect(await call(DELETE_ACCOUNT, path, { password }, await bearer(userA))).toMatchObject({ status: 403, data: { code: 'ACCOUNT_MISMATCH' } })
    expect((await call(DELETE_ACCOUNT, path, { password })).status).toBe(401)
    expect((await call(DELETE_ACCOUNT, path, {}, await bearer(userA))).status).toBe(400)
    expect(deleteData).not.toHaveBeenCalled()
    expect(deleteUser).not.toHaveBeenCalled()
  })
  it('reports an account that could not be removed after its data', async () => {
    deleteUser.mockResolvedValueOnce(false)
    expect(await call(DELETE_ACCOUNT, path, { password }, await bearer(userA))).toMatchObject({ status: 502, data: { code: 'DELETE_INCOMPLETE' } })
    expect(deleteData).toHaveBeenCalledWith(userA)
  })
})
