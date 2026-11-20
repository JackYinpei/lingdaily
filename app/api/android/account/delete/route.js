import { acquireAuthAttempt, passwordConfirmSchema, verifyPassword } from '@/app/lib/server/androidAuth'
import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import {
  PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'
import { deleteAccountData } from '@/app/lib/server/iosSync'
import { authUserEmail, deleteAuthUser } from '@/app/lib/server/supabaseAuthUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Permanently deletes the LingDaily account from the Android app (Google Play requires
 * deletion inside the app). The account is shared with the web and iOS apps, so their
 * data goes too. Requires the account's password again; never answers 401 for a wrong
 * password, because the app treats 401 as an expired session and signs out.
 */
export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    if (userId === 'local-development') throw new PracticeAPIError(400, 'NO_ACCOUNT', '本机开发模式没有可删除的账号。')
    const parsed = passwordConfirmSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '请输入密码确认删除。')
    const release = acquireAuthAttempt(userId)
    try {
      const email = await authUserEmail(userId)
      if (!email) throw new PracticeAPIError(503, 'ACCOUNT_UNAVAILABLE', '暂时无法确认账号，请稍后重试。')
      let confirmed
      try { confirmed = await verifyPassword(email, parsed.data.password) } catch (error) {
        if (error?.code !== 'INVALID_CREDENTIALS') throw error
        throw new PracticeAPIError(403, 'WRONG_PASSWORD', '密码不正确，账号没有删除。')
      }
      if (confirmed.id !== userId) throw new PracticeAPIError(403, 'ACCOUNT_MISMATCH', '确认用的账号与当前登录账号不一致。')
      await deleteAccountData(userId)
      if (!await deleteAuthUser(userId)) {
        throw new PracticeAPIError(502, 'DELETE_INCOMPLETE', '账号数据已删除，但账号本身暂时没删掉，请稍后再试一次。')
      }
      return practiceJSON({ deleted: true })
    } finally { release() }
  } catch (error) { return practiceFailure(error) }
}
