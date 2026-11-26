import 'server-only'

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { PracticeAPIError } from './iosPractice'
import { getHistoryDatabaseConfig, historyDatabaseRequest } from '../history/server'

// Native iOS data lives in the same per-user tables as the web app:
//   rehearsals    -> chat_history (source_type 'practice', news_key 'practice:<session uuid>')
//   vocabulary    -> unfamiliar_english (one row per app-saved expression, deterministic id)
//   own scenarios -> scenarios (private user rows with practice_plan)
// The full app object is kept losslessly in a JSON column; web-readable
// fields (title, transcript, items) are derived from it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SESSION_LIMIT = 500
const EXPRESSION_ROW_LIMIT = 2000
const MAX_SESSION_BYTES = 256 * 1024
const LANGUAGE = {
  learning_language_code: 'en', learning_language_label: 'English',
  native_language_code: 'zh-CN', native_language_label: '中文',
}
const CATEGORY_SLUGS = { 职场: 'workplace', 旅行: 'travel', 日常: 'daily_life', 学习: 'study', 社交: 'social' }
const CATEGORY_EN = { 职场: 'Workplace', 旅行: 'Travel', 日常: 'Daily life', 学习: 'Study', 社交: 'Social' }

const text = max => z.string().max(max)
const isoDate = z.string().refine(value => !Number.isNaN(Date.parse(value)), 'date')
const uuidText = z.string().transform(value => value.toLowerCase()).refine(value => UUID.test(value), 'uuid')

// Sessions stay opaque app JSON; only the fields the web needs are checked.
const sessionSchema = z.object({
  id: uuidText,
  updatedAt: isoDate,
  personalGoal: text(100).optional(),
  scenario: z.object({ title: text(200) }).passthrough(),
  messages: z.array(z.object({
    id: z.string().max(64), role: z.enum(['partner', 'user']), text: text(20000), createdAt: isoDate,
  }).passthrough()).max(2000),
}).passthrough()

const stepSchema = z.object({
  id: text(64), goal: text(40), prompt: text(400), translation: text(400), hint: text(300),
  keywords: text(200), expression: text(400), meaning: text(400),
}).strict()
const scenarioSchema = z.object({
  id: z.string().regex(/^custom-[0-9A-Fa-f-]{36}$/), title: text(60).min(1), subtitle: text(80), category: text(20),
  symbol: text(60), partner: text(60).min(1), partnerRole: text(60), setting: text(1000).min(1),
  persona: text(300).optional(),
  steps: z.array(stepSchema).length(3),
}).strict()

const expressionSchema = z.object({
  text: text(200).min(1), meaning: text(300), source: text(200), createdAt: isoDate,
  // Live's record tool also allows `other`; it is stored as type other, like a saved sentence.
  kind: z.enum(['word', 'phrase', 'grammar', 'other']).nullable().optional(),
}).strict()

const SESSION_BODY_BATCH = 40
const SESSION_WRITE_CONCURRENCY = 4

// Optional on POST: the version (updatedAt, epoch ms) of every session the device
// already holds. Sessions whose cloud copy is that same version are listed in
// `unchangedSessions` instead of being sent again. Older apps omit it and keep
// receiving every session in full.
const knownSessionsSchema = z.record(z.string(), z.number().finite())
  .refine(value => Object.keys(value).length <= SESSION_LIMIT * 2, 'size')
  .transform(value => new Map(Object.entries(value).map(([id, ms]) => [id.toLowerCase(), ms])))

const aiProviderConfigSchema = z.object({
  apiKey: text(512).default(''),
  baseURL: text(512).default(''),
  textModel: text(120).default(''),
  liveModel: text(120).default(''),
}).strict()

export const aiSettingsSchema = z.object({
  updatedAt: isoDate,
  textProvider: z.enum(['gemini', 'openai']).default('gemini'),
  voiceProvider: z.enum(['gemini', 'openai']).default('gemini'),
  gemini: aiProviderConfigSchema.default({}),
  openai: aiProviderConfigSchema.default({}),
}).strict()

export const syncRequestSchema = z.object({
  knownSessions: knownSessionsSchema.optional(),
  aiSettings: aiSettingsSchema.optional(),
  sessions: z.object({ upsert: z.array(z.unknown()).max(100).default([]), delete: z.array(uuidText).max(200).default([]) }).strict().default({}),
  expressions: z.object({ upsert: z.array(expressionSchema).max(500).default([]), delete: z.array(text(200)).max(500).default([]) }).strict().default({}),
  scenarios: z.object({ upsert: z.array(scenarioSchema).max(50).default([]), delete: z.array(z.string().regex(/^custom-[0-9A-Fa-f-]{36}$/)).max(50).default([]) }).strict().default({}),
}).strict()

function aiSettingsKey(userId, env = process.env) {
  const secret = env.AUTH_SECRET?.trim()
  if (!secret) throw new PracticeAPIError(503, 'NOT_CONFIGURED', '服务端尚未配置密钥加密。')
  return Buffer.from(hkdfSync('sha256', secret, `lingdaily-ai-user:${userId.toLowerCase()}`, 'lingdaily-ai-settings-v1', 32))
}

export function encryptAISettings(userId, settings, env = process.env) {
  const key = aiSettingsKey(userId, env)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(settings), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`
}

export function decryptAISettings(userId, packed, env = process.env) {
  if (typeof packed !== 'string' || !packed.startsWith('v1:')) return null
  const parts = packed.split(':')
  if (parts.length !== 4) return null
  try {
    const key = aiSettingsKey(userId, env)
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    const ciphertext = Buffer.from(parts[3], 'base64')
    if (iv.length !== 12 || tag.length !== 16) return null
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const json = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const parsed = aiSettingsSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const isMissingTable = result =>
  result?.status === 404 || ['42P01', 'PGRST205'].includes(result?.data?.code)

export const expressionKey = value => value.trim().toLowerCase()

// Stable per user and text, so retries and other devices update the same row.
export function expressionRowId(userId, key) {
  const hex = createHash('sha256').update(`ios-expression\u001f${userId}\u001f${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const scenarioRowId = id => id.slice('custom-'.length).toLowerCase()

/** Web-readable transcript in the same shape the web Live client stores. */
export function practiceHistory(session) {
  return session.messages
    .filter(message => message.text.trim())
    .map(message => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: message.text,
      itemId: `practice:${message.id}`,
      metadata: { isFinal: true, createdAt: message.createdAt },
    }))
}

export function practiceSystemPrompt(scenario) {
  const goals = scenario.steps.map((step, index) => `${index + 1}. ${step.goal}`).join('\n')
  return `You are ${scenario.partner} (${scenario.partnerRole}) in an English speaking rehearsal with a Chinese-speaking learner. ` +
    `Stay in character and use short, natural A2-B1 English, one question at a time.\n` +
    `Situation (from the learner, in Chinese): ${scenario.setting}\n` +
    (scenario.persona ? `Who you are, how you talk and your stance (in Chinese): ${scenario.persona}\n` : '') +
    `Let the learner practise these goals in order:\n${goals}\n` +
    `Open with this line: "${scenario.steps[0].prompt}"`
}

function databaseConfig() {
  const config = getHistoryDatabaseConfig()
  if (!config) throw new PracticeAPIError(503, 'NOT_CONFIGURED', '服务端尚未配置云同步。')
  return config
}

async function request(config, resource, options, operation) {
  const result = await historyDatabaseRequest(config, resource, options)
  if (!result.ok) {
    console.error(`[ios-sync] ${operation} failed`, { status: result.status, code: result.data?.code })
    throw new PracticeAPIError(502, 'SYNC_UNAVAILABLE', '云同步暂时不可用，内容已保留在本机，稍后会自动重试。')
  }
  return result.data
}

const sessionsFromRows = rows => rows.flatMap(row => {
  const session = row.news?.session
  return session && typeof session === 'object' ? [{ id: row.news_key.slice('practice:'.length), revision: row.revision, session }] : []
})

async function loadSessions(config, userId) {
  const params = new URLSearchParams({
    user_id: `eq.${userId}`, source_type: 'eq.practice', select: 'news_key,news,revision,updated_at',
    order: 'updated_at.desc,id.desc', limit: String(SESSION_LIMIT),
  })
  return sessionsFromRows(await request(config, 'chat_history', { params }, 'load sessions'))
}

/** Same sessions as `loadSessions`, but only fetches bodies the device does not already hold. */
async function loadChangedSessions(config, userId, known) {
  const params = new URLSearchParams({
    user_id: `eq.${userId}`, source_type: 'eq.practice', select: 'news_key,version:news->session->>updatedAt',
    order: 'updated_at.desc,id.desc', limit: String(SESSION_LIMIT),
  })
  const index = await request(config, 'chat_history', { params }, 'load session index')
  const unchanged = []
  const needed = []
  for (const row of index) {
    const id = row.news_key.slice('practice:'.length)
    const version = Date.parse(row.version || '')
    // Within 1 ms: the device keeps sub-millisecond dates, the wire format has milliseconds.
    if (known.has(id) && Math.abs(version - known.get(id)) < 1) unchanged.push(id)
    else needed.push(row.news_key)
  }
  const batches = []
  for (let start = 0; start < needed.length; start += SESSION_BODY_BATCH) batches.push(needed.slice(start, start + SESSION_BODY_BATCH))
  const bodies = await Promise.all(batches.map(keys => request(config, 'chat_history', {
    params: new URLSearchParams({
      user_id: `eq.${userId}`, source_type: 'eq.practice', select: 'news_key,news,revision,updated_at',
      news_key: `in.(${keys.map(key => `"${key}"`).join(',')})`,
    }),
  }, 'load sessions')))
  const byKey = new Map(bodies.flat().map(row => [row.news_key, row]))
  return { sessions: sessionsFromRows(needed.flatMap(key => byKey.has(key) ? [byKey.get(key)] : [])), unchangedSessions: unchanged }
}

async function loadExpressionRows(config, userId) {
  const params = new URLSearchParams({
    user_id: `eq.${userId}`, learning_language_code: 'eq.en', native_language_code: 'eq.zh-CN',
    select: 'id,items,context,timestamp', order: 'timestamp.asc,id.asc', limit: String(EXPRESSION_ROW_LIMIT),
  })
  return request(config, 'unfamiliar_english', { params }, 'load vocabulary')
}

/** Flattens web learning events and app rows into one list keyed by text. */
export function expressionsFromRows(rows) {
  const byKey = new Map()
  for (const row of rows) {
    for (const item of Array.isArray(row.items) ? row.items : []) {
      if (typeof item?.text !== 'string' || !item.text.trim()) continue
      const key = expressionKey(item.text)
      if (byKey.has(key)) continue
      byKey.set(key, {
        key, text: item.text.trim(), meaning: typeof item.meaning === 'string' ? item.meaning : '',
        source: typeof row.context === 'string' ? row.context : '',
        createdAt: row.timestamp, kind: ['word', 'phrase', 'grammar'].includes(item.type) ? item.type : null,
      })
    }
  }
  return [...byKey.values()]
}

async function loadScenarios(config, userId) {
  const params = new URLSearchParams({
    user_id: `eq.${userId}`, practice_plan: 'not.is.null', select: 'practice_plan,updated_at', order: 'updated_at.desc',
  })
  const rows = await request(config, 'scenarios', { params }, 'load scenarios')
  return rows.map(row => row.practice_plan).filter(plan => plan && typeof plan === 'object')
}

async function loadAISettings(config, userId) {
  const params = new URLSearchParams({
    user_id: `eq.${userId}`, select: 'encrypted_config,updated_at',
  })
  const result = await historyDatabaseRequest(config, 'user_ai_settings', { params })
  if (!result.ok) {
    if (isMissingTable(result)) return undefined
    console.error('[ios-sync] load aiSettings failed', { status: result.status, code: result.data?.code })
    throw new PracticeAPIError(502, 'SYNC_UNAVAILABLE', '云同步暂时不可用，内容已保留在本机，稍后会自动重试。')
  }
  const [row] = result.data || []
  if (!row?.encrypted_config) return undefined
  return decryptAISettings(userId, row.encrypted_config) || undefined
}

async function upsertAISettings(config, userId, aiSettings) {
  const params = new URLSearchParams({ user_id: `eq.${userId}`, select: 'updated_at' })
  const read = await historyDatabaseRequest(config, 'user_ai_settings', { params })
  if (!read.ok) {
    if (isMissingTable(read)) return
    console.error('[ios-sync] read aiSettings failed', { status: read.status, code: read.data?.code })
    throw new PracticeAPIError(502, 'SYNC_UNAVAILABLE', '云同步暂时不可用，内容已保留在本机，稍后会自动重试。')
  }
  const [existing] = read.data || []
  const incomingMs = Date.parse(aiSettings.updatedAt)
  const existingMs = Date.parse(existing?.updated_at || '')
  if (existing && Number.isFinite(existingMs) && existingMs > incomingMs + 1) return
  const normalized = { ...aiSettings, updatedAt: new Date(incomingMs).toISOString() }
  const fields = {
    encrypted_config: encryptAISettings(userId, normalized),
    updated_at: normalized.updatedAt,
  }
  const write = existing
    ? await historyDatabaseRequest(config, 'user_ai_settings', {
      method: 'PATCH', params: new URLSearchParams({ user_id: `eq.${userId}` }), body: fields, prefer: 'return=minimal',
    })
    : await historyDatabaseRequest(config, 'user_ai_settings', {
      method: 'POST', body: { user_id: userId, ...fields }, prefer: 'return=minimal',
    })
  if (!write.ok && !isMissingTable(write)) {
    console.error('[ios-sync] save aiSettings failed', { status: write.status, code: write.data?.code })
    throw new PracticeAPIError(502, 'SYNC_UNAVAILABLE', '云同步暂时不可用，内容已保留在本机，稍后会自动重试。')
  }
}

export async function loadSnapshot(userId, knownSessions) {
  const config = databaseConfig()
  const [sessions, rows, scenarios, aiSettings] = await Promise.all([
    knownSessions ? loadChangedSessions(config, userId, knownSessions) : loadSessions(config, userId),
    loadExpressionRows(config, userId), loadScenarios(config, userId), loadAISettings(config, userId),
  ])
  const sessionPart = knownSessions ? sessions : { sessions }
  return {
    ...sessionPart, expressions: expressionsFromRows(rows), scenarios,
    ...(aiSettings ? { aiSettings } : {}),
  }
}

/** Returns false when this one session can never be stored, so the client stops retrying it. */
async function upsertSession(config, userId, raw) {
  const parsed = sessionSchema.safeParse(raw)
  if (!parsed.success || Buffer.byteLength(JSON.stringify(raw)) > MAX_SESSION_BYTES) return false
  const session = parsed.data
  const newsKey = `practice:${session.id}`
  const params = new URLSearchParams({ user_id: `eq.${userId}`, news_key: `eq.${newsKey}`, select: 'version:news->session->>updatedAt' })
  const [current] = await request(config, 'chat_history', { params }, 'read session')
  // Another device already saved a newer version: keep it; the client adopts it from the snapshot.
  const remoteUpdated = Date.parse(current?.version || '')
  if (current && remoteUpdated > Date.parse(session.updatedAt) + 1) return true
  const title = (session.personalGoal || '').trim() || session.scenario.title || 'App 练习'
  await request(config, 'rpc/save_chat_history', {
    method: 'POST',
    body: {
      p_user_id: userId, p_news_key: newsKey, p_news_title: title.slice(0, 200),
      p_news: { _isPractice: true, schemaVersion: 1, title, session },
      p_history: practiceHistory(session), p_summary: null, p_source_type: 'practice',
      // Last writer wins after the timestamp check above; the RPC still serialises writers.
      p_expected_revision: null,
    },
  }, 'save session')
  return true
}

async function deleteRows(config, resource, params, operation) {
  await request(config, resource, { method: 'DELETE', params, prefer: 'return=minimal' }, operation)
}

async function upsertExpression(config, userId, item) {
  const key = expressionKey(item.text)
  const row = {
    id: expressionRowId(userId, key), user_id: userId,
    items: [{ text: item.text.trim(), type: item.kind || 'other', meaning: item.meaning }],
    context: item.source || null, user_message: null, timestamp: new Date(item.createdAt).toISOString(), ...LANGUAGE,
  }
  // The id is derived from this user's id, so the upsert can only touch this user's row.
  await request(config, 'unfamiliar_english', {
    method: 'POST', params: new URLSearchParams({ on_conflict: 'id' }), body: row,
    prefer: 'resolution=merge-duplicates,return=minimal',
  }, 'save vocabulary')
}

async function deleteExpression(config, userId, rows, key) {
  for (const row of rows) {
    const items = Array.isArray(row.items) ? row.items : []
    const kept = items.filter(item => typeof item?.text !== 'string' || expressionKey(item.text) !== key)
    if (kept.length === items.length) continue
    const params = new URLSearchParams({ id: `eq.${row.id}`, user_id: `eq.${userId}` })
    if (kept.length === 0) await deleteRows(config, 'unfamiliar_english', params, 'delete vocabulary')
    else await request(config, 'unfamiliar_english', { method: 'PATCH', params, body: { items: kept }, prefer: 'return=minimal' }, 'update vocabulary')
    row.items = kept
  }
}

async function upsertScenario(config, userId, scenario) {
  const id = scenarioRowId(scenario.id)
  const fields = {
    category_slug: CATEGORY_SLUGS[scenario.category] || 'other', category_name_zh: scenario.category,
    category_name_en: CATEGORY_EN[scenario.category] || 'Other', category_icon: 'smartphone',
    title_zh: scenario.title, title_en: scenario.title, title_target: scenario.title,
    description_zh: scenario.setting, description_en: scenario.setting, description_target: scenario.setting,
    target_language_code: 'en', native_language_code: 'zh-CN', difficulty: 'intermediate',
    system_prompt: practiceSystemPrompt(scenario), is_active: true, is_public: false, practice_plan: scenario,
  }
  const params = new URLSearchParams({ id: `eq.${id}`, select: 'user_id' })
  const [existing] = await request(config, 'scenarios', { params }, 'read scenario')
  if (existing && existing.user_id !== userId) throw new PracticeAPIError(409, 'SCENARIO_CONFLICT', '场景标识冲突，请重新创建这个场景。')
  if (existing) {
    await request(config, 'scenarios', {
      method: 'PATCH', params: new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${userId}` }), body: fields, prefer: 'return=minimal',
    }, 'update scenario')
  } else {
    await request(config, 'scenarios', { method: 'POST', body: { id, user_id: userId, ...fields }, prefer: 'return=minimal' }, 'create scenario')
  }
}

/**
 * Applies the client's pending changes, then returns the authoritative snapshot.
 * `rejectedSessions` lists sessions that are invalid or too large to store.
 */
export async function applySync(userId, changes) {
  const config = databaseConfig()
  const rejectedSessions = []
  const upserts = changes.sessions.upsert
  const ids = upserts.map(raw => String(raw?.id || '').toLowerCase())
  // Different sessions are different rows, so a few can be written at once;
  // a repeated id keeps the strict one-after-another order.
  const concurrency = new Set(ids).size === ids.length ? SESSION_WRITE_CONCURRENCY : 1
  const stored = new Array(upserts.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, upserts.length) }, async () => {
    while (next < upserts.length) {
      const index = next++
      stored[index] = await upsertSession(config, userId, upserts[index])
    }
  }))
  stored.forEach((ok, index) => { if (!ok) rejectedSessions.push(ids[index]) })
  for (const id of changes.sessions.delete) {
    await deleteRows(config, 'chat_history', new URLSearchParams({
      user_id: `eq.${userId}`, news_key: `eq.practice:${id}`, source_type: 'eq.practice',
    }), 'delete session')
  }
  for (const item of changes.expressions.upsert) await upsertExpression(config, userId, item)
  if (changes.expressions.delete.length) {
    const rows = await loadExpressionRows(config, userId)
    for (const text of changes.expressions.delete) await deleteExpression(config, userId, rows, expressionKey(text))
  }
  for (const scenario of changes.scenarios.upsert) await upsertScenario(config, userId, scenario)
  for (const id of changes.scenarios.delete) {
    await deleteRows(config, 'scenarios', new URLSearchParams({
      id: `eq.${scenarioRowId(id)}`, user_id: `eq.${userId}`, practice_plan: 'not.is.null',
    }), 'delete scenario')
  }
  if (changes.aiSettings) await upsertAISettings(config, userId, changes.aiSettings)
  return { ...await loadSnapshot(userId, changes.knownSessions), rejectedSessions }
}

/** Deletes every row the account owns across the shared tables (web data included). */
export async function deleteAccountData(userId) {
  const config = databaseConfig()
  const owned = new URLSearchParams({ user_id: `eq.${userId}` })
  for (const table of ['chat_history', 'unfamiliar_english', 'scenarios', 'user_preferences', 'ai_usage']) {
    await deleteRows(config, table, owned, `delete ${table}`)
  }
  const aiRes = await historyDatabaseRequest(config, 'user_ai_settings', { method: 'DELETE', params: owned, prefer: 'return=minimal' })
  if (!aiRes.ok && !isMissingTable(aiRes)) {
    console.error('[ios-sync] delete user_ai_settings failed', { status: aiRes.status, code: aiRes.data?.code })
    throw new PracticeAPIError(502, 'SYNC_UNAVAILABLE', '删除账号数据时出错，请稍后重试。')
  }
}
