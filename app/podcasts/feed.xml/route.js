import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { loadManifest, renderFeedXml } from '@/app/lib/podcast/feed'
import { listPodcastEpisodes } from '@/app/lib/podcast/repository'

export const dynamic = 'force-dynamic'

const PODCAST_DIR = path.join(process.cwd(), 'public', 'podcasts')
const MANIFEST_PATH = path.join(PODCAST_DIR, 'manifest.json')
const LEGACY_FEED_PATH = path.join(PODCAST_DIR, 'feed.xml')

function feedResponse(xml) {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  })
}

export async function GET() {
  let databaseEpisodes = []
  let databaseError = null
  try {
    databaseEpisodes = await listPodcastEpisodes({ limit: 1000 })
  } catch (error) {
    databaseError = error
    console.warn('[podcasts/feed] Database unavailable; using legacy feed mirror.', error)
  }

  try {
    const manifest = await loadManifest(MANIFEST_PATH)
    const episodesById = new Map()
    for (const episode of manifest.episodes) episodesById.set(episode.id, episode)
    for (const episode of databaseEpisodes) episodesById.set(episode.id, episode)

    const episodes = [...episodesById.values()].sort(
      (a, b) => new Date(b.pubDate) - new Date(a.pubDate),
    )
    if (!databaseError || episodes.length > 0) {
      return feedResponse(renderFeedXml({ episodes }))
    }
  } catch (error) {
    console.warn('[podcasts/feed] Failed to rebuild feed from the legacy manifest.', error)
  }

  try {
    return feedResponse(await readFile(LEGACY_FEED_PATH, 'utf8'))
  } catch (error) {
    console.error('[podcasts/feed] Podcast feed is unavailable:', databaseError || error)
    return new Response('Podcast feed is unavailable', { status: 503 })
  }
}
