import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import { GoogleGenAI } from '@google/genai'
import { getServerGeminiApiKey, getServerGeminiBaseUrl } from './geminiConfig'
import {
  buildPracticeContext, parsePracticeTurn, parseScenarioDraft,
  RESPONSE_SCHEMA, SCENARIO_INSTRUCTION, SCENARIO_RESPONSE_SCHEMA, SYSTEM_INSTRUCTION,
} from '../ios/practice'

export class PracticeAPIError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'PracticeAPIError'
    this.status = status
    this.code = code
  }
}

export function isPracticeAPIError(error) {
  return error?.name === 'PracticeAPIError' && Number.isInteger(error.status)
    && error.status >= 400 && error.status <= 599 && typeof error.code === 'string'
}

// This pairing credential grants only development rehearsal calls. It cannot
// access a user account, private history, database or any existing API.
export function authorizeDevelopmentPractice(request, env = process.env) {
  if (env.NODE_ENV !== 'development' || env.IOS_PRACTICE_DEV_ENABLED !== '1') {
    throw new PracticeAPIError(404, 'NOT_AVAILABLE', '此服务尚未启用。')
  }
  const expected = env.IOS_PRACTICE_DEV_TOKEN || ''
  const received = request.headers.get('authorization')?.replace(/^Bearer /, '') || ''
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  if (expected.length < 32 || receivedBytes.length !== expectedBytes.length
      || !timingSafeEqual(expectedBytes, receivedBytes)) {
    throw new PracticeAPIError(401, 'UNPAIRED', '开发连接已失效，请重新构建 App。')
  }
}

export function practiceModel() { return process.env.GEMINI_PRACTICE_MODEL || 'gemini-3.1-flash-lite' }

function geminiClient() {
  const apiKey = getServerGeminiApiKey()
  if (!apiKey) throw new PracticeAPIError(503, 'NOT_CONFIGURED', '服务端尚未配置 AI。')
  const baseUrl = process.env.GEMINI_PRACTICE_BASE_URL?.trim() || getServerGeminiBaseUrl()
  return new GoogleGenAI({ apiKey, httpOptions: { ...(baseUrl ? { baseUrl } : {}), timeout: 25000 } })
}

// Structured generation with one corrective retry when the JSON fails validation.
async function generateStructured({ systemInstruction, responseSchema, payload, retryPayload, parse,
  temperature, maxOutputTokens, invalidMessage, unavailableMessage }) {
  const client = geminiClient()
  try {
    const abortSignal = AbortSignal.timeout(25000)
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await client.models.generateContent({
        model: practiceModel(),
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(attempt ? retryPayload : payload) }] }],
        config: {
          abortSignal, systemInstruction, responseMimeType: 'application/json', responseSchema,
          temperature: attempt ? 0.2 : temperature, maxOutputTokens,
          // Existing 2.5 Flash supports a zero thinking budget; other model
          // families may use different settings and should use their default.
          ...(practiceModel().startsWith('gemini-2.5-') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      })
      if (response.candidates?.[0]?.finishReason !== 'STOP') {
        throw new PracticeAPIError(502, 'INCOMPLETE_REPLY', 'AI 这次没有完成回答，请重试。')
      }
      let data
      try { data = parse(response.text || '') }
      catch {
        if (attempt === 0) continue
        throw new PracticeAPIError(502, 'INVALID_REPLY', invalidMessage)
      }
      return { model: response.modelVersion || practiceModel(), data }
    }
  } catch (error) {
    if (isPracticeAPIError(error)) throw error
    // Do not expose upstream URLs, raw exceptions, API keys or learner text.
    if (error.status === 429) throw new PracticeAPIError(429, 'MODEL_BUSY', 'AI 暂时繁忙，请稍后重试。')
    if (error.name === 'ZodError' || error.name === 'SyntaxError') {
      throw new PracticeAPIError(502, 'INVALID_REPLY', 'AI 回复格式不完整，请重试。')
    }
    throw new PracticeAPIError(502, 'MODEL_UNAVAILABLE', unavailableMessage)
  }
}

export async function generatePracticeTurn(body) {
  const context = buildPracticeContext(body)
  const { model, data } = await generateStructured({
    systemInstruction: SYSTEM_INSTRUCTION, responseSchema: RESPONSE_SCHEMA,
    payload: context,
    retryPayload: { ...context, formatReminder: 'The previous attempt was invalid. Rewrite ONLY learnerLatestAnswer in feedback.revised; do not put the role-play partner reply there. Follow every required field and length limit.' },
    parse: raw => parsePracticeTurn(raw, body.action, context.learnerLatestAnswer || ''),
    temperature: 0.65, maxOutputTokens: 1800,
    invalidMessage: 'AI 这次的表达建议不完整，请重试。',
    unavailableMessage: '暂时连不上 AI，请重试。你的回答已保留。',
  })
  return { requestId: body.requestId, model, data }
}

export async function generateScenarioDraft(body) {
  const payload = { learnerDescription: body.description }
  const { model, data } = await generateStructured({
    systemInstruction: SCENARIO_INSTRUCTION, responseSchema: SCENARIO_RESPONSE_SCHEMA,
    payload,
    retryPayload: { ...payload, formatReminder: 'The previous attempt was invalid. Return exactly 3 steps and respect every field length.' },
    parse: parseScenarioDraft,
    temperature: 0.8, maxOutputTokens: 2400,
    invalidMessage: 'AI 这次没能生成完整的场景，请重试。',
    unavailableMessage: '暂时连不上 AI，请重试。你的描述已保留。',
  })
  return { requestId: body.requestId, model, scenario: data }
}

// Per-user single-process budget. Cached practice replies do not acquire a
// slot; each single-use Live credential does acquire a fresh slot.
export function createUserLimiter({ now = Date.now, maxConcurrent = 2, maxPerMinute = 20 } = {}) {
  const users = new Map()
  return (userId = 'local-development') => {
    const time = now()
    for (const [id, item] of users) {
      if (!item.active && time - item.windowStart >= 60_000) users.delete(id)
    }
    const state = users.get(userId) || { active: 0, windowStart: time, calls: 0 }
    users.set(userId, state)
    if (time - state.windowStart >= 60_000) { state.windowStart = time; state.calls = 0 }
    if (state.active >= maxConcurrent || state.calls >= maxPerMinute) {
      throw new PracticeAPIError(429, 'RATE_LIMIT', '请求太频繁，请稍后再试。')
    }
    state.active++; state.calls++
    let released = false
    return () => { if (!released) { state.active--; released = true } }
  }
}

// Single process. Coalesce in-flight duplicates and cache only successful
// responses, keyed by user so one account never receives another's reply.
// A restart can cause a new provider call for the same ID.
export function createPracticeCoordinator({ generate = generatePracticeTurn, now = Date.now } = {}) {
  const entries = new Map()
  const acquire = createUserLimiter({ now })
  return async (body, userId = 'local-development') => {
    const time = now()
    for (const [id, item] of entries) {
      if (item.done && time - item.created > 10 * 60_000) entries.delete(id)
    }
    const key = `${userId}\u0000${body.requestId}`
    const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    const existing = entries.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new PracticeAPIError(409, 'REQUEST_CONFLICT', '请求内容已变化，请重新开始练习。')
      return existing.promise
    }
    const release = acquire(userId)
    while (entries.size >= 500) {
      const oldest = [...entries].find(([, item]) => item.done)
      if (!oldest) break
      entries.delete(oldest[0])
    }
    const entry = { fingerprint, created: time, done: false }
    entry.promise = Promise.resolve().then(() => generate(body)).then(result => {
      entry.done = true
      return result
    }).catch(error => {
      entries.delete(key)
      throw error
    }).finally(release)
    entries.set(key, entry)
    return entry.promise
  }
}

const stateKey = Symbol.for('lingdaily.iosPracticeCoordinator.v3')
function coordinated(name, generate) {
  // Keep cache and limits across Next HMR, but use the latest generation code.
  const state = globalThis[stateKey] ||= {}
  const slot = state[name] ||= {}
  slot.generate = generate
  slot.perform ||= createPracticeCoordinator({ generate: input => slot.generate(input) })
  return slot.perform
}
export const performPracticeRequest = (body, userId) => coordinated('practice', generatePracticeTurn)(body, userId)
export const performScenarioRequest = (body, userId) => coordinated('scenario', generateScenarioDraft)(body, userId)

// ---- HTTP helpers shared by the /api/ios/* routes ----

const MAX_BYTES = 48 * 1024

export function practiceJSON(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '15' } : {}) } })
}

export function practiceFailure(error) {
  if (isPracticeAPIError(error)) return practiceJSON({ code: error.code, message: error.message }, error.status)
  return practiceJSON({ code: 'UNEXPECTED', message: '服务暂时不可用，请稍后重试。' }, 500)
}

export async function readBoundedJSON(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new PracticeAPIError(415, 'JSON_REQUIRED', '请求格式不正确。')
  }
  if (Number(request.headers.get('content-length')) > MAX_BYTES) {
    throw new PracticeAPIError(413, 'TOO_LARGE', '练习内容过长。')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new PracticeAPIError(400, 'INVALID_REQUEST', '练习内容为空。')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {
        await reader.cancel()
        throw new PracticeAPIError(413, 'TOO_LARGE', '练习内容过长。')
      }
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    if (error instanceof PracticeAPIError) throw error
    throw new PracticeAPIError(400, 'INVALID_REQUEST', '练习内容格式不正确。')
  } finally { reader.releaseLock() }
}
