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
  return findAuthUserIdByEmail(email)
}

/** Looks up an existing Supabase auth user without creating one. */
export async function findAuthUserIdByEmail(email) {
  const url = supabaseUrl()
  const key = serviceRoleKey()
  if (!url || !key || !email) return null
  const listRes = await fetch(
    `${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&page=1&per_page=10`,
    { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` } },
  )
  if (!listRes.ok) return null
  const listData = await listRes.json()
  const users = listData.users || []
  const match = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
  return match?.id || null
}

/** Permanently deletes the Supabase auth user; owned rows cascade via FKs. */
export async function deleteAuthUser(userId) {
  const url = supabaseUrl()
  const key = serviceRoleKey()
  if (!url || !key) return false
  const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  return res.ok || res.status === 404
}
