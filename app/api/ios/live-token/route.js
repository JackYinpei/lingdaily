import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { liveTokenRequestSchema } from '@/app/lib/ios/live'
import { performLiveTokenRequest } from '@/app/lib/server/iosLive'
import {
  PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    const parsed = liveTokenRequestSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '语音场景不完整，请重新开始。')
    return practiceJSON(await performLiveTokenRequest(parsed.data, userId))
  } catch (error) { return practiceFailure(error) }
}
