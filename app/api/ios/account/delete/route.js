import { z } from 'zod'
import { revokeAppleAuthorization } from '@/app/lib/server/appleRevoke'
import { authorizeIOSRequest, verifyAppleIdentityToken } from '@/app/lib/server/iosAuth'
import {
  PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'
import { deleteAccountData } from '@/app/lib/server/iosSync'
import { deleteAuthUser, findAuthUserIdByEmail } from '@/app/lib/server/supabaseAuthUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const deleteSchema = z.object({
  identityToken: z.string().min(20).max(8192),
  nonce: z.string().min(16).max(128),
  authorizationCode: z.string().min(1).max(2048).optional(),
}).strict()

/**
 * Permanently deletes the LingDaily account (App Store Review Guideline 5.1.1(v)).
 * The account is shared with the web app, so this removes web data too.
 * Requires a fresh Sign in with Apple confirmation for the same account.
 */
export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    if (userId === 'local-development') throw new PracticeAPIError(400, 'NO_ACCOUNT', '本机开发模式没有可删除的账号。')
    const parsed = deleteSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '删除请求不完整，请重试。')
    const apple = await verifyAppleIdentityToken(parsed.data.identityToken, parsed.data.nonce)
    if (await findAuthUserIdByEmail(apple.email) !== userId) {
      throw new PracticeAPIError(403, 'ACCOUNT_MISMATCH', '确认用的 Apple ID 与当前登录账号不一致。')
    }
    const revocation = await revokeAppleAuthorization(parsed.data.authorizationCode)
    if (revocation === 'failed') console.error('[ios-account] Apple authorization revocation failed')
    await deleteAccountData(userId)
    if (!await deleteAuthUser(userId)) {
      throw new PracticeAPIError(502, 'DELETE_INCOMPLETE', '账号数据已删除，但账号本身暂时没删掉，请稍后再试一次。')
    }
    return practiceJSON({ deleted: true })
  } catch (error) { return practiceFailure(error) }
}
