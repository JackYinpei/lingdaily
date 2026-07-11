import {
  getPodcastEpisode,
  listPodcastEpisodes,
} from '@/app/lib/podcast/repository'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return Response.json({ error: 'date must use YYYY-MM-DD' }, { status: 400 })
      }
      return Response.json({ ok: true, data: await getPodcastEpisode(date) })
    }

    const limit = searchParams.get('limit') || '50'
    if (!/^\d+$/.test(limit) || Number(limit) < 1) {
      return Response.json({ error: 'limit must be a positive integer' }, { status: 400 })
    }
    return Response.json({ ok: true, data: await listPodcastEpisodes({ limit }) })
  } catch (error) {
    console.error('[podcasts] Failed to load episodes:', error)
    return Response.json({ error: 'Podcast service is unavailable' }, { status: 503 })
  }
}
