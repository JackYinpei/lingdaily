import { getSupabasePublicAuthConfig } from "@/app/lib/server/supabaseRest"

export async function POST(req) {
  try {
    const { email, password, name } = await req.json()
    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password are required" }),
        { status: 400 }
      )
    }

    const supabaseAuth = getSupabasePublicAuthConfig()
    if (!supabaseAuth) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase env configuration" }),
        { status: 500 }
      )
    }

    let res
    let data

    // Fallback: public signup via anon key (will require email confirmation unless disabled)
    const url = `${supabaseAuth.baseUrl}/auth/v1/signup`
    res = await fetch(url, {
      method: "POST",
      headers: supabaseAuth.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        email,
        password,
        data: name ? { name } : undefined,
      }),
      cache: "no-store",
    })
    data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const message = data?.msg || data?.error_description || data?.error || "Registration failed"
      return new Response(JSON.stringify({ error: message }), { status: 400 })
    }

    return new Response(
      JSON.stringify({ ok: true, user: data ?? null }),
      { status: 200 }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || "Unexpected error" }),
      { status: 500 }
    )
  }
}
