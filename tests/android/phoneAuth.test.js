import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { POST as PHONE_SIGN_IN } from '@/app/api/android/auth/phone/route'
import { POST as PHONE_REGISTER } from '@/app/api/android/auth/phone/register/route'
import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { normalizePhone, phoneAccountEmail, phoneFromAccountEmail } from '@/app/lib/phoneAccount'

const userA = '11111111-2222-4333-8444-555555555555'
const password = 'synthetic-password'
const phoneEmail = '8613800138000@phone.lingdaily.yasobi.xyz'
const json = (path, payload, bearer) => new Request(`https://lingdaily.test${path}`, {
  method: 'POST', body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
})
const call = async (handler, path, payload) => {
  const response = await handler(json(path, payload))
  return { status: response.status, data: await response.json() }
}
const signIn = payload => call(PHONE_SIGN_IN, '/api/android/auth/phone', payload)
const register = payload => call(PHONE_REGISTER, '/api/android/auth/phone/register', payload)
let supabase
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret-for-android-session-tests')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-anon-key')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key')
  delete globalThis[Symbol.for('lingdaily.androidAuthLimiter.v1')]
  supabase = vi.fn(async () => reply(200, { access_token: 'supabase-token', user: { id: userA, email: phoneEmail } }))
  vi.stubGlobal('fetch', supabase)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('phone numbers', () => {
  it('normalizes mainland mobile numbers and international numbers to E.164', () => {
    for (const input of ['13800138000', ' 138 0013 8000 ', '138-0013-8000', '8613800138000', '+86 13800138000', '008613800138000']) {
      expect(normalizePhone(input)).toBe('+8613800138000')
    }
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100')
    for (const input of ['', '12345', '23800138000', '1380013800', '+8612800138000', '+86123', 'abc', '+0123456789', null]) {
      expect(normalizePhone(input)).toBeNull()
    }
  })
  it('maps a number to its account address and back, leaving real addresses alone', () => {
    expect(phoneAccountEmail('+8613800138000')).toBe(phoneEmail)
    expect(phoneFromAccountEmail(phoneEmail)).toBe('+8613800138000')
    expect(phoneFromAccountEmail('13800138000@example.com')).toBeNull()
    expect(phoneFromAccountEmail('learner@phone.lingdaily.yasobi.xyz')).toBeNull()
  })
})

describe('Android phone registration', () => {
  it('creates a confirmed account through the Admin API without SMS and signs it in', async () => {
    supabase.mockResolvedValueOnce(reply(200, { id: userA, email: phoneEmail }))
    const { status, data } = await register({ phone: '138 0013 8000', password })
    expect(status).toBe(200)
    expect(data.account).toEqual({ id: userA, email: phoneEmail, phone: '+8613800138000', isPrivateEmail: false })
    const [url, options] = supabase.mock.calls[0]
    expect(url).toBe('https://auth.test/auth/v1/admin/users')
    expect(options.headers.apikey).toBe('synthetic-service-key')
    expect(JSON.parse(options.body)).toEqual({
      email: phoneEmail, password, email_confirm: true,
      user_metadata: { phone: '+8613800138000', signup_method: 'phone', signup_client: 'android' },
    })
    await expect(authorizeIOSRequest(json('/api/ios/practice', {}, data.sessionToken))).resolves.toEqual({ userId: userA })
  })
  it('explains a taken number and a weak password, and rejects bad input without calling Supabase', async () => {
    supabase.mockResolvedValueOnce(reply(422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' }))
    expect(await register({ phone: '13800138000', password })).toMatchObject({ status: 409, data: { code: 'PHONE_TAKEN' } })
    supabase.mockResolvedValueOnce(reply(422, { error_code: 'weak_password', msg: 'Password should be at least 8 characters' }))
    expect(await register({ phone: '13800138000', password })).toMatchObject({ status: 400, data: { code: 'WEAK_PASSWORD' } })
    for (const payload of [{ phone: '12345', password }, { phone: '13800138000', password: '12345' }, { phone: '13800138000', password, email: 'x@y.z' }]) {
      expect((await register(payload)).status).toBe(400)
    }
    expect(supabase).toHaveBeenCalledTimes(2)
  })
  it('needs the service role key', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    expect(await register({ phone: '13800138000', password })).toMatchObject({ status: 503, data: { code: 'NOT_CONFIGURED' } })
    expect(supabase).not.toHaveBeenCalled()
  })
})

describe('Android phone sign-in', () => {
  it('checks the password of the number\'s account and issues a session', async () => {
    const { status, data } = await signIn({ phone: '+86 138 0013 8000', password })
    expect(status).toBe(200)
    expect(data.account).toEqual({ id: userA, email: phoneEmail, phone: '+8613800138000', isPrivateEmail: false })
    const [url, options] = supabase.mock.calls[0]
    expect(url).toBe('https://auth.test/auth/v1/token?grant_type=password')
    expect(options.headers.apikey).toBe('synthetic-anon-key')
    expect(JSON.parse(options.body)).toEqual({ email: phoneEmail, password })
    expect(JSON.stringify(data)).not.toContain('supabase-token')
  })
  it('rejects a wrong password with a phone-specific message and limits guesses per number', async () => {
    supabase.mockImplementation(async () => reply(400, { error_code: 'invalid_credentials' }))
    const wrong = await signIn({ phone: '13800138000', password: 'nope' })
    expect(wrong).toMatchObject({ status: 401, data: { code: 'INVALID_CREDENTIALS', message: '手机号或密码不正确。' } })
    for (let i = 0; i < 4; i++) await signIn({ phone: '13800138000', password: `guess-${i}` })
    expect((await signIn({ phone: '+8613800138000', password: 'again' })).status).toBe(429)
    expect((await signIn({ phone: '13900139000', password: 'guess' })).status).toBe(401)
  })
})
