import Link from 'next/link'
import { Button } from '@/app/components/ui/button'
import { Badge } from '@/app/components/ui/badge'
import {
  MessageCircle,
  Sparkles,
  Zap,
  Target,
  CalendarDays,
  Headphones,
  MessagesSquare,
  BookOpen,
  ArrowRight,
} from 'lucide-react'
import StartLearningWithLanguage from '@/app/components/StartLearningWithLanguage'
import ThemeToggle from '@/app/components/ThemeToggle'
import HeroVideoDemo from '@/app/components/HeroVideoDemo'
import MobileNav from '@/app/components/MobileNav'
import AuroraBackground from '@/app/components/home/AuroraBackground'
import HeroPreview from '@/app/components/home/HeroPreview'
import StatsPanel from '@/app/components/home/StatsPanel'

const I18N = {
  en: {
    nav: { features: 'Features', how: 'How it Works', reviews: 'Reviews', podcasts: 'Podcasts', startLearning: 'Start Learning', signIn: 'Sign In', signOut: 'Sign Out', talk: 'Talk', history: 'History', progress: 'Progress' },
    hero: {
      badge: 'AI-Powered English Learning',
      h1Prefix: 'Talk with AI,',
      h1Highlight: 'learn English naturally',
      desc: 'Learn English through real-time conversations about the day’s news. Practice speaking, grow your vocabulary, and get personalized feedback.',
      primaryBtn: 'Start Free Conversation',
      secondaryBtn: 'Watch Demo',
      chips: ['Live news chat', 'Personalized correction', 'Daily updates'],
    },
    preview: { title: 'AI Conversation', streak: '18-day streak', topic: 'Today’s Topic', source: 'Source', correctTitle: 'AI Correction & Tips', correctBody: 'Try a more inspiring phrasing:', grammar: 'Grammar' },
    today: { title: 'Today’s Progress', goal: 'Goal 30 min', minutes: 'Study time', min: 'min' },
    vocab: { title: 'Vocabulary Mastery', known: 'Known words', rate: 'Mastery' },
    week: { title: 'This Week', total: 'Total', days: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] },
    features: {
      title: 'Everything you need to learn',
      subtitle: 'Real conversations, real news, real progress',
      cards: [
        { icon: 'headphones', title: 'Daily AI News Podcast', desc: 'A fresh podcast generated daily from the latest topics, so you stay immersed in English.', tags: ['Native voices', 'CN/EN subtitles', 'Line-by-line'], href: '/podcasts' },
        { icon: 'chat', title: 'Immersive Conversation', desc: 'Have real conversations with AI around news topics and get instant feedback on your speaking.', tags: ['Live chat', 'Smart correction', 'Speaking score'], href: '/talk' },
        { icon: 'book', title: 'Vocabulary & Expressions', desc: 'Automatically extract high-frequency words and idiomatic phrases into your personal lexicon.', tags: ['Word bank', 'Examples', 'Spaced review'], href: '/vocabulary' },
      ],
    },
    cta: { title: 'Ready to master English?', subtitle: 'Join thousands of learners improving through AI conversations', primaryBtn: 'Start Your Free Conversation', note: 'No credit card required • Start learning immediately' },
    footer: { tagline: 'AI-powered English learning through news conversations', features: 'Features', learning: 'Learning', support: 'Support', aiConversations: 'AI Conversations', newsTopics: 'News Topics', progressTracking: 'Progress Tracking', startLearning: 'Start Learning', conversationHistory: 'Conversation History', tipsGuides: 'Tips & Guides', helpCenter: 'Help Center', contactUs: 'Contact Us', privacy: 'Privacy Policy', rights: 'All rights reserved.' },
    start: { learningLabel: 'Learning', nativeLabel: 'Native' },
  },
  zh: {
    nav: { features: '功能', how: '使用方式', reviews: '评价', podcasts: '播客', startLearning: '开始学习', signIn: '登录', signOut: '退出登录', talk: '对话', history: '历史', progress: '进度' },
    hero: {
      badge: 'AI 驱动的英语学习',
      h1Prefix: '和 AI 对话，',
      h1Highlight: '自然学会英语',
      desc: '通过与 AI 围绕实时新闻进行对话学习英语。练习口语、提升词汇量，并获得个性化反馈。',
      primaryBtn: '开始免费对话',
      secondaryBtn: '观看演示',
      chips: ['实时新闻对话', '个性化纠错', '每日更新'],
    },
    preview: { title: 'AI 对话练习', streak: '连续学习 18 天', topic: '今日话题', source: '来源', correctTitle: 'AI 纠错与建议', correctBody: '建议使用更具启发的表达：', grammar: '语法' },
    today: { title: '今日学习进度', goal: '目标 30 分钟', minutes: '学习时长', min: '分钟' },
    vocab: { title: '词汇掌握', known: '熟悉单词', rate: '掌握率' },
    week: { title: '本周学习量表', total: '累计时长', days: ['一', '二', '三', '四', '五', '六', '日'] },
    features: {
      title: '你需要的一切，都在这里',
      subtitle: '真实对话、真实新闻、真实进步',
      cards: [
        { icon: 'headphones', title: '每日 AI 新闻播客', desc: '通过涵盖最新话题的每日生成播客，让自己沉浸在英语语境中。', tags: ['原生发音', '中英字幕', '逐句精听'], href: '/podcasts' },
        { icon: 'chat', title: '沉浸式对话练习', desc: '与 AI 围绕新闻话题进行真实对话，获得即时反馈，提升口语能力。', tags: ['实时对话', '智能纠错', '口语评分'], href: '/talk' },
        { icon: 'book', title: '词汇与表达积累', desc: '自动提取高频词汇与地道表达，构建属于你的个性化词库。', tags: ['生词本', '例句库', '记忆复习'], href: '/vocabulary' },
      ],
    },
    cta: { title: '准备好掌握英语了吗？', subtitle: '加入数千学员，通过 AI 对话不断提升英语', primaryBtn: '开始你的免费对话', note: '无需信用卡 • 立即开始学习' },
    footer: { tagline: '通过新闻对话，AI 驱动的英语学习', features: '功能', learning: '学习', support: '支持', aiConversations: 'AI 对话', newsTopics: '新闻话题', progressTracking: '进度追踪', startLearning: '开始学习', conversationHistory: '对话历史', tipsGuides: '技巧与指南', helpCenter: '帮助中心', contactUs: '联系我们', privacy: '隐私政策', rights: '版权所有。' },
    start: { learningLabel: '学习语言', nativeLabel: '母语' },
  },
  ja: {
    nav: { features: '機能', how: '使い方', reviews: 'レビュー', podcasts: 'ポッドキャスト', startLearning: '学習を始める', signIn: 'サインイン', signOut: 'サインアウト', talk: '会話', history: '履歴', progress: '進捗' },
    hero: {
      badge: 'AI で英語学習',
      h1Prefix: 'AIと会話して、',
      h1Highlight: '自然に英語を学ぶ',
      desc: 'ニュースに関するリアルタイム会話で英語を習得。スピーキング練習、語彙力アップ、個別フィードバックを得られます。',
      primaryBtn: '無料で会話を開始',
      secondaryBtn: 'デモを見る',
      chips: ['ニュース会話', '個別の添削', '毎日更新'],
    },
    preview: { title: 'AI 会話練習', streak: '18日連続', topic: '今日のトピック', source: '出典', correctTitle: 'AI 添削とヒント', correctBody: 'より印象的な言い回し：', grammar: '文法' },
    today: { title: '今日の進捗', goal: '目標 30 分', minutes: '学習時間', min: '分' },
    vocab: { title: '語彙の習得', known: '既知の単語', rate: '習得率' },
    week: { title: '今週の学習量', total: '合計', days: ['月', '火', '水', '木', '金', '土', '日'] },
    features: {
      title: '学習に必要なすべて',
      subtitle: '本物の会話、本物のニュース、本物の上達',
      cards: [
        { icon: 'headphones', title: 'デイリーAIニュースポッドキャスト', desc: '最新トピックから毎日生成されるポッドキャストで英語に浸りましょう。', tags: ['ネイティブ音声', '日英字幕', '一文ずつ'], href: '/podcasts' },
        { icon: 'chat', title: '没入型の会話練習', desc: 'ニュースを題材にAIと本物の会話をし、スピーキングへの即時フィードバックを得られます。', tags: ['ライブ会話', 'スマート添削', '発話スコア'], href: '/talk' },
        { icon: 'book', title: '語彙と表現の蓄積', desc: '高頻度語や自然な表現を自動抽出し、あなただけの語彙帳を作ります。', tags: ['単語帳', '例文', '復習'], href: '/vocabulary' },
      ],
    },
    cta: { title: '英語をマスターする準備はできた？', subtitle: '何千人もの学習者が AI 会話で英語力を向上', primaryBtn: '無料で会話を開始', note: 'クレジットカード不要 • 今すぐ始められます' },
    footer: { tagline: 'ニュース会話による AI 英語学習', features: '機能', learning: '学習', support: 'サポート', aiConversations: 'AI 会話', newsTopics: 'ニューストピック', progressTracking: '進捗トラッキング', startLearning: '学習を始める', conversationHistory: '会話履歴', tipsGuides: 'ヒントとガイド', helpCenter: 'ヘルプセンター', contactUs: 'お問い合わせ', privacy: 'プライバシーポリシー', rights: '無断転載禁止。' },
    start: { learningLabel: '学習言語', nativeLabel: '母語' },
  },
}

const DEFAULT_LOCALE = 'en'
const CARD_ICONS = { headphones: Headphones, chat: MessagesSquare, book: BookOpen }
const HERO_CHIP_ICONS = [Zap, Target, CalendarDays]

export default function HomePageClient({ signedIn, signOutAction, locale = DEFAULT_LOCALE }) {
  const normalizedLocale = I18N[locale] ? locale : DEFAULT_LOCALE
  const t = I18N[normalizedLocale]
  const talkHref = signedIn ? '/talk' : '/sign-in?callbackUrl=%2Ftalk'
  const historyHref = signedIn ? '/history' : '/sign-in?callbackUrl=%2Fhistory'
  const progressHref = signedIn ? '/progress' : '/sign-in?callbackUrl=%2Fprogress'

  return (
    <div className="relative min-h-screen text-foreground">
      <AuroraBackground />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-from to-brand-to text-white">
                <MessageCircle className="size-5" />
              </span>
              <span className="text-xl font-bold">LingDaily</span>
            </div>
            {/* Desktop nav — from lg up */}
            <nav className="hidden items-center gap-4 lg:flex">
              {signedIn ? (
                <>
                  <Link href={talkHref} className="text-muted-foreground transition-colors hover:text-foreground">{t.nav.talk}</Link>
                  <Link href="/podcasts" className="text-muted-foreground transition-colors hover:text-foreground">{t.nav.podcasts}</Link>
                  <Link href={historyHref} className="text-muted-foreground transition-colors hover:text-foreground">{t.nav.history}</Link>
                  <Link href={progressHref} className="text-muted-foreground transition-colors hover:text-foreground">{t.nav.progress}</Link>
                  <ThemeToggle />
                  <form action={signOutAction}>
                    <Button variant="outline" className="font-semibold">{t.nav.signOut}</Button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="#features" className="whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground">{t.nav.features}</Link>
                  <Link href="/podcasts" className="whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground">{t.nav.podcasts}</Link>
                  <StartLearningWithLanguage startLabel={t.nav.startLearning} learningLabel={t.start.learningLabel} nativeLabel={t.start.nativeLabel} />
                  <ThemeToggle />
                  <Link href="/sign-in">
                    <Button variant="outline" className="whitespace-nowrap font-semibold">{t.nav.signIn}</Button>
                  </Link>
                </>
              )}
            </nav>
            <MobileNav t={t} signedIn={signedIn} signOutAction={signOutAction} />
          </div>
        </div>
      </header>

      <main id="content" className="flex flex-col">
        {/* Hero */}
        <section className="container mx-auto px-4 py-12 lg:py-20" aria-labelledby="hero-heading">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-8">
            {/* left */}
            <div>
              <Badge variant="secondary" className="mb-5 gap-1.5 border border-brand/20 bg-brand/10 text-brand">
                <Sparkles className="size-3.5" /> {t.hero.badge}
              </Badge>
              <h1 id="hero-heading" className="text-4xl font-bold leading-tight sm:text-5xl xl:text-6xl">
                {t.hero.h1Prefix}
                <span className="mt-1 block bg-gradient-to-r from-brand-from via-brand-via to-brand-to bg-clip-text text-transparent">
                  {t.hero.h1Highlight}
                </span>
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">{t.hero.desc}</p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link href={talkHref}>
                  <Button size="lg" className="bg-gradient-to-r from-brand-from to-brand-to px-8 font-semibold text-white shadow-lg hover:opacity-90">
                    {t.hero.primaryBtn}
                    <ArrowRight className="ml-1 size-5" />
                  </Button>
                </Link>
                <HeroVideoDemo buttonLabel={t.hero.secondaryBtn} />
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
                {t.hero.chips.map((chip, i) => {
                  const Icon = HERO_CHIP_ICONS[i]
                  return (
                    <span key={chip} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon className="size-4 text-brand" aria-hidden /> {chip}
                    </span>
                  )
                })}
              </div>
            </div>

            {/* right: preview + stats */}
            <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr] lg:gap-4">
              <HeroPreview t={t} />
              <StatsPanel t={t} />
            </div>
          </div>
        </section>

        {/* Feature cards */}
        <section id="features" className="container mx-auto px-4 py-16" aria-labelledby="features-heading">
          <div className="mb-12 text-center">
            <h2 id="features-heading" className="text-3xl font-bold sm:text-4xl">{t.features.title}</h2>
            <p className="mt-3 text-lg text-muted-foreground">{t.features.subtitle}</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {t.features.cards.map((card) => {
              const Icon = CARD_ICONS[card.icon] || MessagesSquare
              return (
                <Link
                  key={card.title}
                  href={card.href}
                  className="group flex flex-col rounded-2xl border border-border bg-card/70 p-6 backdrop-blur transition-colors hover:border-brand/40 hover:bg-card"
                >
                  <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-from/20 to-brand-to/20 text-brand">
                    <Icon className="size-7" aria-hidden />
                  </span>
                  <h3 className="text-xl font-semibold">{card.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{card.desc}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {card.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">{tag}</span>
                    ))}
                    <ArrowRight className="ml-auto size-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-brand" aria-hidden />
                  </div>
                </Link>
              )
            })}
          </div>
        </section>

        {/* CTA */}
        <section className="container mx-auto px-4 py-16" aria-labelledby="cta-heading">
          <div className="mx-auto max-w-3xl rounded-3xl border border-brand/20 bg-gradient-to-br from-brand-from/10 via-brand-via/10 to-brand-to/10 p-10 text-center backdrop-blur">
            <h2 id="cta-heading" className="text-3xl font-bold sm:text-4xl">{t.cta.title}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">{t.cta.subtitle}</p>
            <Link href={talkHref} className="mt-8 inline-block">
              <Button size="lg" className="bg-gradient-to-r from-brand-from to-brand-to px-8 font-semibold text-white shadow-lg hover:opacity-90">
                {t.cta.primaryBtn}
                <MessageCircle className="ml-1 size-5" />
              </Button>
            </Link>
            <p className="mt-4 text-sm text-muted-foreground">{t.cta.note}</p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 bg-card/50 backdrop-blur">
        <div className="container mx-auto px-4 py-12">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-from to-brand-to text-white">
                  <MessageCircle className="size-4" />
                </span>
                <span className="text-lg font-bold">LingDaily</span>
              </div>
              <p className="text-sm text-muted-foreground">{t.footer.tagline}</p>
            </div>
            <div>
              <h4 className="mb-4 font-semibold">{t.footer.features}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href={talkHref} className="transition-colors hover:text-foreground">{t.footer.aiConversations}</Link></li>
                <li><Link href="#features" className="transition-colors hover:text-foreground">{t.footer.newsTopics}</Link></li>
                <li><Link href={progressHref} className="transition-colors hover:text-foreground">{t.footer.progressTracking}</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-4 font-semibold">{t.footer.learning}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href={talkHref} className="transition-colors hover:text-foreground">{t.footer.startLearning}</Link></li>
                <li><Link href={historyHref} className="transition-colors hover:text-foreground">{t.footer.conversationHistory}</Link></li>
                <li><Link href="/podcasts" className="transition-colors hover:text-foreground">{t.nav.podcasts}</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="mb-4 font-semibold">{t.footer.support}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="#" className="transition-colors hover:text-foreground">{t.footer.helpCenter}</Link></li>
                <li><Link href="#" className="transition-colors hover:text-foreground">{t.footer.contactUs}</Link></li>
                <li><Link href="#" className="transition-colors hover:text-foreground">{t.footer.privacy}</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-12 border-t border-border/60 pt-8 text-center text-sm text-muted-foreground">
            <p>&copy; 2026 LingDaily. {t.footer.rights}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
