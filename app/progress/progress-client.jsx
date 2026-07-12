'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Flame,
  MessagesSquare,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'

import { Button } from '@/app/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card'

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

function formatDay(value) {
  if (!value) return '--'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

function formatLastActive(value) {
  if (!value) return '尚未开始学习'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return `最近学习：${new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)}`
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
      if (!response.ok) throw new Error(payload.error || '请求失败，请稍后重试')
      setProgress({ ...EMPTY_PROGRESS, ...(payload.data || {}) })
    } catch (fetchError) {
      if (fetchError.name !== 'AbortError') {
        setError(fetchError.message || '加载学习进度失败')
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

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
    { label: '对话总数', value: safeCount(progress.totalConversations), suffix: '次', icon: MessagesSquare },
    { label: '你的发言', value: safeCount(progress.totalUserTurns), suffix: '轮', icon: TrendingUp },
    { label: '累计学习', value: safeCount(progress.activeDays), suffix: '天', icon: CalendarDays },
    { label: '连续学习', value: safeCount(progress.currentStreak), suffix: '天', icon: Flame },
  ]

  return (
    <main className="relative min-h-screen text-foreground">
      <div aria-hidden className="bg-aurora grain-overlay pointer-events-none fixed inset-0 -z-10" />
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur">
        <div className="container mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/talk">
                <ArrowLeft aria-hidden />
                返回对话
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold">学习进度</h1>
              <p className="text-xs text-muted-foreground">用真实的对话数据记录每一步</p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">{formatLastActive(progress.lastActiveDate)}</span>
        </div>
      </header>

      <div className="container mx-auto max-w-5xl px-4 py-8">
        {error ? (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <span>{error}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadProgress()}>
              <RefreshCw aria-hidden />
              重试
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <RefreshCw className="mr-2 size-5 animate-spin text-muted-foreground" aria-hidden />
            <span className="text-sm text-muted-foreground">正在统计学习进度…</span>
          </div>
        ) : (
          <>
            {/* Highlight cards mirroring the homepage dashboard preview */}
            <section aria-label="今日概览" className="grid gap-4 lg:grid-cols-3">
              {/* Today's progress ring */}
              <Card className="bg-card/70 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-base">今日学习进度</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-5">
                  <div className="relative grid shrink-0 place-items-center">
                    <ProgressRing percent={todayPercent} />
                    <div className="absolute text-center">
                      <span className="block text-xl font-bold leading-none">{todayPercent}%</span>
                      <span className="block text-[10px] text-muted-foreground">目标 {DAILY_TURN_GOAL} 轮</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">今日发言</p>
                    <p className="text-2xl font-bold">
                      {todayTurns}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">/ {DAILY_TURN_GOAL} 轮</span>
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Vocabulary mastery */}
              <Card className="bg-card/70 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-base">词汇掌握</CardTitle>
                </CardHeader>
                <CardContent className="flex items-end justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">熟悉单词</p>
                    <p className="text-3xl font-bold">{vocabCount ?? '—'}</p>
                  </div>
                  <Link href="/vocabulary" className="text-sm text-brand hover:underline">
                    生词本 →
                  </Link>
                </CardContent>
              </Card>

              {/* This week summary */}
              <Card className="bg-card/70 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-base">本周学习量表</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 flex justify-between text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">本周发言</p>
                      <p className="text-xl font-bold">{weekTurns} 轮</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">连续学习</p>
                      <p className="text-xl font-bold text-brand">{safeCount(progress.currentStreak)} 天</p>
                    </div>
                  </div>
                  <div className="flex h-16 items-end justify-between gap-1" aria-hidden>
                    {recentDays.length === 0
                      ? Array.from({ length: 7 }).map((_, i) => (
                          <div key={i} className="w-full rounded-t bg-muted" style={{ height: '8%' }} />
                        ))
                      : recentDays.map((day) => {
                          const height = day.userTurns === 0 ? 6 : Math.max(12, Math.round((day.userTurns / maxTurns) * 100))
                          return (
                            <div
                              key={day.date}
                              className="w-full rounded-t bg-gradient-to-t from-brand-from to-brand-to"
                              style={{ height: `${height}%` }}
                            />
                          )
                        })}
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* All-time metrics */}
            <section aria-labelledby="overview-heading" className="mt-6">
              <h2 id="overview-heading" className="sr-only">学习数据概览</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {metrics.map((metric) => {
                  const Icon = metric.icon
                  return (
                    <Card key={metric.label} className="gap-4 bg-card/70 py-5 backdrop-blur">
                      <CardContent className="px-5">
                        <Icon className="mb-4 size-5 text-brand" aria-hidden />
                        <p className="text-2xl font-bold md:text-3xl">
                          {metric.value}
                          <span className="ml-1 text-sm font-normal text-muted-foreground">{metric.suffix}</span>
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{metric.label}</p>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </section>

            {/* Detailed weekly chart */}
            <Card className="mt-6 bg-card/70 backdrop-blur">
              <CardHeader>
                <CardTitle>最近 7 天发言</CardTitle>
                <p className="text-sm text-muted-foreground">只统计你在学习对话中的发言轮数</p>
              </CardHeader>
              <CardContent>
                {recentDays.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    完成一次对话后，这里会显示每天的练习记录。
                  </div>
                ) : (
                  <div className="grid h-56 grid-cols-7 items-end gap-2" role="list" aria-label="最近七天发言轮数">
                    {recentDays.map((day) => {
                      const height = day.userTurns === 0 ? 4 : Math.max(12, Math.round((day.userTurns / maxTurns) * 144))
                      return (
                        <div key={day.date} className="flex h-full min-w-0 flex-col items-center justify-end" role="listitem">
                          <span className="mb-2 text-xs font-medium" aria-label={`${day.date}，${day.userTurns} 轮发言`}>
                            {day.userTurns}
                          </span>
                          <div
                            className="w-full max-w-10 rounded-t-md bg-gradient-to-t from-brand-from to-brand-to transition-[height]"
                            style={{ height: `${height}px` }}
                            aria-hidden
                          />
                          <span className="mt-2 truncate text-[11px] text-muted-foreground">{formatDay(day.date)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="学习记录入口">
              <Link href="/history" className="group rounded-xl border border-border bg-card/70 p-5 backdrop-blur transition-colors hover:border-brand/40 hover:bg-card">
                <MessagesSquare className="mb-3 size-6 text-brand" aria-hidden />
                <h2 className="font-semibold">对话历史</h2>
                <p className="mt-1 text-sm text-muted-foreground">查看过去的新闻与场景练习，继续上次对话。</p>
              </Link>
              <Link href="/vocabulary" className="group rounded-xl border border-border bg-card/70 p-5 backdrop-blur transition-colors hover:border-brand/40 hover:bg-card">
                <BookOpen className="mb-3 size-6 text-brand" aria-hidden />
                <h2 className="font-semibold">生词本</h2>
                <p className="mt-1 text-sm text-muted-foreground">复习对话中识别并保存的单词、短语和语法。</p>
              </Link>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
