'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Flame,
  MessagesSquare,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'

import { Button } from '@/app/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card'
import FeatureShell, { FeatureHeading, useFeatureLocale } from '@/app/components/FeatureShell'
import { featureCopy, featureDateLocale } from '@/app/lib/featureCopy'

const EMPTY_PROGRESS = {
  totalConversations: 0,
  totalUserTurns: 0,
  activeDays: 0,
  currentStreak: 0,
  lastActiveDate: null,
  recent7Days: [],
}

// Daily target used for the "today's progress" ring. A learner hitting this many
// turns in a day is considered to have met the goal.
const DAILY_TURN_GOAL = 30

function safeCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function formatDay(value, locale) {
  if (!value) return '--'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(date)
}

function formatLastActive(value, locale, t) {
  if (!value) return t.notStarted
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return `${t.lastActive}: ${new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(date)}`
}

function ProgressRing({ percent }) {
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = circumference * (1 - clamped / 100)
  return (
    <svg viewBox="0 0 96 96" className="size-24 -rotate-90" aria-hidden>
      <circle cx="48" cy="48" r={radius} fill="none" strokeWidth="9" className="stroke-muted" />
      <circle
        cx="48"
        cy="48"
        r={radius}
        fill="none"
        strokeWidth="9"
        strokeLinecap="round"
        stroke="url(#progress-ring-grad)"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-700"
      />
      <defs>
        <linearGradient id="progress-ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand-from)" />
          <stop offset="100%" stopColor="var(--brand-to)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export default function ProgressClient() {
  const lang = useFeatureLocale()
  const t = featureCopy[lang]
  const locale = featureDateLocale[lang]
  const [progress, setProgress] = useState(EMPTY_PROGRESS)
  const [vocabCount, setVocabCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadProgress = useCallback(async (signal) => {
    setLoading(true)
    setError('')
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      const params = new URLSearchParams({ timezone })
      const response = await fetch(`/api/learning/progress?${params.toString()}`, {
        cache: 'no-store',
        signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || t.requestFailed)
      setProgress({ ...EMPTY_PROGRESS, ...(payload.data || {}) })
    } catch (fetchError) {
      if (fetchError.name !== 'AbortError') {
        setError(fetchError.message || t.progressFailed)
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [t])

  // Vocabulary count is a best-effort enrichment; a failure here must not block
  // the main progress view, so it is loaded and errored independently.
  const loadVocabulary = useCallback(async (signal) => {
    try {
      const response = await fetch('/api/learning/items?limit=200', {
        cache: 'no-store',
        signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return
      const records = Array.isArray(payload.data) ? payload.data : []
      const unique = new Set()
      for (const record of records) {
        for (const item of record.items || []) {
          const text = String(item?.text || '').normalize('NFKC').toLowerCase().trim()
          if (text) unique.add(text)
        }
      }
      if (!signal?.aborted) setVocabCount(unique.size)
    } catch {
      // ignore — vocab card falls back to a placeholder
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadProgress(controller.signal)
    void loadVocabulary(controller.signal)
    return () => controller.abort()
  }, [loadProgress, loadVocabulary])

  const recentDays = useMemo(() => {
    if (!Array.isArray(progress.recent7Days)) return []
    return progress.recent7Days.slice(-7).map((day) => ({
      date: day.date,
      userTurns: safeCount(day.userTurns),
    }))
  }, [progress.recent7Days])
  const maxTurns = Math.max(1, ...recentDays.map((day) => day.userTurns))

  const todayTurns = recentDays.length ? recentDays[recentDays.length - 1].userTurns : 0
  const todayPercent = Math.min(100, Math.round((todayTurns / DAILY_TURN_GOAL) * 100))
  const weekTurns = recentDays.reduce((sum, day) => sum + day.userTurns, 0)

  const metrics = [
    { label: t.conversations, value: safeCount(progress.totalConversations), suffix: t.times, icon: MessagesSquare },
    { label: t.yourTurns, value: safeCount(progress.totalUserTurns), suffix: t.turnUnit, icon: TrendingUp },
    { label: t.activeDays, value: safeCount(progress.activeDays), suffix: t.days, icon: CalendarDays },
    { label: t.streak, value: safeCount(progress.currentStreak), suffix: t.days, icon: Flame },
  ]

  return (
    <FeatureShell active="progress">
      <FeatureHeading page="progress" />
      <p className="feature-count mb-6">{formatLastActive(progress.lastActiveDate, locale, t)}</p>
      <div>
        {error ? (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <span>{error}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadProgress()}>
              <RefreshCw aria-hidden />
              {t.retry}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <RefreshCw className="mr-2 size-5 animate-spin text-muted-foreground" aria-hidden />
            <span className="text-sm text-muted-foreground">{t.loadingProgress}</span>
          </div>
        ) : (
          <>
            <section aria-label={t.todayOverview} className="feature-progress-summary">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t.todayProgress}</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-5">
                  <div className="relative grid shrink-0 place-items-center">
                    <ProgressRing percent={todayPercent} />
                    <div className="absolute text-center">
                      <span className="block text-xl font-bold leading-none">{todayPercent}%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t.todayTurns}</p>
                    <p className="feature-progress-value">
                      {todayTurns}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">/ {DAILY_TURN_GOAL} {t.turnUnit}</span>
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">{t.goal}: {DAILY_TURN_GOAL} {t.turnUnit}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t.vocabulary}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{t.savedWords}</p>
                    <p className="feature-progress-value">{vocabCount ?? '—'}</p>
                  </div>
                  <Link href="/vocabulary" className="feature-text-link">
                    {t.vocabulary}<ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>
            </section>

            <section aria-labelledby="overview-heading" className="feature-progress-overview">
              <h2 id="overview-heading" className="sr-only">{t.overview}</h2>
              <dl className="feature-progress-metrics">
                {metrics.map((metric) => {
                  const Icon = metric.icon
                  return (
                    <div key={metric.label}>
                      <dt><Icon size={16} aria-hidden />{metric.label}</dt>
                      <dd>
                        {metric.value}
                        <span className="ml-1 text-sm font-normal text-muted-foreground">{metric.suffix}</span>
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </section>

            <Card className="feature-progress-chart">
              <CardHeader className="feature-chart-header">
                <div>
                  <CardTitle>{t.recentTurns}</CardTitle>
                  <p className="mt-2 text-sm text-muted-foreground">{t.recentDescription}</p>
                </div>
                <p className="feature-chart-total"><span>{t.week}</span><strong>{weekTurns} <small>{t.turnUnit}</small></strong></p>
              </CardHeader>
              <CardContent>
                {recentDays.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    {t.noProgress}
                  </div>
                ) : (
                  <div className="grid h-48 grid-cols-7 items-end gap-2" role="list" aria-label={t.recentLabel}>
                    {recentDays.map((day) => {
                      const height = day.userTurns === 0 ? 4 : Math.max(12, Math.round((day.userTurns / maxTurns) * 144))
                      return (
                        <div key={day.date} className="flex h-full min-w-0 flex-col items-center justify-end" role="listitem">
                          <span className="mb-2 text-xs font-medium" aria-label={`${day.date}, ${day.userTurns} ${t.turnUnit}`}>
                            {day.userTurns}
                          </span>
                          <div
                            className="w-full max-w-10 rounded-t-md bg-gradient-to-t from-brand-from to-brand-to transition-[height]"
                            style={{ height: `${height}px` }}
                            aria-hidden
                          />
                          <span className="mt-2 text-xs text-muted-foreground">{formatDay(day.date, locale)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <section className="feature-progress-links" aria-label={t.records}>
              <Link href="/history">
                <MessagesSquare size={20} aria-hidden />
                <div>
                  <h2 className="font-semibold">{t.history}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t.historyLink}</p>
                </div>
                <ArrowRight size={16} aria-hidden />
              </Link>
              <Link href="/vocabulary">
                <BookOpen size={20} aria-hidden />
                <div>
                  <h2 className="font-semibold">{t.vocabulary}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t.vocabLink}</p>
                </div>
                <ArrowRight size={16} aria-hidden />
              </Link>
            </section>
          </>
        )}
      </div>
    </FeatureShell>
  )
}
