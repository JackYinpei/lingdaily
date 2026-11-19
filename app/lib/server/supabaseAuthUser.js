import { getSupabaseAdminConfig } from './supabaseRest'

/**
 * Ensure an externally verified user exists in Supabase auth.users via Admin API.
 * Returns the Supabase auth UUID so all tables can use a consistent user_id.
 * Shared by web OAuth (NextAuth) and native iOS Sign in with Apple.
 */
export async function ensureAuthUser({ email, name, image }) {
  const admin = getSupabaseAdminConfig()
  if (!admin || !email) return null

  // Try creating the user via Supabase Admin API
  const createRes = await fetch(`${admin.baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: admin.headers({ 'Content-Type': 'application/json' }),
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

  // 422 means the email is already registered. Any other status is a real Admin API
  // failure; log it before the lookup so it is not mistaken for a duplicate user.
  if (createRes.status !== 422) {
    console.error('[auth] Supabase admin create user failed', { status: createRes.status })
  }
  return findAuthUserIdByEmail(email)
}

/** Looks up an existing Supabase auth user without creating one. */
export async function findAuthUserIdByEmail(email) {
  const admin = getSupabaseAdminConfig()
  if (!admin || !email) return null
  const listRes = await fetch(
    `${admin.baseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&page=1&per_page=10`,
    { method: 'GET', headers: admin.headers() },
  )
  if (!listRes.ok) return null
  const listData = await listRes.json()
  const users = listData.users || []
  const match = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
  return match?.id || null
}

/** Permanently deletes the Supabase auth user; owned rows cascade via FKs. */
export async function deleteAuthUser(userId) {
  const admin = getSupabaseAdminConfig()
  if (!admin) return false
  const res = await fetch(`${admin.baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE', headers: admin.headers(),
  })
  return res.ok || res.status === 404
}

/** Email of a Supabase auth user (admin views only), or null. */
export async function authUserEmail(userId) {
  const admin = getSupabaseAdminConfig()
  if (!admin) return null
  const res = await fetch(`${admin.baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: admin.headers(),
  })
  if (!res.ok) return null
  return (await res.json())?.email || null
}
