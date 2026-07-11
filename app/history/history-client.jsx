'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  BookOpen,
  Clock3,
  MessageCircle,
  Newspaper,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react'

import { Button } from '@/app/components/ui/button'
import { Card, CardContent } from '@/app/components/ui/card'

const FILTERS = [
  { value: '', label: '全部' },
  { value: 'news', label: '新闻' },
  { value: 'scenario', label: '场景' },
]

const SOURCE_META = {
  news: { label: '新闻对话', icon: Newspaper },
  scenario: { label: '场景练习', icon: Users },
}

function formatDate(value) {
  if (!value) return '时间未知'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || '请求失败，请稍后重试')
  }
  return payload
}

export default function HistoryClient() {
  const [sourceType, setSourceType] = useState('')
  const [items, setItems] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const requestIdRef = useRef(0)

  const fetchPage = useCallback(async ({ cursor = null, append = false, signal } = {}) => {
    const requestId = ++requestIdRef.current
    append ? setLoadingMore(true) : setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({ limit: '20' })
      if (sourceType) params.set('sourceType', sourceType)
      if (cursor) params.set('before', cursor)

      const response = await fetch(`/api/chat-history?${params.toString()}`, {
        cache: 'no-store',
        signal,
      })
      const payload = await readResponse(response)
      if (requestId !== requestIdRef.current) return

      const nextItems = Array.isArray(payload.data) ? payload.data : []
      setItems((current) => append ? [...current, ...nextItems] : nextItems)
      setNextCursor(payload.nextCursor || null)
    } catch (fetchError) {
      if (fetchError.name === 'AbortError' || requestId !== requestIdRef.current) return
      setError(fetchError.message || '加载历史记录失败')
    } finally {
      if (requestId === requestIdRef.current) {
        append ? setLoadingMore(false) : setLoading(false)
      }
    }
  }, [sourceType])

  useEffect(() => {
    const controller = new AbortController()
    setItems([])
    setNextCursor(null)
    setLoadingMore(false)
    void fetchPage({ signal: controller.signal })

    return () => controller.abort()
  }, [fetchPage, reloadToken])

  const handleDelete = async (item) => {
    const confirmed = window.confirm(`确定删除“${item.title || '这段对话'}”吗？删除后无法恢复。`)
    if (!confirmed) return

    setDeletingId(item.id)
    setError('')
    try {
      const response = await fetch(`/api/chat-history?id=${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      })
      await readResponse(response)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (deleteError) {
      setError(deleteError.message || '删除失败，请稍后重试')
    } finally {
      setDeletingId(null)
    }
  }

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
              <h1 className="text-xl font-bold">对话历史</h1>
              <p className="text-xs text-muted-foreground">跨设备找回并继续你的学习记录</p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/progress">查看学习进度</Link>
          </Button>
        </div>
      </header>

      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-2" aria-label="对话类型筛选">
          {FILTERS.map((filter) => (
            <Button
              key={filter.value || 'all'}
              type="button"
              size="sm"
              variant={sourceType === filter.value ? 'default' : 'outline'}
              aria-pressed={sourceType === filter.value}
              onClick={() => setSourceType(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        {error ? (
          <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <span>{error}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setReloadToken((value) => value + 1)}>
              <RefreshCw aria-hidden />
              重试
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <RefreshCw className="mr-2 size-5 animate-spin text-muted-foreground" aria-hidden />
            <span className="text-sm text-muted-foreground">正在加载历史记录…</span>
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center px-6 py-14 text-center">
              <BookOpen className="mb-4 size-10 text-muted-foreground" aria-hidden />
              <h2 className="text-lg font-semibold">这里还没有对话</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {sourceType ? '当前分类下暂无记录，可以切换分类或开始一次新练习。' : '完成一次新闻或场景对话后，记录会出现在这里。'}
              </p>
              <Button className="mt-6" asChild>
                <Link href="/talk">开始对话</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {items.map((item) => {
              const source = SOURCE_META[item.sourceType] || { label: '学习对话', icon: MessageCircle }
              const SourceIcon = source.icon
              return (
                <Card key={item.id} className="gap-4 py-5">
                  <CardContent className="px-5 md:px-6">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                            <SourceIcon className="size-3.5" aria-hidden />
                            {source.label}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="size-3.5" aria-hidden />
                            {formatDate(item.updatedAt || item.createdAt)}
                          </span>
                          <span>{Number(item.userTurnCount) || 0} 次发言</span>
                        </div>
                        <h2 className="truncate text-lg font-semibold">{item.title || '未命名对话'}</h2>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {item.preview || '暂无对话摘要，继续练习即可查看完整上下文。'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button size="sm" asChild>
                          <Link href={{ pathname: '/talk', query: { conversation: item.id } }}>继续对话</Link>
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          aria-label={`删除${item.title || '对话'}`}
                          disabled={deletingId === item.id}
                          onClick={() => void handleDelete(item)}
                        >
                          {deletingId === item.id
                            ? <RefreshCw className="animate-spin" aria-hidden />
                            : <Trash2 aria-hidden />}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}

            {nextCursor ? (
              <div className="flex justify-center pt-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => void fetchPage({ cursor: nextCursor, append: true })}
                >
                  {loadingMore ? <RefreshCw className="animate-spin" aria-hidden /> : null}
                  {loadingMore ? '正在加载…' : '加载更多'}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  )
}
