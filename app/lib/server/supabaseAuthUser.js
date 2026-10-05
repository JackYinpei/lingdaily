const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Ensure an externally verified user exists in Supabase auth.users via Admin API.
 * Returns the Supabase auth UUID so all tables can use a consistent user_id.
 * Shared by web OAuth (NextAuth) and native iOS Sign in with Apple.
 */
export async function ensureAuthUser({ email, name, image }) {
  const url = supabaseUrl()
  const key = serviceRoleKey()
  if (!url || !key || !email) return null

  const headers = {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  }

  // Try creating the user via Supabase Admin API
  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { name, avatar_url: image },
    }),
  })

  if (createRes.ok) {
    const data = await createRes.json()
    console.log('[auth] Created auth.users entry for OAuth user:', data.id)
    return data.id
  }

  // User already exists (422) — look up by email
  const listRes = await fetch(
    `${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&page=1&per_page=10`,
    { method: 'GET', headers },
  )
  if (listRes.ok) {
    const listData = await listRes.json()
    const users = listData.users || []
    const match = users.find(u => u.email === email)
    if (match) return match.id
  }

  return null
}
