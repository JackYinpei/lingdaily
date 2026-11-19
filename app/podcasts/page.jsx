import Link from 'next/link'
import { ArrowUpRight, AudioLines, Clock3, Headphones, Rss } from 'lucide-react'
import FeatureShell, { FeatureHeading } from '@/app/components/FeatureShell'
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
    episodes = await listPodcastEpisodes({ limit: 100, listView: true })
  } catch (error) {
    unavailable = true
    console.error('[podcasts/page] Failed to load episodes:', error)
  }

  return (
    <FeatureShell active="podcasts">
      <FeatureHeading number="04" eyebrow="The daily listening room · 每日听读" title="成杨英语日刊" description="每天十分钟，LL 和 DD 用自然英文和中文拆解全球热点。">
        <a href="/podcasts/feed.xml" className="feature-action shrink-0"><Rss size={15} aria-hidden="true" /> RSS Feed</a>
      </FeatureHeading>
      <section className="feature-podcast-intro" aria-label="节目介绍">
        <div className="feature-podcast-art" aria-hidden="true"><AudioLines strokeWidth={1.2} size={28} /><strong>LL / DD</strong><span>LINGDAILY RADIO</span></div>
        <div className="self-center">
          <p className="feature-eyebrow mb-3"><Headphones size={14} aria-hidden="true" /> NEWS, IN TWO LANGUAGES</p>
          <h2 className="text-xl mb-3 font-medium">听见世界，也听懂英语。</h2>
          <p className="text-sm leading-7 text-muted-foreground max-w-xl">国际、科技与商业热点，中英双语交替。听一段，读一段，把新闻里的表达带进自己的对话。</p>
        </div>
      </section>
      <div>
        <div className="feature-toolbar"><h2 className="feature-eyebrow">EPISODE ARCHIVE · 往期节目</h2><span className="feature-count">{episodes.length} episodes</span></div>
        {unavailable ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm">播客服务暂时不可用，请稍后再试。</div>
        ) : episodes.length === 0 ? (
          <div className="feature-empty"><Headphones aria-hidden="true" /><h2>第一期节目正在准备中。</h2><p>下次回来，听听今天的世界。</p></div>
        ) : (
          <div>
            {episodes.map((episode) => {
              const shownotes = normalizePodcastShownotes(episode)
              return (
              <article key={episode.id} className="feature-episode">
                <time className="feature-episode-date" dateTime={episode.date}>{episode.date}</time>
                <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <h2>
                      <Link href={`/podcasts/${episode.date}`} className="hover:text-primary">{episode.title}<ArrowUpRight size={17} className="inline ml-2" aria-hidden="true" /></Link>
                    </h2>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock3 size={13} aria-hidden="true" />{formatDuration(episode.duration)}</span>
                </div>
                {shownotes.summaryZh && (
                  <p lang="zh-CN" className="text-sm text-muted-foreground leading-relaxed mb-2">{shownotes.summaryZh}</p>
                )}
                {shownotes.summaryEn && (
                  <p lang="en" className="text-sm text-muted-foreground leading-relaxed mb-4">{shownotes.summaryEn}</p>
                )}
                <audio aria-label={episode.title} controls preload="none" src={episode.audioUrl}>Your browser does not support audio playback.</audio>
                </div>
              </article>
              )
            })}
          </div>
        )}
      </div>
    </FeatureShell>
  )
}
