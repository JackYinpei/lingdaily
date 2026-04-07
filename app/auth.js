
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
    params: { scope: "openid" },
  },
  token: "https://connect.linux.do/oauth2/token",
  userinfo: "https://connect.linux.do/api/user",
  profile(profile) {
    return {
      id: String(profile.id),
      name: profile.name || profile.username || profile.login,
      email: profile.email,
      image: profile.avatar_url || profile.picture,
    }
  },
  checks: ["state"],
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

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
      if (user?.id) token.uid = user.id
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
