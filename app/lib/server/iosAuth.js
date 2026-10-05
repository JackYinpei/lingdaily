import 'server-only'

import { createHash, hkdfSync } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose'
import { authorizeDevelopmentPractice, PracticeAPIError } from './iosPractice'

const APPLE_ISSUER = 'https://appleid.apple.com'
const SESSION_ISSUER = 'lingdaily'
const SESSION_AUDIENCE = 'lingdaily-ios'
const SESSION_DAYS = 60
let appleKeys

export const appleClientId = (env = process.env) => env.APPLE_IOS_BUNDLE_ID?.trim() || 'com.qcy.LingDaily'
export const sha256Hex = value => createHash('sha256').update(value).digest('hex')

// Separate key from NextAuth's own use of AUTH_SECRET; a web cookie can never verify as an iOS session.
function sessionKey(env) {
  const secret = env.AUTH_SECRET?.trim()
  if (!secret) throw new PracticeAPIError(503, 'NOT_CONFIGURED', '服务端尚未配置登录。')
  return new Uint8Array(hkdfSync('sha256', secret, 'lingdaily', 'ios-session-v1', 32))
}

/**
 * Verifies a native Sign in with Apple identity token. The app hashes a random
 * nonce into the Apple request and sends the raw value here, so a captured
 * token cannot be replayed without it.
 */
export async function verifyAppleIdentityToken(identityToken, rawNonce,
  { keys = (appleKeys ||= createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`))), env = process.env } = {}) {
  let payload
  try {
    ({ payload } = await jwtVerify(identityToken, keys, {
      issuer: APPLE_ISSUER, audience: appleClientId(env), algorithms: ['RS256'],
    }))
  } catch {
    throw new PracticeAPIError(401, 'APPLE_INVALID', 'Apple 登录未通过验证，请重试。')
  }
  if (typeof payload.nonce !== 'string' || payload.nonce !== sha256Hex(rawNonce)) {
    throw new PracticeAPIError(401, 'APPLE_INVALID', 'Apple 登录未通过验证，请重试。')
  }
  const verified = payload.email_verified === true || payload.email_verified === 'true'
  if (typeof payload.email !== 'string' || !payload.email || !verified) {
    throw new PracticeAPIError(400, 'EMAIL_REQUIRED', '需要允许 Apple 提供邮箱（可以选择隐藏邮箱）。')
  }
  return {
    appleUserId: payload.sub, email: payload.email.toLowerCase(),
    isPrivateEmail: payload.is_private_email === true || payload.is_private_email === 'true',
  }
}

export async function issueIOSSession(userId, { env = process.env, now = Date.now() } = {}) {
  const issuedAt = Math.floor(now / 1000)
  const expiresAt = issuedAt + SESSION_DAYS * 86400
  const sessionToken = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId).setIssuer(SESSION_ISSUER).setAudience(SESSION_AUDIENCE)
    .setIssuedAt(issuedAt).setExpirationTime(expiresAt)
    .sign(sessionKey(env))
  return { sessionToken, expiresAt: new Date(expiresAt * 1000).toISOString() }
}

const isPairingToken = value => /^[a-f0-9]{64}$/.test(value)

/**
 * Every /api/ios/* AI route calls this first. Production accepts only an iOS
 * session issued after Sign in with Apple. The local pairing token from
 * `npm run ios:dev` is additionally accepted only in an explicitly enabled
 * development server. Returns the identity used to isolate caches and limits.
 */
export async function authorizeIOSRequest(request, env = process.env) {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /, '') || ''
  if (env.NODE_ENV === 'development' && env.IOS_PRACTICE_DEV_ENABLED === '1' && isPairingToken(bearer)) {
    authorizeDevelopmentPractice(request, env)
    return { userId: 'local-development' }
  }
  const key = sessionKey(env)
  try {
    const { payload } = await jwtVerify(bearer, key, {
      issuer: SESSION_ISSUER, audience: SESSION_AUDIENCE, algorithms: ['HS256'],
    })
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Missing subject')
    return { userId: payload.sub }
  } catch {
    throw new PracticeAPIError(401, 'SIGNED_OUT', '登录已失效，请在「我的」重新用 Apple 登录。')
  }
}
