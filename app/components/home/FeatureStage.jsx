'use client'

import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Play } from 'lucide-react'
import { LearnerArt, PartnerArt } from '@/app/components/home/SceneArt'

const TURN_MS = 7000
const WAVE = [20, 38, 62, 30, 75, 44, 90, 56, 32, 68, 45, 26, 80]

function Slogan({ title }) {
  return (
    <h2>
      {title.split('\n').map((line) => (
        <span key={line}>{line}</span>
      ))}
    </h2>
  )
}

function TalkSample({ t }) {
  return (
    <div className="home-dialogue">
      <p className="home-speaker">{t.role}</p>
      <p lang="en">{t.prompt}</p>
      <p className="home-speaker home-you">{t.you}</p>
      <p lang="en" className="home-answer">
        {t.answer}
      </p>
      <div className="home-correction">
        <span>
          <ArrowUpRight size={16} aria-hidden="true" />
          {t.tip}
        </span>
        <p lang="en">{t.correction}</p>
      </div>
    </div>
  )
}

function PodcastSample({ t }) {
  return (
    <div className="home-episode">
      <div className="home-episode-bar">
        <span className="home-episode-play" aria-hidden="true">
          <Play size={16} />
        </span>
        <div>
          <p>{t.episode}</p>
          <div className="home-waveform" aria-hidden="true">
            {Array.from({ length: 39 }, (_, i) => (
              <i key={i} style={{ '--bar': `${WAVE[i % WAVE.length]}%` }} />
            ))}
          </div>
        </div>
      </div>
      <dl>
        {t.lines.map(([host, lang, line]) => (
          <div key={host}>
            <dt>{host}</dt>
            <dd lang={lang}>{line}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function KeepSample({ t }) {
  return (
    <div className="home-vocab-note">
      <span>{t.label}</span>
      <strong lang="en">on the same page</strong>
      <em>/ ɒn ðə seɪm peɪdʒ /</em>
      <p>{t.meaning}</p>
      <q lang="en">Let’s make sure we’re on the same page.</q>
    </div>
  )
}

const SAMPLES = [TalkSample, PodcastSample, KeepSample]

export default function FeatureStage({ t, signedIn }) {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const [held, setHeld] = useState(false)
  const [seen, setSeen] = useState(true)
  const stage = useRef(null)
  const tabs = useRef([])
  const count = t.features.length
  const playing = auto && !held && seen

  useEffect(() => {
    if (!playing) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const timer = setTimeout(() => setActive((n) => (n + 1) % count), TURN_MS)
    return () => clearTimeout(timer)
  }, [playing, active, count])

  useEffect(() => {
    if (!stage.current || typeof IntersectionObserver === 'undefined') return
    const watcher = new IntersectionObserver(
      ([entry]) => setSeen(entry.isIntersecting),
      { threshold: 0.3 },
    )
    watcher.observe(stage.current)
    return () => watcher.disconnect()
  }, [])

  const choose = (index) => {
    setAuto(false)
    setActive(index)
  }
  const onKeyDown = (event, index) => {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % count
    else if (event.key === 'ArrowLeft') next = (index + count - 1) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    else return
    event.preventDefault()
    choose(next)
    tabs.current[next]?.focus()
  }
  const hrefs = [
    signedIn ? '/talk' : '/sign-in?callbackUrl=%2Ftalk',
    '/podcasts',
    signedIn ? '/vocabulary' : '/sign-in?callbackUrl=%2Fvocabulary',
  ]

  return (
    <div
      className="home-stage"
      ref={stage}
      data-scene={active}
      onPointerEnter={(event) => event.pointerType === 'mouse' && setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <PartnerArt scene={active} />
      <div className="home-sheet">
        <div className="home-scene-tabs" role="tablist" aria-label={t.label}>
          {t.features.map((feature, index) => (
            <button
              type="button"
              key={feature.tab}
              id={`feature-tab-${index}`}
              role="tab"
              aria-selected={active === index}
              aria-controls={`feature-panel-${index}`}
              tabIndex={active === index ? 0 : -1}
              ref={(el) => {
                tabs.current[index] = el
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => choose(index)}
            >
              <span>0{index + 1}</span>
              {feature.tab}
              {active === index && (
                <i
                  key={`${index}-${playing}`}
                  className={playing ? 'is-timed' : undefined}
                />
              )}
            </button>
          ))}
        </div>
        <div className="home-sheet-panels">
          {t.features.map((feature, index) => {
            const Sample = SAMPLES[index]
            return (
              <section
                key={feature.tab}
                id={`feature-panel-${index}`}
                role="tabpanel"
                aria-labelledby={`feature-tab-${index}`}
                className="home-sheet-panel"
                data-active={active === index}
                inert={active !== index}
              >
                <Slogan title={feature.title} />
                <p className="home-sheet-desc">{feature.desc}</p>
                <Sample t={feature.sample} />
                <Link href={hrefs[index]} className="home-feature-link">
                  {feature.link}
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </section>
            )
          })}
        </div>
        <p className="home-preview-note">
          <span className="home-note-dot" />
          {t.note}
        </p>
      </div>
      <LearnerArt scene={active} />
    </div>
  )
}
