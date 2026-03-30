'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/app/contexts/LanguageContext'

const TYPE_COLORS = {
    word: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    phrase: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    grammar: 'bg-green-500/10 text-green-400 border-green-500/30',
    other: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

const TYPE_LABEL = {
    word: '单词',
    phrase: '短语',
    grammar: '语法',
    other: '其他',
}

export default function VocabularyPage() {
    const { data: session } = useSession()
    const { nativeLanguage } = useLanguage()

    const [records, setRecords] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [before, setBefore] = useState(null)
    const [hasMore, setHasMore] = useState(false)
    const [filter, setFilter] = useState('all')

    const LIMIT = 50

    const fetchRecords = useCallback(async (cursorBefore = null, replace = true) => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams({ limit: String(LIMIT) })
            if (cursorBefore) params.set('before', cursorBefore)
            const res = await fetch(`/api/learning/unfamiliar-english?${params}`)
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to fetch')
            const data = Array.isArray(json.data) ? json.data : []
            setRecords(prev => replace ? data : [...prev, ...data])
            setHasMore(data.length === LIMIT)
            if (data.length > 0) setBefore(data[data.length - 1].timestamp)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        if (session) fetchRecords()
    }, [session, fetchRecords])

    // Flatten all items from all records
    const allItems = records.flatMap(record =>
        (record.items || []).map(item => ({
            ...item,
            context: record.context,
            userMessage: record.user_message,
            timestamp: record.timestamp,
            recordId: record.id,
        }))
    )

    // Deduplicate by text (case-insensitive), keep most recent
    const seen = new Set()
    const uniqueItems = []
    for (const item of allItems) {
        const key = item.text.toLowerCase().trim()
        if (!seen.has(key)) {
            seen.add(key)
            uniqueItems.push(item)
        }
    }

    const filtered = filter === 'all' ? uniqueItems : uniqueItems.filter(i => i.type === filter)

    const uiLang = (nativeLanguage?.code || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en'
    const t = uiLang === 'zh'
        ? { title: '生词本', back: '返回', total: '共', words: '个词', loadMore: '加载更多', noWords: '暂无生词', noWordsDesc: '开始和AI对话，系统会自动提取你不熟悉的单词', all: '全部', context: '语境', from: '来自' }
        : { title: 'Vocabulary', back: 'Back', total: 'Total', words: 'words', loadMore: 'Load more', noWords: 'No words yet', noWordsDesc: 'Start chatting with AI and unfamiliar words will be saved automatically', all: 'All', context: 'Context', from: 'From' }

    return (
        <div className="min-h-screen bg-background">
            <header className="border-b border-border bg-card">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Link
                                href="/talk"
                                className="text-muted-foreground hover:text-foreground transition-colors text-sm"
                            >
                                ← {t.back}
                            </Link>
                            <h1 className="text-xl font-bold text-card-foreground">{t.title}</h1>
                        </div>
                        <span className="text-muted-foreground text-sm">
                            {t.total} {uniqueItems.length} {t.words}
                        </span>
                    </div>
                </div>
            </header>

            <div className="container mx-auto px-4 py-6 max-w-4xl">
                {/* Filter tabs */}
                <div className="flex gap-2 mb-6 flex-wrap">
                    {['all', 'word', 'phrase', 'grammar', 'other'].map(type => (
                        <button
                            key={type}
                            onClick={() => setFilter(type)}
                            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                                filter === type
                                    ? 'bg-foreground text-background border-foreground'
                                    : 'bg-transparent text-muted-foreground border-border hover:border-foreground/50'
                            }`}
                        >
                            {type === 'all' ? t.all : TYPE_LABEL[type] || type}
                            {type === 'all'
                                ? ` (${uniqueItems.length})`
                                : ` (${uniqueItems.filter(i => i.type === type).length})`
                            }
                        </button>
                    ))}
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg mb-4 text-sm">
                        {error}
                    </div>
                )}

                {loading && records.length === 0 ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="text-muted-foreground text-sm">Loading...</div>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="text-4xl mb-4">📚</div>
                        <p className="text-foreground font-medium mb-2">{t.noWords}</p>
                        <p className="text-muted-foreground text-sm max-w-xs">{t.noWordsDesc}</p>
                        <Link href="/talk" className="mt-6 px-4 py-2 border border-red-500 text-red-500 rounded hover:bg-red-500 hover:text-white transition-colors text-sm">
                            {uiLang === 'zh' ? '去对话' : 'Start chatting'}
                        </Link>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {filtered.map((item, idx) => (
                                <div
                                    key={`${item.recordId}-${item.text}-${idx}`}
                                    className="bg-card border border-border rounded-lg p-4 hover:border-border/80 transition-colors"
                                >
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <span className="text-foreground font-semibold text-base break-all">{item.text}</span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ${TYPE_COLORS[item.type] || TYPE_COLORS.other}`}>
                                            {TYPE_LABEL[item.type] || item.type}
                                        </span>
                                    </div>
                                    {item.userMessage && (
                                        <p className="text-muted-foreground text-xs mt-1 line-clamp-2">
                                            <span className="text-muted-foreground/60">{t.from}: </span>
                                            {item.userMessage}
                                        </p>
                                    )}
                                    {item.context && (
                                        <p className="text-muted-foreground text-xs mt-1 line-clamp-1">
                                            <span className="text-muted-foreground/60">{t.context}: </span>
                                            {item.context}
                                        </p>
                                    )}
                                    <p className="text-muted-foreground/40 text-xs mt-2">
                                        {item.timestamp ? new Date(item.timestamp).toLocaleDateString() : ''}
                                    </p>
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
                                    {loading ? 'Loading...' : t.loadMore}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
