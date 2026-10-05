import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { suggestionRequestSchema } from '@/app/lib/ios/practice'
import {
  performSuggestionRequest, PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Reply idea for a learner who is stuck in a Live call; same session boundary and per-user limits.
export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    const parsed = suggestionRequestSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '对话内容不完整，暂时无法给建议。')
    return practiceJSON(await performSuggestionRequest(parsed.data, userId))
  } catch (error) { return practiceFailure(error) }
}
