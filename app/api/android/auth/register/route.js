import { acquireAuthAttempt, passwordRegisterSchema, registerWithPassword } from '@/app/lib/server/androidAuth'
import { issueIOSSession } from '@/app/lib/server/iosAuth'
import {
  PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// New email/password account from the Android app. Signed in at once when Supabase
// allows it; otherwise the app asks the learner to confirm the address by email.
export async function POST(request) {
  try {
    const parsed = passwordRegisterSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '请填写有效的邮箱，密码至少 6 位。')
    const release = acquireAuthAttempt(parsed.data.email)
    try {
      const user = await registerWithPassword(parsed.data.email, parsed.data.password)
      if (!user) return practiceJSON({ confirmationRequired: true })
      const session = await issueIOSSession(user.id)
      return practiceJSON({ ...session, account: { id: user.id, email: user.email, isPrivateEmail: false } })
    } finally { release() }
  } catch (error) { return practiceFailure(error) }
}
