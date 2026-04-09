
import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"

const LinuxDo = {
  id: "linux-do",
  name: "Linux.do",
  type: "oauth",
  clientId: process.env.AUTH_LINUXDO_ID,
  clientSecret: process.env.AUTH_LINUXDO_SECRET,
  authorization: {
    url: "https://connect.linux.do/oauth2/authorize",
    params: {},
  },
  token: {
    url: "https://connect.linux.do/oauth2/token",
    async conform(response) {
      const body = await response.json()
      if (body.id_token) {
        delete body.id_token
        return new Response(JSON.stringify(body), response)
      }
    },
  },
  userinfo: "https://connect.linux.do/api/user",
  profile(profile) {
    return {
      id: String(profile.id || profile.sub),
      name: profile.name || profile.username || profile.login,
      email: profile.email || `${profile.username || profile.id}@linux.do`,
      image: profile.avatar_url || profile.picture || null,
    }
  },
  checks: ["state"],
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Ensure an OAuth user exists in Supabase auth.users via Admin API.
 * Returns the Supabase auth UUID so all tables can use a consistent user_id.
 */
async function ensureAuthUser({ email, name, image }) {
  if (!supabaseUrl || !supabaseServiceRoleKey || !email) return null

  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
  }

  // Try creating the user via Supabase Admin API
  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
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
    `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&page=1&per_page=10`,
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

async function signInWithSupabase(email, password) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY")
  }
  const url = `${supabaseUrl}/auth/v1/token?grant_type=password`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Common Supabase error codes/messages can be surfaced
    const message = data?.error_description || data?.msg || "Invalid credentials"
    throw new Error(message)
  }

  // data.user should contain supabase user info when successful
  const user = data?.user
  if (!user?.id || !user?.email) return null
  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name || user.email?.split("@")[0] || null,
    image: user.user_metadata?.avatar_url || null,
    // pass through Supabase tokens for RLS-backed DB access in API routes
    supabaseAccessToken: data?.access_token || null,
    supabaseRefreshToken: data?.refresh_token || null,
    supabaseTokenType: data?.token_type || null,
    supabaseExpiresIn: data?.expires_in || null,
  }
}

const providers = [
  Credentials({
    name: "Credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    authorize: async (credentials) => {
      const email = credentials?.email
      const password = credentials?.password
      if (!email || !password) return null
      try {
        const user = await signInWithSupabase(email, password)
        return user
      } catch (e) {
        // Return null to trigger CredentialsSignin; we also log for server insight
        console.error("Credentials authorize failed:", e?.message || e)
        return null
      }
    },
  }),
]

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.unshift(Google)
}

if (process.env.AUTH_LINUXDO_ID && process.env.AUTH_LINUXDO_SECRET) {
  providers.unshift(LinuxDo)
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers,
  trustHost: true,
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        if (user.supabaseAccessToken) {
          // Credentials user — already in auth.users
          token.uid = user.id
        } else if (user.email) {
          // OAuth user — ensure they exist in auth.users, use Supabase UUID
          try {
            const authId = await ensureAuthUser({
              email: user.email,
              name: user.name,
              image: user.image,
            })
            token.uid = authId || user.id
          } catch (e) {
            console.error('[auth] ensureAuthUser failed:', e?.message)
            token.uid = user.id
          }
        } else {
          token.uid = user.id
        }
      }
      if (user?.email) token.email = user.email
      if (user?.name) token.name = user.name
      if (user?.image) token.picture = user.image
      // propagate Supabase tokens (when signing in via Credentials)
      if (user?.supabaseAccessToken) token.supabaseAccessToken = user.supabaseAccessToken
      if (user?.supabaseRefreshToken) token.supabaseRefreshToken = user.supabaseRefreshToken
      if (user?.supabaseTokenType) token.supabaseTokenType = user.supabaseTokenType
      if (user?.supabaseExpiresIn) token.supabaseExpiresIn = user.supabaseExpiresIn
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid
        session.user.email = token.email
        session.user.name = token.name
        session.user.image = token.picture
      }
      // expose Supabase access token to server routes
      if (token?.supabaseAccessToken) session.supabaseAccessToken = token.supabaseAccessToken
      return session
    },
  },
})
