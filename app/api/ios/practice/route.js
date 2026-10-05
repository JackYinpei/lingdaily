import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { practiceRequestSchema } from '@/app/lib/ios/practice'
import {
  performPracticeRequest, practiceModel, PracticeAPIError,
  practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'
import { getServerGeminiApiKey } from '@/app/lib/server/geminiConfig'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request) {
  try {
    await authorizeIOSRequest(request)
    if (!getServerGeminiApiKey()) throw new PracticeAPIError(503, 'NOT_CONFIGURED', '服务端尚未配置 AI。')
    return practiceJSON({ ok: true, model: practiceModel() })
  } catch (error) { return practiceFailure(error) }
}

export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    const parsed = practiceRequestSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '练习内容不完整，请重新开始。')
    return practiceJSON(await performPracticeRequest(parsed.data, userId))
  } catch (error) { return practiceFailure(error) }
}
