import { acquireAuthAttempt, phoneSignInSchema, verifyPhonePassword } from '@/app/lib/server/androidAuth'
import { issueIOSSession } from '@/app/lib/server/iosAuth'
import {
  PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Phone number and password (no SMS) → native app session for /api/ios/*.
export async function POST(request) {
  try {
    const parsed = phoneSignInSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '请填写有效的手机号和密码。')
    const release = acquireAuthAttempt(parsed.data.phone)
    try {
      const user = await verifyPhonePassword(parsed.data.phone, parsed.data.password)
      const session = await issueIOSSession(user.id)
      return practiceJSON({ ...session, account: { id: user.id, email: user.email, phone: user.phone, isPrivateEmail: false } })
    } finally { release() }
  } catch (error) { return practiceFailure(error) }
}
