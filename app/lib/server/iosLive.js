import 'server-only'
import { GoogleGenAI } from '@google/genai'
import { getServerGeminiApiKey } from './geminiConfig'
import { PracticeAPIError, createUserLimiter } from './iosPractice'
import { buildLiveInstruction, LIVE_TOOLS } from '../ios/live'
import { DEFAULT_LIVE_WS_URL, liveWebSocketEndpoint } from '../ios/liveEndpoint.mjs'

export const IOS_LIVE_WS_URL = DEFAULT_LIVE_WS_URL
export const liveModel = () => process.env.GEMINI_LIVE_MODEL?.trim() || 'gemini-3.1-flash-live-preview'

export async function issueLiveToken(body) {
  let wsURL
  try {
    wsURL = liveWebSocketEndpoint(process.env.GEMINI_LIVE_WS_BASE_URL || '')
  } catch {
    throw new PracticeAPIError(503, 'NOT_CONFIGURED', '语音中转地址配置无效。')
  }
  const apiKey = getServerGeminiApiKey()
  if (!apiKey) throw new PracticeAPIError(503, 'NOT_CONFIGURED', '服务端尚未配置语音通话。')
  const model = liveModel()
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new PracticeAPIError(503, 'NOT_CONFIGURED', '语音模型配置无效。')
  const now = Date.now()
  const expiresAt = new Date(now + 30 * 60_000).toISOString()
  // Installed SDK is v1alpha-only for constrained tokens. Use the official
  // signing endpoint. The approved relay forwards the constrained WebSocket;
  // it never receives the API key or replaces the locked token configuration.
  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha', timeout: 25000 } })
  try {
    const result = await client.authTokens.create({ config: {
      uses: 1, expireTime: expiresAt, newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(),
      httpOptions: { apiVersion: 'v1alpha' }, abortSignal: AbortSignal.timeout(25000),
      liveConnectConstraints: { model, config: {
        responseModalities: ['AUDIO'], systemInstruction: buildLiveInstruction(body), tools: LIVE_TOOLS,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
        inputAudioTranscription: {}, outputAudioTranscription: {},
        realtimeInputConfig: { automaticActivityDetection: { disabled: false } },
      } },
      // Omitted lockAdditionalFields locks the entire config (SDK Case 2),
      // including unspecified fields. Never fall back to an unconstrained token.
    } })
    if (!result.name || typeof result.name !== 'string') throw new Error('Missing token')
    return { token: result.name, model, wsURL, expiresAt }
  } catch (error) {
    if (error.status === 429) throw new PracticeAPIError(429, 'MODEL_BUSY', '语音服务暂时繁忙，请稍后重试。')
    throw new PracticeAPIError(502, 'LIVE_UNAVAILABLE', '暂时无法连接语音服务，请重试或使用文字模式。')
  }
}

// No token caching/coalescing: uses:1 means each deliberate reconnect needs a
// fresh credential. Same bounded per-user concurrency policy as practice.
export function createLiveTokenCoordinator({ generate = issueLiveToken, now = Date.now } = {}) {
  const acquire = createUserLimiter({ now, maxPerMinute: 6 })
  return async (body, userId) => {
    const release = acquire(userId)
    try { return await generate(body) } finally { release() }
  }
}
const stateKey = Symbol.for('lingdaily.iosLiveToken.v2')
export function performLiveTokenRequest(body, userId) {
  const slot = globalThis[stateKey] ||= {}
  slot.generate = issueLiveToken
  slot.perform ||= createLiveTokenCoordinator({ generate: input => slot.generate(input) })
  return slot.perform(body, userId)
}
