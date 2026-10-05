import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { scenarioRequestSchema } from '@/app/lib/ios/practice'
import {
  performScenarioRequest, PracticeAPIError,
  practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Same Apple-session (or local pairing) boundary as /api/ios/practice. Nothing is stored server-side.
export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    const parsed = scenarioRequestSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '请用一两句话描述想练的场景（300 字以内）。')
    return practiceJSON(await performScenarioRequest(parsed.data, userId))
  } catch (error) { return practiceFailure(error) }
}
