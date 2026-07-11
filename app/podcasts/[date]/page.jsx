import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { formatDuration } from '@/app/lib/podcast/feed'
import { getPodcastEpisode } from '@/app/lib/podcast/repository'

export const dynamic = 'force-dynamic'

export default async function PodcastEpisodePage({ params }) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  let episode
  try {
    episode = await getPodcastEpisode(date)
  } catch (error) {
    console.error('[podcasts/episode] Failed to load episode:', error)
  }
  if (!episode) notFound()

  const chunks = Array.isArray(episode.content?.chunks) ? episode.content.chunks : []
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-3xl px-4 py-10">
        <Link href="/podcasts" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="size-4" /> 返回播客列表
        </Link>

        <time className="text-sm text-muted-foreground">{episode.date}</time>
        <h1 className="text-3xl font-bold mt-2 mb-3">{episode.title}</h1>
        <p className="text-muted-foreground leading-relaxed mb-6">{episode.summary}</p>
        <div className="text-xs text-muted-foreground mb-2">时长 {formatDuration(episode.duration)}</div>
        <audio controls preload="metadata" src={episode.audioUrl} className="w-full mb-10">Your browser does not support audio playback.</audio>

        <section className="space-y-8" aria-labelledby="transcript-heading">
          <h2 id="transcript-heading" className="text-2xl font-semibold">完整文稿</h2>
          {chunks.length > 0 ? chunks.map((chunk) => (
            <div key={chunk.name} className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-semibold uppercase tracking-wide text-sm mb-4">{chunk.name}</h3>
              <div className="space-y-4">
                {chunk.turns?.map((turn, index) => (
                  <p key={`${turn.speaker}-${index}`} className="leading-relaxed">
                    <strong>{turn.speaker}:</strong> {turn.text}
                  </p>
                ))}
              </div>
            </div>
          )) : (
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-card p-5 text-sm leading-relaxed">{episode.script}</pre>
          )}
        </section>
      </div>
    </main>
  )
}
