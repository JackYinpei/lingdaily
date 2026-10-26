import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { practiceFailure, practiceJSON } from '@/app/lib/server/iosPractice'
import { performTodayRequest } from '@/app/lib/server/iosToday'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// The latest daily podcast and a shared rehearsal about it. Behind the iOS
// session because the first request of a day may trigger one model call.
export async function GET(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    return practiceJSON(await performTodayRequest(userId))
  } catch (error) { return practiceFailure(error) }
}
