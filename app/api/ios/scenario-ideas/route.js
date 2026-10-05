import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { ideasRequestSchema } from '@/app/lib/ios/practice'
import {
  performIdeasRequest, PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// "换一批" on the new-scenario page: three fresh ideas, avoiding ones already shown.
export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    const parsed = ideasRequestSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '请求格式不正确。')
    return practiceJSON(await performIdeasRequest(parsed.data, userId))
  } catch (error) { return practiceFailure(error) }
}
