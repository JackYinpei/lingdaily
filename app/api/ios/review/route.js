import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { sentenceReviewRequestSchema } from '@/app/lib/ios/review'
import { performSentenceReviewRequest, PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON } from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    const parsed = sentenceReviewRequestSchema.safeParse(await readBoundedJSON(request, 96 * 1024))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '复盘内容不完整，请重试。')
    return practiceJSON(await performSentenceReviewRequest(parsed.data, userId))
  } catch (error) { return practiceFailure(error) }
}
