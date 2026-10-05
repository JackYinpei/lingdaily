import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { translationRequestSchema } from '@/app/lib/ios/practice'
import {
  performTranslationRequest, PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Translates one partner line on demand; same session boundary and per-user limits as practice.
export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    const parsed = translationRequestSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '这句话无法翻译。')
    return practiceJSON(await performTranslationRequest(parsed.data, userId))
  } catch (error) { return practiceFailure(error) }
}
