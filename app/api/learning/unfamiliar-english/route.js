import { auth } from "@/app/auth"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseSchema = process.env.SUPABASE_SCHEMA || 'public'

const ALLOWED_ITEM_TYPES = new Set(['word', 'phrase', 'grammar', 'other'])
const MAX_ITEMS_PER_EVENT = 20
const MAX_ITEM_LENGTH = 200
const MAX_CONTEXT_LENGTH = 1000
const MAX_USER_MESSAGE_LENGTH = 2000

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

function normalizeItems(items) {
  return items.slice(0, MAX_ITEMS_PER_EVENT).map((item) => {
    const text = typeof item?.text === 'string'
      ? item.text.trim().slice(0, MAX_ITEM_LENGTH)
      : ''
    const type = ALLOWED_ITEM_TYPES.has(item?.type) ? item.type : 'other'
    return { text, type }
  }).filter((item) => item.text)
}

export async function POST(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401)

    const credentials = getSupabaseCredentials(session)
    if (!credentials) return jsonResponse({ error: 'Missing authenticated Supabase configuration' }, 500)

    const body = await req.json().catch(() => ({}))
    if (!Array.isArray(body?.items)) return jsonResponse({ error: "'items' must be an array" }, 400)

    const items = normalizeItems(body.items)
    if (items.length === 0) return jsonResponse({ ok: true, skipped: true })

    const row = {
      user_id: session.user.id,
      items,
      context: optionalText(body.context, MAX_CONTEXT_LENGTH),
      user_message: optionalText(body.userMessage, MAX_USER_MESSAGE_LENGTH),
      // Server time keeps cursor pagination stable and prevents forged ordering.
      timestamp: new Date().toISOString(),
    }

    const res = await fetch(`${supabaseUrl}/rest/v1/unfamiliar_english`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: credentials.apiKey,
        Authorization: `Bearer ${credentials.bearer}`,
        'Content-Profile': supabaseSchema,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
      cache: 'no-store',
    })

    const text = await res.text()
    const data = parseJson(text, { raw: text })
    if (!res.ok) {
      return jsonResponse({
        error: data?.message || data?.hint || data?.raw || data?.error || 'Failed to save learning items',
        status: res.status,
        details: data,
      }, res.status || 400)
    }

    return jsonResponse({ ok: true, data })
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500)
  }
}

export async function GET(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401)

    const credentials = getSupabaseCredentials(session)
    if (!credentials) return jsonResponse({ error: 'Missing authenticated Supabase configuration' }, 500)

    const { searchParams } = new URL(req.url)
    const rawLimit = searchParams.get('limit')
    const parsedLimit = rawLimit === null ? 50 : Number.parseInt(rawLimit, 10)
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      return jsonResponse({ error: "'limit' must be a positive integer" }, 400)
    }
    const limit = Math.min(parsedLimit, 200)

    const before = searchParams.get('before')
    if (before && Number.isNaN(Date.parse(before))) {
      return jsonResponse({ error: "'before' must be a valid ISO timestamp" }, 400)
    }

    const params = new URLSearchParams({
      user_id: `eq.${session.user.id}`,
      select: 'id,user_id,items,context,user_message,timestamp',
      order: 'timestamp.desc,id.desc',
      limit: String(limit),
    })
    if (before) params.set('timestamp', `lt.${new Date(before).toISOString()}`)

    const res = await fetch(`${supabaseUrl}/rest/v1/unfamiliar_english?${params.toString()}`, {
      headers: {
        apikey: credentials.apiKey,
        Authorization: `Bearer ${credentials.bearer}`,
        'Accept-Profile': supabaseSchema,
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    })

    const text = await res.text()
    const data = parseJson(text, { raw: text })
    if (!res.ok) {
      return jsonResponse({
        error: data?.message || data?.hint || data?.raw || data?.error || 'Failed to fetch learning items',
        status: res.status,
        details: data,
      }, res.status || 400)
    }

    return jsonResponse({ ok: true, data: Array.isArray(data) ? data : [] })
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500)
  }
}
