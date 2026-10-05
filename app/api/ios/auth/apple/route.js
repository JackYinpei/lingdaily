import { z } from 'zod'
import { issueIOSSession, verifyAppleIdentityToken } from '@/app/lib/server/iosAuth'
import {
  PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'
import { ensureAuthUser } from '@/app/lib/server/supabaseAuthUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const signInSchema = z.object({
  identityToken: z.string().min(20).max(8192),
  nonce: z.string().min(16).max(128),
  // Apple only returns the name on the very first authorization.
  fullName: z.string().trim().max(100).optional(),
}).strict()

// Native Sign in with Apple → Supabase auth user → iOS session token for /api/ios/*.
export async function POST(request) {
  try {
    const parsed = signInSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '登录请求不完整，请重试。')
    const { identityToken, nonce, fullName } = parsed.data
    const apple = await verifyAppleIdentityToken(identityToken, nonce)
    let userId = null
    try { userId = await ensureAuthUser({ email: apple.email, name: fullName || null, image: null }) }
    catch { /* Reported below without upstream details. */ }
    if (!userId) throw new PracticeAPIError(503, 'ACCOUNT_UNAVAILABLE', '暂时无法完成登录，请稍后重试。')
    const session = await issueIOSSession(userId)
    return practiceJSON({ ...session, account: { id: userId, email: apple.email, isPrivateEmail: apple.isPrivateEmail } })
  } catch (error) { return practiceFailure(error) }
}
