import { auth } from "@/app/auth"
import { getLanguageFromPreference, resolveDistinctLanguagePair } from '@/app/lib/languages'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseSchema = process.env.SUPABASE_SCHEMA || 'public'

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

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401)

    const credentials = getSupabaseCredentials(session)
    if (!credentials) return jsonResponse({ error: 'Language preferences storage is not configured' }, 500)

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
      console.error('Failed to fetch language preferences:', res.status, data)
      return jsonResponse({ error: 'Failed to fetch language preferences' }, 502)
    }

    const stored = Array.isArray(data) ? data[0] || null : null
    if (!stored) return jsonResponse({ ok: true, data: null })

    const pair = resolveDistinctLanguagePair(
      stored.learning_language_code,
      stored.native_language_code,
    )
    const { nativeLanguage: native, learningLanguage: learning } = pair

    return jsonResponse({
      ok: true,
      data: {
        ...stored,
        native_language_code: native.code,
        native_language_label: native.label,
        learning_language_code: learning.code,
        learning_language_label: learning.label,
      },
    })
  } catch (error) {
    console.error('Language preferences GET error:', error)
    return jsonResponse({ error: 'Unable to load language preferences' }, 500)
  }
}

export async function POST(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401)

    const credentials = getSupabaseCredentials(session)
    if (!credentials) return jsonResponse({ error: 'Language preferences storage is not configured' }, 500)

    const body = await req.json().catch(() => ({}))
    const native = getLanguageFromPreference(body?.native)
    const learning = getLanguageFromPreference(body?.learning, { allowChinese: false })
    if (!native || !learning || native.code === learning.code) {
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
      console.error('Failed to save language preferences:', res.status, data)
      return jsonResponse({ error: 'Failed to save language preferences' }, 502)
    }

    return jsonResponse({ ok: true, data: Array.isArray(data) ? data[0] : data })
  } catch (error) {
    console.error('Language preferences POST error:', error)
    return jsonResponse({ error: 'Unable to save language preferences' }, 500)
  }
}
