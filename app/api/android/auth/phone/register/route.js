import { acquireAuthAttempt, phoneRegisterSchema, registerWithPhone } from '@/app/lib/server/androidAuth'
import { issueIOSSession } from '@/app/lib/server/iosAuth'
import {
  PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// New phone-number account from the Android app. No SMS is sent: the number is a login
// name, recorded on the Supabase user, and the account is signed in at once.
export async function POST(request) {
  try {
    const parsed = phoneRegisterSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '请填写有效的手机号，密码至少 6 位。')
    const release = acquireAuthAttempt(parsed.data.phone)
    try {
      const user = await registerWithPhone(parsed.data.phone, parsed.data.password)
      const session = await issueIOSSession(user.id)
      return practiceJSON({ ...session, account: { id: user.id, email: user.email, phone: user.phone, isPrivateEmail: false } })
    } finally { release() }
  } catch (error) { return practiceFailure(error) }
}
