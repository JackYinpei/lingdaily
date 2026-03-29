import Link from 'next/link'
import { Button } from '@/app/components/ui/button'
import { Card, CardContent } from '@/app/components/ui/card'
import { Badge } from '@/app/components/ui/badge'
import { MessageCircle, Users, Globe, CheckCircle, Star } from 'lucide-react'
import StartLearningWithLanguage from '@/app/components/StartLearningWithLanguage'
import ThemeToggle from '@/app/components/ThemeToggle'
import HeroVideoDemo from '@/app/components/HeroVideoDemo'

const I18N = {
  en: {
    nav: { features: 'Features', how: 'How it Works', reviews: 'Reviews', podcasts: 'Podcasts', startLearning: 'Start Learning', signIn: 'Sign In', signOut: 'Sign Out', talk: 'Talk', history: 'History' },
    hero: { badge: 'AI-Powered English Learning', h1Prefix: 'Chat with AI to', h1Highlight: 'Learn English', desc: 'Master English through real-time conversations about current news. Practice speaking, improve vocabulary, and gain confidence with our AI English tutor.', primaryBtn: 'Start Free Conversation', secondaryBtn: 'Watch Demo' },
    podcasts: { title: 'Daily AI News Podcasts', subtitle: 'Immerse yourself in English with daily generated podcasts covering the latest topics.', btn: 'Listen Now', features: ['Daily Updates', 'Native-like AI Voices', 'Full Transcripts'] },
    features: { title: 'Why Choose LingDaily?', subtitle: 'Learn English naturally through AI conversations about real-world topics', card1Title: 'Real-Time Conversations', card1Desc: 'Practice speaking English with AI that understands context and provides instant feedback on your pronunciation and grammar.', card2Title: 'Current News Topics', card2Desc: 'Stay informed while learning. Discuss trending news stories to build vocabulary and cultural understanding.', card3Title: 'Personalized Learning', card3Desc: 'AI adapts to your learning level and interests, providing customized conversations that match your progress.' },
    how: { title: 'How It Works', subtitle: 'Three simple steps to start improving your English today', step1Title: 'Choose a News Topic', step1Desc: 'Select from current news stories that interest you, from technology to global events.', step2Title: 'Start Talking', step2Desc: 'Engage in natural conversation with our AI tutor about the topic you chose.', step3Title: 'Learn & Improve', step3Desc: 'Receive real-time feedback, learn new vocabulary, and track your progress.' },
    benefits: { title: 'Perfect for English Learners', bullets: ['Practice speaking without judgment', 'Learn vocabulary in context', 'Improve pronunciation with AI feedback', 'Stay updated with global news', 'Learn at your own pace, 24/7'], rating: '4.9/5 from 1000+ learners', quote: '“LingDaily helped me improve my English speaking skills faster than any other method. The AI conversations feel natural and the news topics keep me engaged.”', cite: '— Sarah K., International Student' },
    cta: { title: 'Ready to Master English?', subtitle: 'Join thousands of learners who are improving their English through AI-powered conversations', primaryBtn: 'Start Your Free Conversation', note: 'No credit card required • Start learning immediately' },
    footer: { features: 'Features', learning: 'Learning', support: 'Support', aiConversations: 'AI Conversations', newsTopics: 'News Topics', progressTracking: 'Progress Tracking', startLearning: 'Start Learning', conversationHistory: 'Conversation History', tipsGuides: 'Tips & Guides', helpCenter: 'Help Center', contactUs: 'Contact Us', privacy: 'Privacy Policy', rights: 'All rights reserved. Chat with AI to learn English.' },
    start: { learningLabel: 'Learning', nativeLabel: 'Native' },
  },
  zh: {
    nav: { features: '功能', how: '使用方式', reviews: '评价', podcasts: '播客', startLearning: '开始学习', signIn: '登录', signOut: '退出登录', talk: '对话', history: '历史' },
    hero: { badge: 'AI 驱动的英语学习', h1Prefix: '和 AI 对话来', h1Highlight: '学习英语', desc: '通过与 AI 围绕实时新闻进行对话学习英语。练习口语、提升词汇量，并获得自信。', primaryBtn: '开始免费对话', secondaryBtn: '观看演示' },
    podcasts: { title: '每日 AI 新闻播客', subtitle: '通过涵盖最新话题的每日生成播客，让自己沉浸在英语环境中。', btn: '立即收听', features: ['每日更新', '原生 AI 语音', '完整文稿'] },
    features: { title: '为什么选择 LingDaily？', subtitle: '通过与 AI 讨论真实话题，自然地学习英语', card1Title: '实时对话', card1Desc: '与能理解上下文的 AI 进行口语练习，获得关于发音和语法的即时反馈。', card2Title: '时事新闻主题', card2Desc: '在学习的同时保持信息更新。讨论热门新闻，构建词汇与文化理解。', card3Title: '个性化学习', card3Desc: 'AI 会根据你的水平和兴趣定制对话，匹配你的学习进度。' },
    how: { title: '如何使用', subtitle: '三步开始高效提升英语', step1Title: '选择新闻话题', step1Desc: '在科技、全球事件等当前新闻中选择你感兴趣的话题。', step2Title: '开始对话', step2Desc: '围绕你选择的话题，与我们的 AI 导师自然交流。', step3Title: '学习与提升', step3Desc: '获得实时反馈，学习新词汇，并跟踪你的进步。' },
    benefits: { title: '英语学习者的理想选择', bullets: ['无压力的口语练习', '在语境中学习词汇', 'AI 帮助改进发音', '持续了解全球资讯', '随时随地按节奏学习'], rating: '来自 1000+ 学员的 4.9/5 评分', quote: '“LingDaily 让我口语提升更快。与 AI 的对话很自然，新闻话题也让我保持兴趣。”', cite: '— Sarah K., 国际学生' },
    cta: { title: '准备好掌握英语了吗？', subtitle: '加入数千学员，通过 AI 对话不断提升英语', primaryBtn: '开始你的免费对话', note: '无需信用卡 • 立即开始学习' },
    footer: { features: '功能', learning: '学习', support: '支持', aiConversations: 'AI 对话', newsTopics: '新闻话题', progressTracking: '进度追踪', startLearning: '开始学习', conversationHistory: '对话历史', tipsGuides: '技巧与指南', helpCenter: '帮助中心', contactUs: '联系我们', privacy: '隐私政策', rights: '版权所有。和 AI 对话学习英语。' },
    start: { learningLabel: '学习语言', nativeLabel: '母语' },
  },
  ja: {
    nav: { features: '機能', how: '使い方', reviews: 'レビュー', podcasts: 'ポッドキャスト', startLearning: '学習を始める', signIn: 'サインイン', signOut: 'サインアウト', talk: '会話', history: '履歴' },
    hero: { badge: 'AI で英語学習', h1Prefix: 'AIと会話して', h1Highlight: '英語を学ぶ', desc: 'ニュースに関するリアルタイム会話で英語を習得。スピーキング練習、語彙力アップ、自信を獲得しよう。', primaryBtn: '無料で会話を開始', secondaryBtn: 'デモを見る' },
    podcasts: { title: 'デイリーAIニュースポッドキャスト', subtitle: '最新のトピックをカバーする毎日生成されるポッドキャストで英語に浸りましょう。', btn: '今すぐ聴く', features: ['毎日更新', 'ネイティブなAI音声', '完全なスクリプト'] },
    features: { title: 'LingDaily を選ぶ理由', subtitle: '実世界のトピックについて AI と会話し、自然に英語を学ぶ', card1Title: 'リアルタイム会話', card1Desc: '文脈を理解する AI と英会話練習。発音や文法の即時フィードバック。', card2Title: '最新ニュースの話題', card2Desc: '学びながら情報収集。トレンドのニュースで語彙と文化理解を養う。', card3Title: 'パーソナライズ学習', card3Desc: 'レベルや興味に合わせて会話を最適化。あなたの進度にマッチ。' },
    how: { title: '使い方', subtitle: '3 ステップで英語力を向上', step1Title: 'ニューストピックを選ぶ', step1Desc: 'テクノロジーから国際情勢まで、気になるニュースを選択。', step2Title: '会話を始める', step2Desc: '選んだトピックについて AI チューターと自然に会話。', step3Title: '学び、上達する', step3Desc: 'リアルタイムのフィードバックを受け、語彙を学び、進捗を追跡。' },
    benefits: { title: '英語学習者に最適', bullets: ['気軽にスピーキング練習', '文脈で語彙を学ぶ', 'AI で発音を改善', '世界のニュースを把握', 'いつでも自分のペースで'], rating: '1000人以上から4.9/5の評価', quote: '「LingDaily で英会話力が大幅に向上しました。AI との会話は自然で、ニュース話題で飽きません。」', cite: '— Sarah K.（留学生）' },
    cta: { title: '英語をマスターする準備はできた？', subtitle: '何千人もの学習者が AI 会話で英語力を向上', primaryBtn: '無料で会話を開始', note: 'クレジットカード不要 • 今すぐ始められます' },
    footer: { features: '機能', learning: '学習', support: 'サポート', aiConversations: 'AI 会話', newsTopics: 'ニューストピック', progressTracking: '進捗トラッキング', startLearning: '学習を始める', conversationHistory: '会話履歴', tipsGuides: 'ヒントとガイド', helpCenter: 'ヘルプセンター', contactUs: 'お問い合わせ', privacy: 'プライバシーポリシー', rights: '無断転載禁止。AI と会話して英語を学ぶ。' },
    start: { learningLabel: '学習言語', nativeLabel: '母語' },
  },
}

const DEFAULT_LOCALE = 'en'

export default function HomePageClient({ signedIn, signOutAction, locale = DEFAULT_LOCALE }) {
  const normalizedLocale = I18N[locale] ? locale : DEFAULT_LOCALE
  const t = I18N[normalizedLocale]

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MessageCircle className="h-8 w-8" />
              <span className="text-2xl font-bold text-foreground">LingDaily</span>
            </div>
            <nav className="hidden md:flex items-center space-x-6">
              {signedIn ? (
                <>
                  <Link href="/talk" className="text-muted-foreground hover:text-foreground transition-colors">
                    {t.nav.talk}
                  </Link>
                  <ThemeToggle />
                  <form action={signOutAction}>
                    <Button variant="outline" className="font-semibold">
                      {t.nav.signOut}
                    </Button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
                    {t.nav.features}
                  </Link>
                  <Link href="#how-it-works" className="text-muted-foreground hover:text-foreground transition-colors">
                    {t.nav.how}
                  </Link>
                  <Link href="#testimonials" className="text-muted-foreground hover:text-foreground transition-colors">
                    {t.nav.reviews}
                  </Link>
                  <StartLearningWithLanguage startLabel={t.nav.startLearning} learningLabel={t.start.learningLabel} nativeLabel={t.start.nativeLabel} />
                  <ThemeToggle />
                  <Link href="/sign-in">
                    <Button variant="outline" className="font-semibold">
                      {t.nav.signIn}
                    </Button>
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>
      </header>

      <main id="content" className="flex flex-col gap-0">
        {/* Hero Section */}
        <section className="container mx-auto px-4 py-20 text-center" aria-labelledby="hero-heading">
          <div className="max-w-4xl mx-auto">
            <Badge variant="secondary" className="mb-6">🚀 {t.hero.badge}</Badge>
            <h1 id="hero-heading" className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              {t.hero.h1Prefix}
              <span className="text-transparent bg-gradient-to-r from-white to-zinc-400 bg-clip-text"> {t.hero.h1Highlight}</span>
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-8 leading-relaxed">{t.hero.desc}</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/talk">
                <Button size="lg" className="font-semibold px-8 py-4 text-lg">
                  {t.hero.primaryBtn}
                  <MessageCircle className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <HeroVideoDemo buttonLabel={t.hero.secondaryBtn} />
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="container mx-auto px-4 py-20" aria-labelledby="features-heading">
          <div className="text-center mb-16">
            <h2 id="features-heading" className="text-4xl md:text-5xl font-bold mb-4">{t.features.title}</h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">{t.features.subtitle}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="transition-colors">
              <CardContent className="p-6">
                <MessageCircle className="h-12 w-12 mb-4" aria-hidden />
                <h3 className="text-2xl font-semibold mb-4">{t.features.card1Title}</h3>
                <p className="text-muted-foreground">{t.features.card1Desc}</p>
              </CardContent>
            </Card>
            <Card className="transition-colors">
              <CardContent className="p-6">
                <Globe className="h-12 w-12 mb-4" aria-hidden />
                <h3 className="text-2xl font-semibold mb-4">{t.features.card2Title}</h3>
                <p className="text-muted-foreground">{t.features.card2Desc}</p>
              </CardContent>
            </Card>
            <Card className="transition-colors">
              <CardContent className="p-6">
                <Users className="h-12 w-12 mb-4" aria-hidden />
                <h3 className="text-2xl font-semibold mb-4">{t.features.card3Title}</h3>
                <p className="text-muted-foreground">{t.features.card3Desc}</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* How it Works */}
        <section id="how-it-works" className="bg-muted py-20" aria-labelledby="how-heading">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <h2 id="how-heading" className="text-4xl md:text-5xl font-bold mb-4">{t.how.title}</h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">{t.how.subtitle}</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="bg-card text-card-foreground border border-border rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold mx-auto mb-6" aria-hidden>1</div>
                <h3 className="text-2xl font-semibold mb-4">{t.how.step1Title}</h3>
                <p className="text-muted-foreground">{t.how.step1Desc}</p>
              </div>
              <div className="text-center">
                <div className="bg-card text-card-foreground border border-border rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold mx-auto mb-6" aria-hidden>2</div>
                <h3 className="text-2xl font-semibold mb-4">{t.how.step2Title}</h3>
                <p className="text-muted-foreground">{t.how.step2Desc}</p>
              </div>
              <div className="text-center">
                <div className="bg-card text-card-foreground border border-border rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold mx-auto mb-6" aria-hidden>3</div>
                <h3 className="text-2xl font-semibold mb-4">{t.how.step3Title}</h3>
                <p className="text-muted-foreground">{t.how.step3Desc}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="container mx-auto px-4 py-20" aria-labelledby="benefits-heading">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 id="benefits-heading" className="text-4xl md:text-5xl font-bold mb-6">{t.benefits.title}</h2>
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <CheckCircle className="h-6 w-6 text-green-400" aria-hidden />
                  <span className="text-lg">{t.benefits.bullets[0]}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <CheckCircle className="h-6 w-6 text-green-400" aria-hidden />
                  <span className="text-lg">{t.benefits.bullets[1]}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <CheckCircle className="h-6 w-6 text-green-400" aria-hidden />
                  <span className="text-lg">{t.benefits.bullets[2]}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <CheckCircle className="h-6 w-6 text-green-400" aria-hidden />
                  <span className="text-lg">{t.benefits.bullets[3]}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <CheckCircle className="h-6 w-6 text-green-400" aria-hidden />
                  <span className="text-lg">{t.benefits.bullets[4]}</span>
                </div>
              </div>
            </div>
            <Card>
              <CardContent className="p-8">
                <div className="flex items-center mb-4">
                  <div className="flex text-yellow-400" aria-hidden>
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="h-5 w-5 fill-current" />
                    ))}
                  </div>
                  <span className="ml-2 text-muted-foreground">{t.benefits.rating}</span>
                </div>
                <blockquote className="text-lg mb-4">{t.benefits.quote}</blockquote>
                <cite className="text-muted-foreground">{t.benefits.cite}</cite>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* CTA Section */}
        <section className="bg-accent py-20" aria-labelledby="cta-heading">
          <div className="container mx-auto px-4 text-center">
            <h2 id="cta-heading" className="text-4xl md:text-5xl font-bold mb-6">{t.cta.title}</h2>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">{t.cta.subtitle}</p>
            <Link href="/talk">
              <Button size="lg" className="font-semibold px-8 py-4 text-lg">
                {t.cta.primaryBtn}
                <MessageCircle className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <p className="text-sm text-muted-foreground mt-4">{t.cta.note}</p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card">
        <div className="container mx-auto px-4 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <MessageCircle className="h-6 w-6" />
                <span className="text-xl font-bold">LingDaily</span>
              </div>
              <p className="text-muted-foreground">AI-powered English learning through news conversations</p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t.footer.features}</h4>
              <ul className="space-y-2 text-muted-foreground">
                <li><Link href="#" className="hover:text-foreground transition-colors">{t.footer.aiConversations}</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">{t.footer.newsTopics}</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">{t.footer.progressTracking}</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t.footer.learning}</h4>
              <ul className="space-y-2 text-muted-foreground">
                <li><Link href="/talk" className="hover:text-foreground transition-colors">{t.footer.startLearning}</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">{t.footer.tipsGuides}</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t.footer.support}</h4>
              <ul className="space-y-2 text-muted-foreground">
                <li><Link href="#" className="hover:text-foreground transition-colors">{t.footer.helpCenter}</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">{t.footer.contactUs}</Link></li>
                <li><Link href="#" className="hover:text-foreground transition-colors">{t.footer.privacy}</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border mt-12 pt-8 text-center text-muted-foreground">
            <p>&copy; 2024 LingDaily. {t.footer.rights}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
