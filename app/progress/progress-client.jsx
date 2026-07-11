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

export default function ProgressClient() {
  const [progress, setProgress] = useState(EMPTY_PROGRESS)
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

  useEffect(() => {
    const controller = new AbortController()
    void loadProgress(controller.signal)
    return () => controller.abort()
  }, [loadProgress])

  const recentDays = useMemo(() => {
    if (!Array.isArray(progress.recent7Days)) return []
    return progress.recent7Days.slice(-7).map((day) => ({
      date: day.date,
      userTurns: safeCount(day.userTurns),
    }))
  }, [progress.recent7Days])
  const maxTurns = Math.max(1, ...recentDays.map((day) => day.userTurns))

  const metrics = [
    { label: '对话总数', value: safeCount(progress.totalConversations), suffix: '次', icon: MessagesSquare },
    { label: '你的发言', value: safeCount(progress.totalUserTurns), suffix: '轮', icon: TrendingUp },
    { label: '累计学习', value: safeCount(progress.activeDays), suffix: '天', icon: CalendarDays },
    { label: '连续学习', value: safeCount(progress.currentStreak), suffix: '天', icon: Flame },
  ]

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/70 backdrop-blur">
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
            <section aria-labelledby="overview-heading">
              <h2 id="overview-heading" className="sr-only">学习数据概览</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {metrics.map((metric) => {
                  const Icon = metric.icon
                  return (
                    <Card key={metric.label} className="gap-4 py-5">
                      <CardContent className="px-5">
                        <Icon className="mb-4 size-5 text-muted-foreground" aria-hidden />
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

            <Card className="mt-6">
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
                            className="w-full max-w-10 rounded-t-md bg-foreground/80 transition-[height]"
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
              <Link href="/history" className="group rounded-xl border border-border bg-card p-5 transition-colors hover:bg-accent">
                <MessagesSquare className="mb-3 size-6" aria-hidden />
                <h2 className="font-semibold">对话历史</h2>
                <p className="mt-1 text-sm text-muted-foreground">查看过去的新闻与场景练习，继续上次对话。</p>
              </Link>
              <Link href="/vocabulary" className="group rounded-xl border border-border bg-card p-5 transition-colors hover:bg-accent">
                <BookOpen className="mb-3 size-6" aria-hidden />
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
