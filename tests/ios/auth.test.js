import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

vi.mock('server-only', () => ({}))
const { generate, ensureAuthUser, apple } = vi.hoisted(() => ({
  generate: vi.fn(), ensureAuthUser: vi.fn(), apple: { keys: null },
}))
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: generate } } }))
vi.mock('@/app/lib/server/geminiConfig', () => ({
  getServerGeminiApiKey: () => 'fake-provider-secret', getServerGeminiBaseUrl: () => '',
}))
vi.mock('@/app/lib/server/supabaseAuthUser', () => ({ ensureAuthUser }))
// Route code fetches Apple's JWKS; tests resolve the same lookup against a synthetic key.
vi.mock('jose', async original => ({
  ...await original(), createRemoteJWKSet: () => (...args) => apple.keys(...args),
}))

import { POST as SIGN_IN } from '@/app/api/ios/auth/apple/route'
import { POST as PRACTICE } from '@/app/api/ios/practice/route'
import { authorizeIOSRequest, issueIOSSession, sha256Hex, verifyAppleIdentityToken } from '@/app/lib/server/iosAuth'
import { createPracticeCoordinator } from '@/app/lib/server/iosPractice'

const secret = 'synthetic-auth-secret-for-ios-session-tests'
const nonce = 'synthetic-nonce-0123456789abcdef'
let privateKey
const appleToken = async ({ audience = 'com.qcy.LingDaily', claims = {}, key, expires = '5m' } = {}) =>
  new SignJWT({ nonce: sha256Hex(nonce), email: 'learner@privaterelay.appleid.com', email_verified: 'true',
    is_private_email: 'true', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).setIssuer('https://appleid.apple.com')
    .setAudience(audience).setSubject('001234.synthetic.apple.user').setIssuedAt().setExpirationTime(expires)
    .sign(key || privateKey)
const json = (url, payload, bearer) => new Request(url, {
  method: 'POST', body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
})
const signIn = async payload => SIGN_IN(json('https://lingdaily.test/api/ios/auth/apple', payload))
const practiceBody = () => ({
  requestId: randomUUID(), sessionId: randomUUID(), action: 'start', stepIndex: 0, goal: '', context: '',
  scenario: { title: 'Deadline', partner: 'Alex', partnerRole: 'Colleague', setting: 'At work', goals: ['Explain', 'Propose', 'Confirm'] },
  messages: [],
})

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  apple.keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'synthetic', alg: 'RS256' }] })
})
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('AUTH_SECRET', secret)
  vi.stubEnv('APPLE_IOS_BUNDLE_ID', '')
  ensureAuthUser.mockReset().mockResolvedValue('11111111-2222-4333-8444-555555555555')
  generate.mockReset().mockResolvedValue({ candidates: [{ finishReason: 'STOP' }], modelVersion: 'test-model', text: JSON.stringify({
    reply: 'How is it going?', translation: '进展如何？', hint: '说明进展。', keywords: 'progress',
    suggestedReply: 'It is going well.', suggestedMeaning: '进展顺利。', feedback: null,
  }) })
})
afterEach(() => vi.unstubAllEnvs())

describe('Sign in with Apple verification', () => {
  it('accepts a token for this app with the matching nonce', async () => {
    const result = await verifyAppleIdentityToken(await appleToken(), nonce, { keys: apple.keys })
    expect(result).toEqual({ appleUserId: '001234.synthetic.apple.user', email: 'learner@privaterelay.appleid.com', isPrivateEmail: true })
  })
  it('rejects another app, a replayed nonce, an expired token, a foreign key and an unverified email', async () => {
    const other = await generateKeyPair('RS256')
    const cases = [
      [await appleToken({ audience: 'com.example.Other' }), nonce],
      [await appleToken(), 'another-nonce-0123456789abcdef'],
      [await appleToken({ expires: Math.floor(Date.now() / 1000) - 60 }), nonce],
      [await appleToken({ key: other.privateKey }), nonce],
      [await appleToken({ claims: { email_verified: 'false' } }), nonce],
      ['not-a-jwt', nonce],
    ]
    for (const [token, raw] of cases) {
      await expect(verifyAppleIdentityToken(token, raw, { keys: apple.keys })).rejects.toMatchObject({ name: 'PracticeAPIError' })
    }
  })
})

describe('iOS session boundary', () => {
  it('signs in, maps to the Supabase user and unlocks the AI routes in production', async () => {
    const response = await signIn({ identityToken: await appleToken(), nonce, fullName: 'Synthetic Learner' })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(ensureAuthUser).toHaveBeenCalledWith({ email: 'learner@privaterelay.appleid.com', name: 'Synthetic Learner', image: null })
    expect(result.account).toEqual({ id: '11111111-2222-4333-8444-555555555555', email: 'learner@privaterelay.appleid.com', isPrivateEmail: true })
    expect(JSON.stringify(result)).not.toContain('001234.synthetic.apple.user')
    const practice = await PRACTICE(json('https://lingdaily.test/api/ios/practice', practiceBody(), result.sessionToken))
    expect(practice.status).toBe(200)
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it('does not issue a session without a Supabase account or with an invalid Apple token', async () => {
    ensureAuthUser.mockResolvedValueOnce(null)
    expect((await signIn({ identityToken: await appleToken(), nonce })).status).toBe(503)
    expect((await signIn({ identityToken: await appleToken({ audience: 'com.example.Other' }), nonce })).status).toBe(401)
    expect((await signIn({ identityToken: await appleToken(), nonce, extra: true })).status).toBe(400)
  })
  it('rejects sessions signed with another secret, expired sessions and missing credentials', async () => {
    const { sessionToken } = await issueIOSSession('user-a', { env: { AUTH_SECRET: 'a-different-secret-value' } })
    const expired = await issueIOSSession('user-a', { env: { AUTH_SECRET: secret }, now: Date.now() - 61 * 86400_000 })
    for (const bearer of [sessionToken, expired.sessionToken, '', 'a'.repeat(64)]) {
      await expect(authorizeIOSRequest(json('https://lingdaily.test/x', {}, bearer))).rejects.toMatchObject({ status: 401 })
    }
    const valid = await issueIOSSession('user-a', { env: { AUTH_SECRET: secret } })
    await expect(authorizeIOSRequest(json('https://lingdaily.test/x', {}, valid.sessionToken))).resolves.toEqual({ userId: 'user-a' })
  })
  it('isolates cached replies and rate limits per user', async () => {
    const upstream = vi.fn(async body => ({ requestId: body.requestId, call: upstream.mock.calls.length }))
    const perform = createPracticeCoordinator({ generate: upstream, now: () => 0 })
    const body = practiceBody()
    const a = await perform(body, 'user-a')
    expect(await perform(body, 'user-a')).toBe(a)
    expect(await perform(body, 'user-b')).not.toBe(a)
    expect(upstream).toHaveBeenCalledTimes(2)
    for (let i = 0; i < 19; i++) await perform(practiceBody(), 'user-a')
    await expect(perform(practiceBody(), 'user-a')).rejects.toMatchObject({ status: 429 })
    await expect(perform(practiceBody(), 'user-c')).resolves.toBeTruthy()
  })
})
