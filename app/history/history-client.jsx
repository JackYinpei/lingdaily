'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  Clock3,
  MessageCircle,
  Newspaper,
  RefreshCw,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react'

import { Button } from '@/app/components/ui/button'
import FeatureShell, { FeatureHeading, useFeatureLocale } from '@/app/components/FeatureShell'
import { featureCopy, featureDateLocale } from '@/app/lib/featureCopy'

const FILTERS = [
  { value: '', label: 'all', icon: MessageCircle },
  { value: 'news', label: 'news', icon: Newspaper },
  { value: 'scenario', label: 'scenario', icon: Users },
  { value: 'practice', label: 'practice', icon: Smartphone },
]

const SOURCE_META = {
  news: { label: 'newsConversation', icon: Newspaper },
  scenario: { label: 'scenarioPractice', icon: Users },
  practice: { label: 'practice', icon: Smartphone },
}

function formatDate(value, locale, fallback) {
  if (!value) return fallback

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

async function readResponse(response, fallback) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || fallback)
  }
  return payload
}

export default function HistoryClient() {
  const lang = useFeatureLocale()
  const t = featureCopy[lang]
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
      const payload = await readResponse(response, t.requestFailed)
      if (requestId !== requestIdRef.current) return

      const nextItems = Array.isArray(payload.data) ? payload.data : []
      setItems((current) => append ? [...current, ...nextItems] : nextItems)
      setNextCursor(payload.nextCursor || null)
    } catch (fetchError) {
      if (fetchError.name === 'AbortError' || requestId !== requestIdRef.current) return
      setError(fetchError.message || t.loadFailed)
    } finally {
      if (requestId === requestIdRef.current) {
        append ? setLoadingMore(false) : setLoading(false)
      }
    }
  }, [sourceType, t])

  useEffect(() => {
    const controller = new AbortController()
    setItems([])
    setNextCursor(null)
    setLoadingMore(false)
    void fetchPage({ signal: controller.signal })

    return () => controller.abort()
  }, [fetchPage, reloadToken])

  const handleDelete = async (item) => {
    const confirmed = window.confirm(t.confirmDelete(item.title || t.untitled))
    if (!confirmed) return

    setDeletingId(item.id)
    setError('')
    try {
      const response = await fetch(`/api/chat-history?id=${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      })
      await readResponse(response, t.requestFailed)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (deleteError) {
      setError(deleteError.message || t.deleteFailed)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <FeatureShell active="history">
      <FeatureHeading number="02" eyebrow={t.historyEyebrow} title={t.historyTitle} description={t.historyDescription} icon={MessageCircle} />
      <div>
        <div className="feature-filters mb-6" aria-label={t.filters}>
          {FILTERS.map((filter) => (
            <Button
              key={filter.value || 'all'}
              type="button"
              size="sm"
              variant={sourceType === filter.value ? 'default' : 'outline'}
              aria-pressed={sourceType === filter.value}
              onClick={() => setSourceType(filter.value)}
            >
              <filter.icon size={14} aria-hidden="true" />{t[filter.label]}
            </Button>
          ))}
        </div>

        {error ? (
          <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <span>{error}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => setReloadToken((value) => value + 1)}>
              <RefreshCw aria-hidden />
              {t.retry}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <RefreshCw className="mr-2 size-5 animate-spin text-muted-foreground" aria-hidden />
            <span className="text-sm text-muted-foreground">{t.loadingHistory}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="feature-empty">
              <BookOpen className="mb-4 size-10 text-muted-foreground" aria-hidden />
              <h2>{t.noHistory}</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {sourceType ? t.noFilterHistory : t.noHistoryDescription}
              </p>
              <Button className="mt-6" asChild>
                <Link href="/talk">{t.start}<ArrowRight aria-hidden="true" /></Link>
              </Button>
          </div>
        ) : (
          <div className="feature-history-list">
            {items.map((item) => {
              const source = SOURCE_META[item.sourceType] || { label: 'conversation', icon: MessageCircle }
              const SourceIcon = source.icon
              return (
                <article key={item.id}>
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
                            <SourceIcon className="size-3.5" aria-hidden />
                            {t[source.label]}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="size-3.5" aria-hidden />
                            {formatDate(item.updatedAt || item.createdAt, featureDateLocale[lang], t.unknownTime)}
                          </span>
                          <span>{Number(item.userTurnCount) || 0} {t.turns}</span>
                        </div>
                        <h2 className="feature-history-title break-words">{item.title || t.untitled}</h2>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {item.preview || t.noPreview}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {item.sourceType === 'practice' ? (
                          <span className="text-xs text-muted-foreground">{t.continueApp}</span>
                        ) : (
                          <Button size="sm" asChild>
                            <Link href={{ pathname: '/talk', query: { conversation: item.id } }}>{t.continue}<ArrowRight aria-hidden="true" /></Link>
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          aria-label={`${t.delete} ${item.title || t.conversation}`}
                          disabled={deletingId === item.id}
                          onClick={() => void handleDelete(item)}
                        >
                          {deletingId === item.id
                            ? <RefreshCw className="animate-spin" aria-hidden />
                            : <Trash2 aria-hidden />}
                        </Button>
                      </div>
                    </div>
                </article>
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
                  {loadingMore ? t.loadingMore : t.loadMore}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </FeatureShell>
  )
}
