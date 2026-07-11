import { auth } from "@/app/auth"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseSchema = process.env.SUPABASE_SCHEMA || 'public'

const LANGUAGES = new Map([
  ['zh-CN', '中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
])

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

function normalizeLanguage(value, { allowChinese = false } = {}) {
  const rawCode = typeof value?.code === 'string' ? value.code.trim() : ''
  const code = rawCode === 'zh' || rawCode === 'zh-TW' ? 'zh-CN' : rawCode
  if (!LANGUAGES.has(code) || (!allowChinese && code === 'zh-CN')) return null
  return { code, label: LANGUAGES.get(code) }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401)

    const credentials = getSupabaseCredentials(session)
    if (!credentials) return jsonResponse({ error: 'Missing authenticated Supabase configuration' }, 500)

    const url = new URL(`${supabaseUrl}/rest/v1/user_preferences`)
    url.searchParams.set('user_id', `eq.${session.user.id}`)
    url.searchParams.set('select', 'user_id,native_language_code,native_language_label,learning_language_code,learning_language_label,updated_at')
    url.searchParams.set('limit', '1')

    const res = await fetch(url.toString(), {
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
    const data = parseJson(text, [])
    if (!res.ok) {
      return jsonResponse({
        error: data?.message || data?.hint || data?.raw || 'Failed to fetch preferences',
        status: res.status,
      }, res.status || 400)
    }

    return jsonResponse({ ok: true, data: Array.isArray(data) ? data[0] || null : null })
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500)
  }
}

export async function POST(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401)

    const credentials = getSupabaseCredentials(session)
    if (!credentials) return jsonResponse({ error: 'Missing authenticated Supabase configuration' }, 500)

    const body = await req.json().catch(() => ({}))
    const native = normalizeLanguage(body?.native, { allowChinese: true })
    const learning = normalizeLanguage(body?.learning)
    if (!native || !learning) {
      return jsonResponse({ error: 'Unsupported native or learning language' }, 400)
    }

    const row = {
      user_id: session.user.id,
      native_language_code: native.code,
      native_language_label: native.label,
      learning_language_code: learning.code,
      learning_language_label: learning.label,
    }

    const url = new URL(`${supabaseUrl}/rest/v1/user_preferences`)
    url.searchParams.set('on_conflict', 'user_id')
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: credentials.apiKey,
        Authorization: `Bearer ${credentials.bearer}`,
        'Content-Profile': supabaseSchema,
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(row),
      cache: 'no-store',
    })

    const text = await res.text()
    const data = parseJson(text, { raw: text })
    if (!res.ok) {
      return jsonResponse({
        error: data?.message || data?.hint || data?.raw || data?.error || 'Failed to save preferences',
        status: res.status,
        details: data,
      }, res.status || 400)
    }

    return jsonResponse({ ok: true, data: Array.isArray(data) ? data[0] : data })
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500)
  }
}
