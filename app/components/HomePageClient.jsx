import React from 'react'
import '@/app/components/home/home.css'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  BookOpen,
  Headphones,
  MessageCircle,
  MoveUpRight,
} from 'lucide-react'
import HomeStart from '@/app/components/home/HomeStart'
import HomeNav from '@/app/components/home/HomeNav'
import ScenePreview from '@/app/components/home/ScenePreview'
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
            <p className="home-eyebrow">
              <span className="home-live-dot" />
              {t.eyebrow}
            </p>
            <h1 id="hero-heading">
              {t.headline}
              <br />
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
            <div className="home-margin-note">
              <span>HELLO. こんにちは. HOLA.</span>
              <p>{t.languages}</p>
            </div>
          </div>
          <div className="home-enter home-enter-later">
            <ScenePreview t={t.preview} />
          </div>
          <Link href="#features" className="home-discover">
            <ArrowDown size={15} aria-hidden="true" />
            {t.discover}
          </Link>
        </section>
        <section className="home-method-strip" aria-label={t.methodLabel}>
          <div className="home-container home-method-inner">
            <p>{t.methodIntro}</p>
            {t.methods.map((label, i) => (
              <span key={label}>
                <i>0{i + 1}</i>
                {label}
                {i < 2 && <ArrowRight size={18} aria-hidden="true" />}
              </span>
            ))}
          </div>
        </section>
        <section
          id="features"
          className="home-container home-features"
          aria-labelledby="features-heading"
        >
          <div className="home-section-heading">
            <div>
              <p className="home-eyebrow">{t.featuresEyebrow}</p>
              <h2 id="features-heading">{t.featuresTitle}</h2>
            </div>
            <p>{t.featuresIntro}</p>
          </div>
          <div className="home-feature-grid">
            <article className="home-feature home-feature-talk">
              <div className="home-feature-top">
                <span>01 / SPEAK</span>
                <MessageCircle size={21} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <h3>{t.talk.title}</h3>
              <p>{t.talk.desc}</p>
              <div className="home-prompt-list">
                {t.talk.prompts.map((prompt, i) => (
                  <div key={prompt}>
                    <span>0{i + 1}</span>
                    {prompt}
                    <MoveUpRight size={14} aria-hidden="true" />
                  </div>
                ))}
              </div>
              <Link href={privateHref('/talk')} className="home-feature-link">
                {t.talk.link}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </article>
            <article className="home-feature home-feature-listen">
              <div className="home-feature-top">
                <span>02 / LISTEN</span>
                <Headphones size={21} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div className="home-podcast-art" aria-hidden="true">
                <span className="home-podcast-edition">THE DAILY LISTEN</span>
                <span className="home-podcast-letters">
                  LL<span>&</span>DD
                </span>
                <div className="home-waveform">
                  {Array.from({ length: 39 }, (_, i) => (
                    <i
                      key={i}
                      style={{
                        '--bar': `${[20, 38, 62, 30, 75, 44, 90, 56, 32, 68, 45, 26, 80][i % 13]}%`,
                      }}
                    />
                  ))}
                </div>
                <span className="home-podcast-caption">
                  NEWS, IN TWO LANGUAGES.
                </span>
              </div>
              <h3>{t.podcast.title}</h3>
              <p>{t.podcast.desc}</p>
              <Link href="/podcasts" className="home-feature-link">
                {t.podcast.link}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </article>
            <article className="home-feature home-feature-keep">
              <div className="home-feature-top">
                <span>03 / KEEP</span>
                <BookOpen size={21} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <h3>{t.keep.title}</h3>
              <p>{t.keep.desc}</p>
              <div className="home-vocab-note">
                <span>{t.example}</span>
                <strong>on the same page</strong>
                <em>/ ɒn ðə seɪm peɪdʒ /</em>
                <p>{t.keep.meaning}</p>
                <q>Let’s make sure we’re on the same page.</q>
              </div>
              <Link
                href={privateHref('/vocabulary')}
                className="home-feature-link"
              >
                {t.keep.link}
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </article>
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
        <p className="home-colophon">
          © {new Date().getFullYear()} LingDaily
          <br />A LITTLE PRACTICE. EVERY DAY.
        </p>
      </footer>
    </div>
  )
}
