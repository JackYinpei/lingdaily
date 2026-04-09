import { auth } from "@/app/auth"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseSchema = process.env.SUPABASE_SCHEMA || 'public'

export async function POST(req) {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase env configuration" }),
        { status: 500 }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const { items, context, timestamp, userMessage } = body || {}

    if (!Array.isArray(items)) {
      return new Response(
        JSON.stringify({ error: "'items' must be an array" }),
        { status: 400 }
      )
    }

    // Empty items means Gemini found no unfamiliar words — valid, skip DB write
    if (items.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 })
    }

    // Normalize items to expected shape: [{ text, type }]
    const normalizedItems = items
      .map((it) => ({
        text: typeof it?.text === "string" ? it.text : String(it?.text ?? ""),
        type: typeof it?.type === "string" ? it.type : "other",
      }))
      .filter((it) => it.text.trim().length > 0)

    // Build the row to insert. Table expected: unfamiliar_english
    const row = {
      user_id: session.user.id,
      items: normalizedItems,
      context: context ?? null,
      // Keep original field to avoid breaking existing schema; DB may ignore if column absent
      timestamp: timestamp ?? new Date().toISOString(),
      user_message: userMessage ?? null,
    }

    const url = `${supabaseUrl}/rest/v1/unfamiliar_english`
    // Prefer service role for server-side inserts when available (bypasses RLS safely on server)
    const initialBearer = supabaseServiceRoleKey || session.supabaseAccessToken || supabaseAnonKey
    const apiKeyHeader = supabaseServiceRoleKey || supabaseAnonKey

    async function doInsert(bearerToken) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKeyHeader,
          Authorization: `Bearer ${bearerToken}`,
          'Content-Profile': supabaseSchema,
          Prefer: "return=representation",
        },
        body: JSON.stringify(row),
        cache: "no-store",
      })
      const txt = await response.text()
      let parsed
      try { parsed = txt ? JSON.parse(txt) : {} } catch { parsed = { raw: txt } }
      return { response, data: parsed }
    }

    // Attempt insert (no FK upsert needed — constraint has been removed)
    const { response: res, data } = await doInsert(initialBearer)

    if (!res.ok) {
      let message = data?.message || data?.hint || data?.raw || data?.error || "Failed to insert"
      if ((res.status === 404) && message === "Failed to insert") {
        message = "Supabase resource not found: check table name and schema"
      }
      const status = res.status || 400
      return new Response(
        JSON.stringify({ error: message, status, details: data }),
        { status }
      )
    }

    return new Response(
      JSON.stringify({ ok: true, data }),
      { status: 200 }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || "Unexpected error" }),
      { status: 500 }
    )
  }
}

export async function GET(req) {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase env configuration" }),
        { status: 500 }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)
    const before = searchParams.get('before') // ISO string to fetch older records

    const params = new URLSearchParams()
    params.set('user_id', `eq.${session.user.id}`)
    params.set('select', 'id,user_id,items,context,user_message,timestamp')
    params.set('order', 'timestamp.desc')
    params.set('limit', String(limit))
    if (before) params.append('timestamp', `lt.${before}`)

    const url = `${supabaseUrl}/rest/v1/unfamiliar_english?${params.toString()}`
    const bearer = supabaseServiceRoleKey || session.supabaseAccessToken || supabaseAnonKey
    const apiKeyHeader = supabaseServiceRoleKey || supabaseAnonKey

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: apiKeyHeader,
        Authorization: `Bearer ${bearer}`,
        'Content-Profile': supabaseSchema,
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    })

    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : [] } catch { data = { raw: text } }

    if (!res.ok) {
      const message = data?.message || data?.hint || data?.raw || data?.error || 'Failed to fetch'
      return new Response(
        JSON.stringify({ error: message, status: res.status, details: data }),
        { status: res.status || 400 }
      )
    }

    return new Response(
      JSON.stringify({ ok: true, data }),
      { status: 200 }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Unexpected error' }),
      { status: 500 }
    )
  }
}
