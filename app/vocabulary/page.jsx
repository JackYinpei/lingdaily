'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/app/contexts/LanguageContext'
import LanguageSelector from '@/app/components/LanguageSelector'
import { ArrowRight, BookOpen, Bookmark, Layers, LetterText, MessageSquare, Shapes } from 'lucide-react'
import FeatureShell, { FeatureHeading, useFeatureLocale } from '@/app/components/FeatureShell'
import { featureCopy } from '@/app/lib/featureCopy'

const TYPE_ICONS = { all: Layers, word: LetterText, phrase: MessageSquare, grammar: Shapes, other: Bookmark }

export default function VocabularyPage() {
    const { data: session, status } = useSession()
    const { learningLanguage } = useLanguage()

    const [records, setRecords] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [before, setBefore] = useState(null)
    const [hasMore, setHasMore] = useState(false)
    const [filter, setFilter] = useState('all')
    const activeRequestRef = useRef(null)

    const LIMIT = 50
    const targetLanguage = learningLanguage?.code || 'en'
    const userId = session?.user?.id

    const fetchRecords = useCallback(async (cursorBefore = null, replace = true) => {
        activeRequestRef.current?.abort()
        const controller = new AbortController()
        activeRequestRef.current = controller
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams({
                limit: String(LIMIT),
                targetLanguage,
            })
            if (cursorBefore) params.set('before', cursorBefore)
            const res = await fetch(`/api/learning/items?${params}`, {
                signal: controller.signal,
                cache: 'no-store',
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to fetch')
            const data = Array.isArray(json.data) ? json.data : []
            setRecords(prev => replace ? data : [...prev, ...data])
            setHasMore(Boolean(json.nextCursor))
            setBefore(json.nextCursor || null)
        } catch (e) {
            if (e.name !== 'AbortError') setError(e.message)
        } finally {
            if (activeRequestRef.current === controller) {
                activeRequestRef.current = null
                setLoading(false)
            }
        }
    }, [targetLanguage])

    useEffect(() => {
        if (status === 'authenticated' && userId) {
            setRecords([])
            setBefore(null)
            setHasMore(false)
            fetchRecords()
        }
        if (status === 'unauthenticated') {
            setLoading(false)
        }

        return () => activeRequestRef.current?.abort()
    }, [status, userId, fetchRecords])

    // Flatten all items from all records
    const allItems = records.flatMap(record =>
        (record.items || []).map(item => ({
            ...item,
            context: record.context,
            userMessage: record.user_message,
            timestamp: record.timestamp,
            recordId: record.id,
            learningLanguageCode: record.learning_language_code || 'en',
            learningLanguageLabel: record.learning_language_label || 'English',
        }))
    )

    // Dedupe only within the same language. NFKC folds equivalent full-width
    // forms while preserving the newest occurrence returned by the API.
    const seen = new Set()
    const uniqueItems = []
    for (const item of allItems) {
        const normalizedText = String(item.text || '').normalize('NFKC').toLowerCase().trim()
        const key = `${item.learningLanguageCode}\u0000${normalizedText}`
        if (!seen.has(key)) {
            seen.add(key)
            uniqueItems.push(item)
        }
    }

    const filtered = filter === 'all' ? uniqueItems : uniqueItems.filter(i => i.type === filter)

    const uiLang = useFeatureLocale()
    const pageCopy = featureCopy[uiLang]
    const t = {
        zh: { total: '共', words: '条', loadMore: '加载更多', noWords: '还没有保存的词条', noWordsDesc: '练习中保存的单词、短语和语法会显示在这里。', noFilteredItems: '这个分类还没有内容', noFilteredItemsDesc: '试试其他分类，或开始一次练习。', all: '全部', context: '语境', from: '来自', meaning: '释义', original: '原文', language: '学习语言', signIn: '登录后查看生词本', signInAction: '去登录', loading: '加载中…', typeLabels: { word: '单词', phrase: '短语', grammar: '语法', other: '其他' } },
        en: { total: 'Total', words: 'items', loadMore: 'Load more', noWords: 'No saved items yet', noWordsDesc: 'Words, phrases and grammar saved during practice appear here.', noFilteredItems: 'No items in this category', noFilteredItemsDesc: 'Try another category or start practicing.', all: 'All', context: 'Context', from: 'From', meaning: 'Meaning', original: 'Original', language: 'Learning language', signIn: 'Sign in to view your vocabulary', signInAction: 'Sign in', loading: 'Loading…', typeLabels: { word: 'Word', phrase: 'Phrase', grammar: 'Grammar', other: 'Other' } },
        ja: { total: '合計', words: '件', loadMore: 'もっと見る', noWords: '保存した項目はまだありません', noWordsDesc: '練習中に保存した単語・フレーズ・文法が表示されます。', noFilteredItems: 'この種類の項目はまだありません', noFilteredItemsDesc: 'ほかの種類を選ぶか、練習を始めてください。', all: 'すべて', context: '文脈', from: '発言', meaning: '意味', original: '原文', language: '学習言語', signIn: 'ログインすると単語帳を確認できます', signInAction: 'ログイン', loading: '読み込み中…', typeLabels: { word: '単語', phrase: 'フレーズ', grammar: '文法', other: 'その他' } },
    }[uiLang]

    if (status === 'unauthenticated') {
        return (
            <FeatureShell active="vocabulary">
                <div className="feature-empty mt-10">
                    <BookOpen aria-hidden="true" />
                    <p className="text-foreground font-medium mb-5">{t.signIn}</p>
                    <Link href="/sign-in?callbackUrl=%2Fvocabulary" className="feature-action">
                        {t.signInAction}
                    </Link>
                </div>
            </FeatureShell>
        )
    }

    return (
        <FeatureShell active="vocabulary">
            <FeatureHeading number="03" eyebrow={pageCopy.vocabularyEyebrow} title={pageCopy.vocabulary} description={pageCopy.vocabularyDescription} icon={BookOpen} />
            <div className="feature-toolbar">
                <LanguageSelector kind="learning" label={t.language} />
                <span className="feature-count">{t.total} {uniqueItems.length} {t.words}</span>
            </div>
            <div>
                {/* Filter tabs */}
                {uniqueItems.length > 0 && <div className="feature-filters mb-6">
                    {['all', 'word', 'phrase', 'grammar', 'other'].map(type => (
                        <button
                            key={type}
                            onClick={() => setFilter(type)}
                            aria-pressed={filter === type}
                        >
                            {(() => { const Icon = TYPE_ICONS[type]; return <Icon size={14} aria-hidden="true" /> })()}
                            {type === 'all' ? t.all : t.typeLabels[type] || type}
                            {type === 'all'
                                ? ` (${uniqueItems.length})`
                                : ` (${uniqueItems.filter(i => i.type === type).length})`
                            }
                        </button>
                    ))}
                </div>}

                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg mb-4 text-sm">
                        {error}
                    </div>
                )}

                {loading && records.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="text-muted-foreground text-sm">{t.loading}</div>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="feature-empty">
                        <BookOpen aria-hidden="true" />
                        <h2>{uniqueItems.length ? t.noFilteredItems : t.noWords}</h2>
                        <p className="text-muted-foreground text-sm max-w-xs">{uniqueItems.length ? t.noFilteredItemsDesc : t.noWordsDesc}</p>
                        <Link href="/talk" className="feature-action mt-6">
                            {pageCopy.start}
                            <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                        {hasMore && (
                            <button
                                onClick={() => fetchRecords(before, false)}
                                disabled={loading}
                                className="mt-3 px-6 py-2 border border-border text-muted-foreground rounded hover:border-foreground/50 hover:text-foreground transition-colors text-sm disabled:opacity-50"
                            >
                                {loading ? t.loading : t.loadMore}
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="feature-vocab-grid">
                            {filtered.map((item, idx) => (
                                <div
                                    key={`${item.recordId}-${item.text}-${idx}`}
                                    className="feature-vocab-item"
                                >
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <span className="feature-term break-words min-w-0">{item.text}</span>
                                        <span className="feature-type shrink-0">
                                            {t.typeLabels[item.type] || item.type}
                                        </span>
                                    </div>
                                    {item.meaning && (
                                        <p className="text-foreground/80 text-sm mt-1">
                                            <span className="text-muted-foreground text-xs">{t.meaning}: </span>
                                            {item.meaning}
                                        </p>
                                    )}
                                    <div className="feature-item-context">
                                    {item.original && item.original !== item.text && (
                                        <blockquote className="text-muted-foreground text-xs leading-6 line-clamp-2">
                                            <span>{t.original}: </span>
                                            {item.original}
                                        </blockquote>
                                    )}
                                    {item.userMessage && (
                                        <p className="text-muted-foreground text-xs mt-1 line-clamp-2">
                                            <span>{t.from}: </span>
                                            {item.userMessage}
                                        </p>
                                    )}
                                    {item.context && (
                                        <p className="text-muted-foreground text-xs mt-1 line-clamp-1">
                                            <span>{t.context}: </span>
                                            {item.context}
                                        </p>
                                    )}
                                    <p className="feature-item-date">
                                        {item.timestamp ? new Date(item.timestamp).toLocaleDateString() : ''}
                                    </p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {hasMore && (
                            <div className="flex justify-center mt-6">
                                <button
                                    onClick={() => fetchRecords(before, false)}
                                    disabled={loading}
                                    className="px-6 py-2 border border-border text-muted-foreground rounded hover:border-foreground/50 hover:text-foreground transition-colors text-sm disabled:opacity-50"
                                >
                                    {loading ? t.loading : t.loadMore}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </FeatureShell>
    )
}
