import { auth } from "@/app/auth"
import { getLanguageFromPreference, resolveDistinctLanguagePair } from '@/app/lib/languages'
import { getSupabaseRestConfig, SUPABASE_CREDENTIALS, supabaseRestRequest } from '@/app/lib/server/supabaseRest'

function jsonResponse(body, status = 200) {
  return Response.json(body, { status })
}

function getSupabaseCredentials(session) {
  return getSupabaseRestConfig({ credentials: SUPABASE_CREDENTIALS.SERVICE_ROLE_OR_SESSION, session })
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: 'Unauthorized' }, 401)

    const credentials = getSupabaseCredentials(session)
    if (!credentials) return jsonResponse({ error: 'Language preferences storage is not configured' }, 500)

    const params = new URLSearchParams({
      user_id: `eq.${session.user.id}`,
      select: 'user_id,native_language_code,native_language_label,learning_language_code,learning_language_label,updated_at',
      limit: '1',
    })
    const res = await supabaseRestRequest(credentials, 'user_preferences', { params })
    const data = res.data ?? []
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

    const res = await supabaseRestRequest(credentials, 'user_preferences', {
      method: 'POST',
      params: new URLSearchParams({ on_conflict: 'user_id' }),
      body: row,
      prefer: 'resolution=merge-duplicates,return=representation',
    })
    const data = res.data ?? { raw: res.text }
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
