import 'server-only'

import { importPKCS8, SignJWT } from 'jose'
import { appleClientId } from './iosAuth'

const APPLE = 'https://appleid.apple.com'

export function appleRevocationConfigured(env = process.env) {
  return Boolean(env.APPLE_TEAM_ID?.trim() && env.APPLE_SIGNIN_KEY_ID?.trim() && env.APPLE_SIGNIN_PRIVATE_KEY?.trim())
}

async function clientSecret(env) {
  const key = await importPKCS8(env.APPLE_SIGNIN_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.APPLE_SIGNIN_KEY_ID.trim() })
    .setIssuer(env.APPLE_TEAM_ID.trim()).setSubject(appleClientId(env)).setAudience(APPLE)
    .setIssuedAt().setExpirationTime('5m')
    .sign(key)
}

async function post(path, fields) {
  return fetch(`${APPLE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields), signal: AbortSignal.timeout(10000),
  })
}

/**
 * Revokes the app's Sign in with Apple grant during account deletion
 * (App Store Review Guideline 5.1.1(v)). Uses the fresh authorization code
 * from the confirmation sign-in. Returns 'revoked', 'skipped' or 'failed';
 * never throws, so a provider outage cannot block deleting the account data.
 */
export async function revokeAppleAuthorization(authorizationCode, env = process.env) {
  if (!authorizationCode || !appleRevocationConfigured(env)) return 'skipped'
  try {
    const secret = await clientSecret(env)
    const base = { client_id: appleClientId(env), client_secret: secret }
    const tokenRes = await post('/auth/token', { ...base, code: authorizationCode, grant_type: 'authorization_code' })
    if (!tokenRes.ok) return 'failed'
    const tokens = await tokenRes.json()
    const token = tokens.refresh_token || tokens.access_token
    if (!token) return 'failed'
    const revokeRes = await post('/auth/revoke', {
      ...base, token, token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
    })
    return revokeRes.ok ? 'revoked' : 'failed'
  } catch {
    return 'failed'
  }
}
