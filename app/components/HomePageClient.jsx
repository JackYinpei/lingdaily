import React from 'react'
import '@/app/components/home/home.css'
import Link from 'next/link'
import { ArrowRight, AudioLines, Headphones } from 'lucide-react'
import HomeStart from '@/app/components/home/HomeStart'
import HomeNav from '@/app/components/home/HomeNav'
import FeatureStage from '@/app/components/home/FeatureStage'
import { HOME_COPY } from '@/app/components/home/copy'

export default function HomePageClient({
  signedIn,
  signOutAction,
  locale = 'en',
}) {
  const lang = HOME_COPY[locale] ? locale : 'en'
  const t = HOME_COPY[lang]
  const privateHref = (path) =>
    signedIn ? path : `/sign-in?callbackUrl=${encodeURIComponent(path)}`
  return (
    <div className="home-editorial" lang={lang === 'zh' ? 'zh-CN' : lang}>
      <Link className="home-skip" href="#content">
        {t.skip}
      </Link>
      <header className="home-header">
        <div className="home-container home-header-inner">
          <Link href="/" className="home-wordmark" aria-label="LingDaily home">
            <AudioLines aria-hidden="true" />
            <span>
              LingDaily<span className="home-wordmark-dot">.</span>
            </span>
          </Link>
          <HomeNav t={t} signedIn={signedIn} signOutAction={signOutAction} />
        </div>
      </header>
      <main id="content">
        <section
          className="home-container home-hero"
          aria-labelledby="hero-heading"
        >
          <div className="home-hero-copy home-enter">
            <h1 id="hero-heading">
              <span>{t.headline}</span>
              <em>{t.headlineAccent}</em>
            </h1>
            <p className="home-intro">{t.intro}</p>
            <div className="home-hero-actions">
              <Link href="#start" className="home-button">
                {signedIn ? t.continue : t.start}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link href="/podcasts" className="home-text-link">
                <Headphones size={18} aria-hidden="true" />
                {t.listen}
              </Link>
            </div>
            <p className="home-hero-note">{t.entryNote}</p>
          </div>
          <div
            id="features"
            className="home-stage-wrap home-enter home-enter-later"
          >
            <FeatureStage t={t.stage} signedIn={signedIn} />
          </div>
        </section>
        <section
          id="how"
          className="home-container home-how"
          aria-labelledby="how-heading"
        >
          <div>
            <p className="home-eyebrow">{t.howEyebrow}</p>
            <h2 id="how-heading">{t.howTitle}</h2>
            <p className="home-how-note">{t.howNote}</p>
          </div>
          <ol>
            {t.steps.map((step, i) => (
              <li key={step.title}>
                <span>0{i + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section
          id="start"
          className="home-start-section"
          aria-labelledby="start-heading"
        >
          <div className="home-container home-start-inner">
            <div>
              <p className="home-eyebrow">{t.startEyebrow}</p>
              <h2 id="start-heading">{t.startTitle}</h2>
              <p>{t.startDesc}</p>
              <p className="home-start-languages">{t.languages}</p>
            </div>
            <HomeStart t={t} signedIn={signedIn} />
          </div>
        </section>
      </main>
      <footer className="home-container home-footer">
        <div>
          <Link href="/" className="home-wordmark">
            LingDaily<span className="home-wordmark-dot">.</span>
          </Link>
          <p>{t.footer}</p>
        </div>
        <nav aria-label={t.footerNav}>
          <Link href="/podcasts">{t.nav.podcasts}</Link>
          <Link href={privateHref('/progress')}>{t.nav.progress}</Link>
          <Link href={privateHref('/history')}>{t.nav.history}</Link>
          <Link href="/support">{t.support}</Link>
          <Link href="/privacy">{t.privacy}</Link>
        </nav>
        <p className="home-colophon">© {new Date().getFullYear()} LingDaily</p>
      </footer>
    </div>
  )
}
