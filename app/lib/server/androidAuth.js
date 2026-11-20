import 'server-only'

import { z } from 'zod'
import { createUserLimiter, PracticeAPIError } from './iosPractice'
import { getSupabasePublicAuthConfig } from './supabaseRest'

// The Android app has no native Sign in with Apple. It signs in with the same
// Supabase email and password as the web app and then receives the same native
// app session as iOS (`issueIOSSession`), so every /api/ios/* route serves both.

const AUTH_TIMEOUT_MS = 15_000
const email = z.string().trim().toLowerCase().email().max(254)

export const passwordSignInSchema = z.object({ email, password: z.string().min(1).max(256) }).strict()
// bcrypt, which Supabase Auth uses, reads at most 72 bytes of a password.
export const passwordRegisterSchema = z.object({ email, password: z.string().min(6).max(72) }).strict()
export const passwordConfirmSchema = z.object({ password: z.string().min(1).max(256) }).strict()

const stateKey = Symbol.for('lingdaily.androidAuthLimiter.v1')
/** Slows password guessing against one address; Supabase applies its own limits as well. */
export const acquireAuthAttempt = key =>
  (globalThis[stateKey] ||= createUserLimiter({ maxConcurrent: 2, maxPerMinute: 5 }))(key)

const unavailable = () => new PracticeAPIError(503, 'ACCOUNT_UNAVAILABLE', '暂时无法连接账号服务，请稍后重试。')

async function supabaseAuth(path, body) {
  const auth = getSupabasePublicAuthConfig()
  if (!auth) throw new PracticeAPIError(503, 'NOT_CONFIGURED', '服务端尚未配置登录。')
  try {
    const response = await fetch(`${auth.baseUrl}/auth/v1/${path}`, {
      method: 'POST', headers: auth.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    })
    const data = await response.json().catch(() => ({}))
    // Only these fields are inspected; upstream text is never returned to the app.
    const reason = [data?.error_code, data?.error, data?.error_description, data?.msg].filter(Boolean).join(' ')
    return { response, data, reason }
  } catch {
    throw unavailable()
  }
}

/** Checks an email and password with Supabase Auth and returns that account's `{ id, email }`. */
export async function verifyPassword(address, password) {
  const { response, data, reason } = await supabaseAuth('token?grant_type=password', { email: address, password })
  if (response.ok) {
    const user = data?.user
    if (typeof user?.id !== 'string' || !user.id || typeof user.email !== 'string') throw unavailable()
    return { id: user.id, email: user.email.toLowerCase() }
  }
  if (/not[ _]confirmed/i.test(reason)) {
    throw new PracticeAPIError(403, 'EMAIL_NOT_CONFIRMED', '邮箱还没有验证。请先点开注册邮件里的链接，再登录。')
  }
  if (response.status === 429) throw new PracticeAPIError(429, 'RATE_LIMIT', '尝试次数太多，请稍后再试。')
  if (response.status >= 500) throw unavailable()
  throw new PracticeAPIError(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确。')
}

/**
 * Creates an email/password account. Returns `{ id, email }` when Supabase signs the
 * new account in at once, or null when the address has to be confirmed by email first.
 */
export async function registerWithPassword(address, password) {
  const { response, data, reason } = await supabaseAuth('signup', { email: address, password })
  if (!response.ok) {
    if (response.status === 429 || /rate.?limit/i.test(reason)) {
      throw new PracticeAPIError(429, 'RATE_LIMIT', '注册请求太频繁，请稍后再试。')
    }
    if (/already|exists/i.test(reason)) throw new PracticeAPIError(409, 'EMAIL_TAKEN', '这个邮箱已经注册，请直接登录。')
    if (/weak|password/i.test(reason)) throw new PracticeAPIError(400, 'WEAK_PASSWORD', '密码太短或太简单，请换一个。')
    if (response.status >= 500) throw unavailable()
    throw new PracticeAPIError(400, 'REGISTER_FAILED', '注册没有成功，请检查邮箱后重试。')
  }
  const user = data?.user || data
  if (!data?.access_token || typeof user?.id !== 'string' || !user.id) return null
  return { id: user.id, email: typeof user.email === 'string' ? user.email.toLowerCase() : address }
}
