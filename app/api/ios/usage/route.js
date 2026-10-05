import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import {
  PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'
import { liveUsageReportSchema, recordLiveUsage, usageSummary } from '@/app/lib/server/aiUsage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function accountUser(request) {
  const { userId } = await authorizeIOSRequest(request)
  if (userId === 'local-development') throw new PracticeAPIError(400, 'NO_ACCOUNT', '本机开发模式不记录用量。')
  return userId
}

const DAY = 86_400_000
const tokensOnly = ({ cost: _cost, unpriced: _unpriced, ...group }) => group

// The learner's own token usage (no prices: those are operator information).
export async function GET(request) {
  try {
    const userId = await accountUser(request)
    const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30))
    let summary
    try { summary = await usageSummary({ since: new Date(Date.now() - days * DAY), userId }) }
    catch { throw new PracticeAPIError(502, 'USAGE_UNAVAILABLE', '暂时读不到用量，请稍后再试。') }
    return practiceJSON({
      days, total: tokensOnly(summary.total),
      byFeature: summary.byFeature.map(tokensOnly), byDay: summary.byDay.map(tokensOnly),
    })
  } catch (error) { return practiceFailure(error) }
}

// Live usage the app summed over one connection (the audio never passes through this server).
export async function POST(request) {
  try {
    const userId = await accountUser(request)
    const parsed = liveUsageReportSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '用量格式不正确。')
    await recordLiveUsage(userId, parsed.data)
    return practiceJSON({ recorded: true })
  } catch (error) { return practiceFailure(error) }
}
