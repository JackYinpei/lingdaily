import { auth } from '@/app/auth'
import {
  DEFAULT_LEARNING_LANGUAGE,
  DEFAULT_NATIVE_LANGUAGE,
  getLanguageFromPreference,
} from '@/app/lib/languages'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseSchema = process.env.SUPABASE_SCHEMA || 'public'

const ALLOWED_ITEM_TYPES = new Set(['word', 'phrase', 'grammar', 'other'])
const MAX_ITEMS_PER_EVENT = 20
const MAX_ITEM_LENGTH = 200
const MAX_MEANING_LENGTH = 1000
const MAX_ORIGINAL_LENGTH = 500
const MAX_CONTEXT_LENGTH = 1000
const MAX_USER_MESSAGE_LENGTH = 2000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LANGUAGE_COLUMNS = [
  'learning_language_code',
  'learning_language_label',
  'native_language_code',
  'native_language_label',
]

function jsonResponse(body, status = 200) {
  return Response.json(body, { status })
}

function getSupabaseCredentials(session) {
  const bearer = supabaseServiceRoleKey || session?.supabaseAccessToken
  const apiKey = supabaseServiceRoleKey || supabaseAnonKey
  if (!supabaseUrl || !bearer || !apiKey) return null
  return { bearer, apiKey }
}

function parseJson(text, fallback) {
  try { return text ? JSON.parse(text) : fallback } catch { return fallback }
}

function optionalText(value, maxLength) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().slice(0, maxLength)
  return normalized || null
}

function normalizeItems(items, { limit = true } = {}) {
  if (!Array.isArray(items)) return []

  const sourceItems = limit ? items.slice(0, MAX_ITEMS_PER_EVENT) : items
  return sourceItems.map((item) => {
    const text = optionalText(item?.text, MAX_ITEM_LENGTH) || ''
    const type = ALLOWED_ITEM_TYPES.has(item?.type) ? item.type : 'other'
    const meaning = optionalText(item?.meaning, MAX_MEANING_LENGTH)
    const original = optionalText(item?.original, MAX_ORIGINAL_LENGTH)

    return {
      text,
      type,
      ...(meaning ? { meaning } : {}),
      ...(original ? { original } : {}),
    }
  }).filter((item) => item.text)
}

function parseCursor(value) {
  if (!value) return null
  const separatorIndex = value.lastIndexOf('|')
  const timestamp = separatorIndex >= 0 ? value.slice(0, separatorIndex) : value
  const id = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : null
  if (Number.isNaN(Date.parse(timestamp)) || (id && !UUID_PATTERN.test(id))) return null
  return { timestamp: new Date(timestamp).toISOString(), id }
}

function createCursor(record) {
  return record?.timestamp && record?.id ? `${record.timestamp}|${record.id}` : null
}

function resolveLearningLanguage(value) {
  return getLanguageFromPreference(value, { allowChinese: false })
    || DEFAULT_LEARNING_LANGUAGE
}

function resolveNativeLanguage(value) {
  return getLanguageFromPreference(value) || DEFAULT_NATIVE_LANGUAGE
}

function languageFromBody(body, prefix, fallback) {
  const camelCase = prefix === 'learning' ? 'targetLanguage' : 'nativeLanguage'
  const alternate = prefix === 'learning' ? 'learningLanguage' : null
  return body?.[camelCase]
    ?? (alternate ? body?.[alternate] : undefined)
    ?? body?.[`${prefix}_language_code`]
    ?? fallback
}

function isMissingLanguageColumns(payload) {
  const code = String(payload?.code || '')
  const description = [payload?.message, payload?.details, payload?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const describesMissingColumn = description.includes('schema cache')
    || description.includes('does not exist')
    || description.includes('could not find')

  return (code === 'PGRST204' || code === '42703' || describesMissingColumn)
    && LANGUAGE_COLUMNS.some((column) => description.includes(column))
}

function decorateRecord(record) {
  const learning = resolveLearningLanguage(record?.learning_language_code)
  const native = resolveNativeLanguage(record?.native_language_code)

  return {
    ...record,
    // Never discard already-persisted history on read. The 20-item cap only
    // protects new write events.
    items: normalizeItems(record?.items, { limit: false }),
    learning_language_code: learning.code,
    learning_language_label: learning.label,
    native_language_code: native.code,
    native_language_label: native.label,
  }
}

function requestHeaders(credentials, { write = false } = {}) {
  return {
    apikey: credentials.apiKey,
    Authorization: `Bearer ${credentials.bearer}`,
    [write ? 'Content-Profile' : 'Accept-Profile']: supabaseSchema,
    ...(write
      ? { 'Content-Type': 'application/json', Prefer: 'return=representation' }
      : { Accept: 'application/json', 'Cache-Control': 'no-cache' }),
  }
}

async function insertRecord(credentials, row) {
  const res = await fetch(`${supabaseUrl}/rest/v1/unfamiliar_english`, {
    method: 'POST',
    headers: requestHeaders(credentials, { write: true }),
    body: JSON.stringify(row),
    cache: 'no-store',
  })
  const text = await res.text()
  return { res, data: parseJson(text, { raw: text }) }
}

async function fetchRecords(credentials, params) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/unfamiliar_english?${params.toString()}`,
    {
      headers: requestHeaders(credentials),
      cache: 'no-store',
    },
  )
  const text = await res.text()
  return { res, data: parseJson(text, { raw: text }) }
}

export async function POST(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401)

    const credentials = getSupabaseCredentials(session)
    if (!credentials) {
      return jsonResponse({ error: 'Learning items storage is not configured' }, 500)
    }

    const body = await req.json().catch(() => ({}))
    if (!Array.isArray(body?.items)) {
      return jsonResponse({ error: "'items' must be an array" }, 400)
    }

    const items = normalizeItems(body.items)
    if (items.length === 0) return jsonResponse({ ok: true, skipped: true })

    // The authenticated user is always authoritative; a client-provided user_id
    // is intentionally ignored even when a service-role key is configured.
    const requestedLearning = languageFromBody(body, 'learning', null)
    const requestedNative = languageFromBody(body, 'native', null)
    const learning = requestedLearning === null
      ? DEFAULT_LEARNING_LANGUAGE
      : getLanguageFromPreference(requestedLearning, { allowChinese: false })
    const native = requestedNative === null
      ? DEFAULT_NATIVE_LANGUAGE
      : getLanguageFromPreference(requestedNative)
    if (!learning || !native || learning.code === native.code) {
      return jsonResponse({ error: 'Unsupported native or target language' }, 400)
    }
    const legacyRow = {
      user_id: session.user.id,
      items,
      context: optionalText(body.context, MAX_CONTEXT_LENGTH),
      user_message: optionalText(body.userMessage ?? body.user_message, MAX_USER_MESSAGE_LENGTH),
      timestamp: new Date().toISOString(),
    }
    const row = {
      ...legacyRow,
      learning_language_code: learning.code,
      learning_language_label: learning.label,
      native_language_code: native.code,
      native_language_label: native.label,
    }

    let result = await insertRecord(credentials, row)
    let usedLegacySchema = false
    if (!result.res.ok && isMissingLanguageColumns(result.data)) {
      if (
        learning.code !== DEFAULT_LEARNING_LANGUAGE.code
        || native.code !== DEFAULT_NATIVE_LANGUAGE.code
      ) {
        // A legacy row has no place to retain its language identity. Returning
        // success here would silently relabel (for example) Japanese as English
        // when the migration later backfills old rows.
        return jsonResponse({ error: 'Learning storage is being upgraded; please retry shortly' }, 503)
      }
      // Keep the existing voice flow operational while the additive migration
      // rolls out. Old rows are unambiguously treated as English learned from Chinese.
      result = await insertRecord(credentials, legacyRow)
      usedLegacySchema = true
    }

    if (!result.res.ok) {
      console.error('Failed to save learning items:', result.res.status, result.data)
      return jsonResponse({ error: 'Failed to save learning items' }, 502)
    }

    const data = Array.isArray(result.data)
      ? result.data.map(decorateRecord)
      : decorateRecord(result.data)
    return jsonResponse({ ok: true, data, ...(usedLegacySchema ? { legacySchema: true } : {}) })
  } catch (error) {
    console.error('Learning items POST error:', error)
    return jsonResponse({ error: 'Unable to save learning items' }, 500)
  }
}

export async function GET(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401)

    const credentials = getSupabaseCredentials(session)
    if (!credentials) {
      return jsonResponse({ error: 'Learning items storage is not configured' }, 500)
    }

    const { searchParams } = new URL(req.url)
    const requestedLanguage = searchParams.get('targetLanguage') || DEFAULT_LEARNING_LANGUAGE.code
    const learning = getLanguageFromPreference(requestedLanguage, { allowChinese: false })
    if (!learning) return jsonResponse({ error: 'Unsupported target language' }, 400)

    const rawLimit = searchParams.get('limit')
    const parsedLimit = rawLimit === null ? 50 : Number.parseInt(rawLimit, 10)
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      return jsonResponse({ error: "'limit' must be a positive integer" }, 400)
    }
    const limit = Math.min(parsedLimit, 200)

    const before = searchParams.get('before')
    const cursor = parseCursor(before)
    if (before && !cursor) {
      return jsonResponse({ error: "'before' must be a valid cursor" }, 400)
    }

    const commonParams = {
      user_id: `eq.${session.user.id}`,
      order: 'timestamp.desc,id.desc',
      // Fetch one sentinel row so nextCursor represents actual remaining data.
      limit: String(limit + 1),
    }
    const params = new URLSearchParams({
      ...commonParams,
      learning_language_code: `eq.${learning.code}`,
      select: `id,user_id,items,context,user_message,timestamp,${LANGUAGE_COLUMNS.join(',')}`,
    })
    if (cursor?.id) {
      params.set('or', `(timestamp.lt.${cursor.timestamp},and(timestamp.eq.${cursor.timestamp},id.lt.${cursor.id}))`)
    } else if (cursor) {
      // Accept timestamp-only cursors from older clients during the transition.
      params.set('timestamp', `lt.${cursor.timestamp}`)
    }

    let result = await fetchRecords(credentials, params)
    let usedLegacySchema = false
    if (!result.res.ok && isMissingLanguageColumns(result.data)) {
      usedLegacySchema = true
      if (learning.code !== DEFAULT_LEARNING_LANGUAGE.code) {
        return jsonResponse({ ok: true, data: [], nextCursor: null, legacySchema: true })
      }

      const legacyParams = new URLSearchParams({
        ...commonParams,
        select: 'id,user_id,items,context,user_message,timestamp',
      })
      if (cursor?.id) {
        legacyParams.set('or', `(timestamp.lt.${cursor.timestamp},and(timestamp.eq.${cursor.timestamp},id.lt.${cursor.id}))`)
      } else if (cursor) {
        legacyParams.set('timestamp', `lt.${cursor.timestamp}`)
      }
      result = await fetchRecords(credentials, legacyParams)
    }

    if (!result.res.ok) {
      console.error('Failed to fetch learning items:', result.res.status, result.data)
      return jsonResponse({ error: 'Failed to fetch learning items' }, 502)
    }

    const allRecords = Array.isArray(result.data) ? result.data : []
    const hasMore = allRecords.length > limit
    const records = allRecords.slice(0, limit).map(decorateRecord)

    return jsonResponse({
      ok: true,
      data: records,
      nextCursor: hasMore ? createCursor(records[records.length - 1]) : null,
      ...(usedLegacySchema ? { legacySchema: true } : {}),
    })
  } catch (error) {
    console.error('Learning items GET error:', error)
    return jsonResponse({ error: 'Unable to fetch learning items' }, 500)
  }
}
