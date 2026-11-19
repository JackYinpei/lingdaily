'use client'

import Link from 'next/link'
import { AudioLines, BookOpen, ChartNoAxesCombined, Headphones, History, MessagesSquare, Monitor, Moon, Sun } from 'lucide-react'
import { useLanguage } from '@/app/contexts/LanguageContext'
import { useTheme } from '@/app/contexts/ThemeContext'
import './features.css'

const navigation = [
  { key: 'talk', href: '/talk', icon: MessagesSquare, en: 'Practice', zh: '口语练习', ja: '会話練習' },
  { key: 'history', href: '/history', icon: History, en: 'History', zh: '对话历史', ja: '会話履歴' },
  { key: 'vocabulary', href: '/vocabulary', icon: BookOpen, en: 'Vocabulary', zh: '生词本', ja: '単語帳' },
  { key: 'podcasts', href: '/podcasts', icon: Headphones, en: 'Podcasts', zh: '每日播客', ja: 'ポッドキャスト' },
  { key: 'progress', href: '/progress', icon: ChartNoAxesCombined, en: 'Progress', zh: '学习进度', ja: '学習記録' },
]

export function useFeatureLocale() {
  const { nativeLanguage } = useLanguage()
  const code = nativeLanguage?.code?.toLowerCase() || 'en'
  return code.startsWith('zh') ? 'zh' : code.startsWith('ja') ? 'ja' : 'en'
}

export function FeatureHeading({ number, eyebrow, title, description, icon: Icon, children }) {
  return (
    <section className="feature-heading">
      <div>
        <p className="feature-eyebrow"><span>{number}</span> {eyebrow}</p>
        <h1>{title}</h1>
        <p className="feature-description">{description}</p>
      </div>
      {children || (Icon && <div className="feature-heading-art" aria-hidden="true"><Icon strokeWidth={1} /></div>)}
    </section>
  )
}

export default function FeatureShell({ active, children, className = '' }) {
  const lang = useFeatureLocale()
  const { theme, toggleTheme } = useTheme()
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun
  const themeLabel = { en: 'Change theme', zh: '切换主题', ja: 'テーマを切り替える' }[lang]
  return (
    <div className={`feature-app feature-page-${active} ${className}`} lang={lang === 'zh' ? 'zh-CN' : lang}>
      <a href="#feature-content" className="feature-skip">{lang === 'zh' ? '跳至内容' : lang === 'ja' ? '本文へ' : 'Skip to content'}</a>
      <header className="feature-header">
        <div className="feature-header-inner">
          <Link href="/" className="feature-wordmark" aria-label="LingDaily"><AudioLines aria-hidden="true" />lingdaily<span>.</span></Link>
          <nav aria-label={lang === 'zh' ? '学习导航' : lang === 'ja' ? '学習メニュー' : 'Learning navigation'}>
            {navigation.map(({ key, href, icon: Icon, ...label }) => (
              <Link key={key} href={href} aria-current={active === key ? 'page' : undefined}>
                <Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span>{label[lang]}</span>
              </Link>
            ))}
          </nav>
          <button type="button" className="feature-theme-toggle" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}><ThemeIcon size={17} strokeWidth={1.6} aria-hidden="true" /></button>
        </div>
      </header>
      <main id="feature-content" className="feature-content">{children}</main>
    </div>
  )
}
