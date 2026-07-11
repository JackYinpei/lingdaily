import Link from 'next/link'
import { Headphones, Home } from 'lucide-react'
import { formatDuration } from '@/app/lib/podcast/feed'
import { listPodcastEpisodes } from '@/app/lib/podcast/repository'
import { normalizePodcastShownotes } from '@/app/lib/podcast/shownotes'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '成杨英语日刊 | LingDaily Podcasts',
  description: '每天十分钟，用中英双语了解国际、科技与商业热点。',
}

export default async function PodcastsPage() {
  let episodes = []
  let unavailable = false
  try {
    episodes = await listPodcastEpisodes({ limit: 100 })
  } catch (error) {
    unavailable = true
    console.error('[podcasts/page] Failed to load episodes:', error)
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-5 flex items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <Home className="size-4" /> LingDaily
          </Link>
          <a href="/podcasts/feed.xml" className="text-sm text-muted-foreground hover:text-foreground">RSS Feed</a>
        </div>
      </header>

      <div className="container mx-auto max-w-4xl px-4 py-12">
        <div className="flex items-center gap-3 mb-3">
          <Headphones className="size-8" />
          <h1 className="text-3xl md:text-4xl font-bold">成杨英语日刊</h1>
        </div>
        <p className="text-muted-foreground mb-10">每天十分钟，LL 和 DD 用自然英文和中文拆解全球热点。</p>

        {unavailable ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm">播客服务暂时不可用，请稍后再试。</div>
        ) : episodes.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">第一期节目正在准备中。</div>
        ) : (
          <div className="space-y-5">
            {episodes.map((episode) => {
              const shownotes = normalizePodcastShownotes(episode)
              return (
              <article key={episode.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                  <div>
                    <time className="text-xs text-muted-foreground">{episode.date}</time>
                    <h2 className="text-xl font-semibold mt-1">
                      <Link href={`/podcasts/${episode.date}`} className="hover:underline">{episode.title}</Link>
                    </h2>
                  </div>
                  <span className="text-xs rounded-full border border-border px-2 py-1">{formatDuration(episode.duration)}</span>
                </div>
                {shownotes.summaryZh && (
                  <p lang="zh-CN" className="text-sm text-muted-foreground leading-relaxed mb-2">{shownotes.summaryZh}</p>
                )}
                {shownotes.summaryEn && (
                  <p lang="en" className="text-sm text-muted-foreground leading-relaxed mb-4">{shownotes.summaryEn}</p>
                )}
                <audio controls preload="none" src={episode.audioUrl} className="w-full">Your browser does not support audio playback.</audio>
              </article>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
