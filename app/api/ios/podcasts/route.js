import { listPodcastEpisodes } from '@/app/lib/podcast/repository'
import { practiceFailure, PracticeAPIError } from '@/app/lib/server/iosPractice'
import { todayDTO } from '@/app/lib/server/iosToday'

export const dynamic = 'force-dynamic'

// Recent daily podcasts for the app's player, newest first, in the same shape as 「今日」
// (without a rehearsal). Public like /api/podcasts and the RSS feed; no model call.
export async function GET() {
  try {
    let episodes
    try { episodes = await listPodcastEpisodes({ limit: 30 }) }
    catch { throw new PracticeAPIError(503, 'PODCASTS_UNAVAILABLE', '播客列表暂时加载不了，请稍后再试。') }
    return Response.json({ episodes: episodes.filter(episode => episode?.date).map(episode => todayDTO(episode)) },
      { headers: { 'Cache-Control': 'public, max-age=300' } })
  } catch (error) { return practiceFailure(error) }
}
