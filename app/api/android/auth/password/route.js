import { acquireAuthAttempt, passwordSignInSchema, verifyPassword } from '@/app/lib/server/androidAuth'
import { issueIOSSession } from '@/app/lib/server/iosAuth'
import {
  PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Email and password (the web app's account) → native app session for /api/ios/*.
export async function POST(request) {
  try {
    const parsed = passwordSignInSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '请填写邮箱和密码。')
    const release = acquireAuthAttempt(parsed.data.email)
    try {
      const user = await verifyPassword(parsed.data.email, parsed.data.password)
      const session = await issueIOSSession(user.id)
      return practiceJSON({ ...session, account: { id: user.id, email: user.email, isPrivateEmail: false } })
    } finally { release() }
  } catch (error) { return practiceFailure(error) }
}
