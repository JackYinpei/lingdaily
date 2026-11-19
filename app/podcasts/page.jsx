import Link from 'next/link'
import { ArrowUpRight, AudioLines, Clock3, Headphones, Rss } from 'lucide-react'
import FeatureShell, { FeatureHeading } from '@/app/components/FeatureShell'
import { formatDuration } from '@/app/lib/podcast/feed'
import { listPodcastEpisodes } from '@/app/lib/podcast/repository'
import { normalizePodcastShownotes } from '@/app/lib/podcast/shownotes'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '成杨英语日刊 | LingDaily Podcasts',
  description: 'LL 和 DD 的中英双语新闻播客，关注国际、科技与商业。',
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
      <FeatureHeading number="04" eyebrow="成杨英语日刊" title={'耳朵先迎接\n新一天'} description={'LL 和 DD 陪你听新闻\n中英双语交替播报'} />
      <section className="feature-podcast-intro" aria-label="节目介绍">
        <div className="feature-podcast-art" aria-hidden="true"><AudioLines strokeWidth={1.2} size={28} /><strong>LL / DD</strong><span>LINGDAILY RADIO</span></div>
        <div className="self-center">
          <p className="feature-eyebrow mb-3"><Headphones size={14} aria-hidden="true" /> 中英双语</p>
          <h2 className="flex flex-wrap gap-x-4 text-xl mb-3 font-medium"><span>国际</span><span>科技</span><span>商业</span></h2>
          <p className="text-sm leading-7 text-muted-foreground max-w-xl">直接收听节目<br />也可以查看双语摘要和词汇表</p>
        </div>
      </section>
      <div>
        <div className="feature-toolbar">
          <div><h2 className="feature-eyebrow">往期节目</h2><span className="feature-count">共 {episodes.length} 期</span></div>
          <a href="/podcasts/feed.xml" className="feature-text-link"><Rss size={15} aria-hidden="true" /> 订阅 RSS</a>
        </div>
        {unavailable ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm">播客服务暂时不可用，请稍后再试。</div>
        ) : episodes.length === 0 ? (
          <div className="feature-empty"><Headphones aria-hidden="true" /><h2>暂无节目</h2><p>节目发布后会显示在这里。</p></div>
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
                      <Link href={`/podcasts/${episode.date}`} className="feature-episode-link hover:text-primary">{episode.title}<ArrowUpRight size={17} aria-hidden="true" /></Link>
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
