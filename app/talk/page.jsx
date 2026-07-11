'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from "uuid";
import { useSession } from "next-auth/react"

// UI components
import NewsFeed from "@/app/components/NewsFeed";
import ScenarioFeed from "@/app/components/ScenarioFeed";
import { ModeToggle } from "@/app/components/ModeToggle";
import { History } from "@/app/components/History";

import Link from 'next/link';
import { useLanguage } from '@/app/contexts/LanguageContext';
import { GeminiLiveServiceImpl } from '@/app/lib/GeminiLiveService';
import OnboardingGuide from '@/app/components/OnboardingGuide';
import {
    compactHistoryForKeepalive,
    compactNewsForKeepalive,
    conversationItemKey,
    dedupeManualMessages,
    ensureContextMessage,
    extractMessageText,
    getNewsKey,
    hasUserMessage,
    mergeConversationHistory,
} from './_lib/conversation';
import {
    buildInstructions,
    buildResumeContext,
    buildTopicContext,
    createNewsContextMessage,
} from './_lib/prompts';
import { fetchRealtimeTokenAfterPriming } from './_lib/liveConnection';

export default function Home() {
    const { data: userSession, status: sessionStatus } = useSession()
    const { learningLanguage, nativeLanguage, loading: isLanguageLoading } = useLanguage()
    const activeLanguagePair = useMemo(() => ({
        learningLanguage: {
            code: learningLanguage?.code || 'en',
            label: learningLanguage?.label || 'English',
        },
        nativeLanguage: {
            code: nativeLanguage?.code || 'zh-CN',
            label: nativeLanguage?.label || '中文',
        },
    }), [
        learningLanguage?.code,
        learningLanguage?.label,
        nativeLanguage?.code,
        nativeLanguage?.label,
    ]);
    const uiLangCode = useMemo(() => {
        const code = (nativeLanguage?.code || 'en').toLowerCase();
        if (code.startsWith('zh')) return 'zh';
        if (code.startsWith('ja')) return 'ja';
        return 'en';
    }, [nativeLanguage?.code]);

    // Gemini Service Ref
    const serviceRef = useRef(null);
    const onMessageRef = useRef(null);

    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [history, setHistory] = useState([]);
    const [error, setError] = useState(null);
    const [isRestoringConversation, setIsRestoringConversation] = useState(true);
    const [isTopicHistoryLoading, setIsTopicHistoryLoading] = useState(false);

    const [mode, setMode] = useState('news'); // 'news' | 'scenario'
    const [isDesktopLayout, setIsDesktopLayout] = useState(null)
    const [selectedNews, setSelectedNews] = useState(null)
    const selectedNewsRef = useRef(null)
    const historyRef = useRef([])
    const conversationMetaRef = useRef(new Map())
    const conversationBaselineRef = useRef(new Map())
    const persistTimeoutRef = useRef(null)
    const pendingPersistRef = useRef(null)
    const persistQueueRef = useRef(Promise.resolve())
    const flushPendingRef = useRef(() => Promise.resolve())
    const skipNextNewsLoadRef = useRef(false)
    const topicHistoryLoadingRef = useRef(false)
    const lastUnloadFingerprintRef = useRef(null)
    const topicGenerationRef = useRef(0)
    const languageGenerationRef = useRef(0)
    const connectionAttemptSequenceRef = useRef(0)
    const activeConnectionAttemptRef = useRef(0)
    const connectionAbortControllerRef = useRef(null)
    const languagePairKey = `${activeLanguagePair.learningLanguage.code}:${activeLanguagePair.nativeLanguage.code}`
    const previousLanguagePairKeyRef = useRef(languagePairKey)
    const identityStateRef = useRef({ initialized: false, userId: null })
    const identityGenerationRef = useRef(0)

    // When category changes, clear the selected news (which cascades to clearing chat history)
    const handleCategoryChange = useCallback(() => {
        flushPendingRef.current();
        topicGenerationRef.current += 1;
        if (activeConnectionAttemptRef.current !== 0) {
            activeConnectionAttemptRef.current = 0;
            connectionAbortControllerRef.current?.abort();
            connectionAbortControllerRef.current = null;
            serviceRef.current?.disconnect();
            setIsConnecting(false);
        }
        setSelectedNews(null);
    }, []);

    const handleModeToggle = useCallback((newMode) => {
        flushPendingRef.current();
        topicGenerationRef.current += 1;
        if (activeConnectionAttemptRef.current !== 0) {
            activeConnectionAttemptRef.current = 0;
            connectionAbortControllerRef.current?.abort();
            connectionAbortControllerRef.current = null;
            serviceRef.current?.disconnect();
            setIsConnecting(false);
        }
        setMode(newMode);
        setSelectedNews(null);
        try { localStorage.setItem('talk-mode', newMode); } catch (_) { /* ignore */ }
    }, []);

    const handleArticleSelect = useCallback((news) => {
        if (selectedNewsRef.current
            && getNewsKey(selectedNewsRef.current) === getNewsKey(news)) return;
        flushPendingRef.current();
        topicGenerationRef.current += 1;
        if (activeConnectionAttemptRef.current !== 0) {
            activeConnectionAttemptRef.current = 0;
            connectionAbortControllerRef.current?.abort();
            connectionAbortControllerRef.current = null;
            serviceRef.current?.disconnect();
            setIsConnecting(false);
        }
        topicHistoryLoadingRef.current = true;
        setIsTopicHistoryLoading(true);
        setSelectedNews(news);
    }, []);

    const handleArticleUpdate = useCallback((patch) => {
        const current = selectedNewsRef.current;
        if (!current || current._isScenario || !patch || typeof patch !== 'object') return;
        const matchesArticle = (patch.id && patch.id === current.id)
            || (patch.link && patch.link === current.link);
        if (!matchesArticle) return;
        const updated = {
            ...current,
            translatedTitle: patch.translatedTitle,
            translatedLanguageCode: patch.translatedLanguageCode,
            title: patch.title || current.title,
        };
        selectedNewsRef.current = updated;
        try { localStorage.setItem('selectedNews', JSON.stringify(updated)); } catch (_) { /* ignore */ }

        // Do not abort an in-flight history request merely because an optional
        // headline translation arrived. The updated ref will still be used for
        // subsequent persistence and Live context.
        if (topicHistoryLoadingRef.current) return;

        const contextMessage = createNewsContextMessage(updated, activeLanguagePair);
        const nextHistory = ensureContextMessage(historyRef.current, contextMessage);
        historyRef.current = nextHistory;
        setHistory(nextHistory);
        skipNextNewsLoadRef.current = true;
        setSelectedNews(updated);
    }, [activeLanguagePair]);

    // Only mount one content feed. Keeping both responsive variants mounted
    // caused duplicate Kagi and Gemini translation requests.
    useEffect(() => {
        const mediaQuery = window.matchMedia('(min-width: 1024px)');
        const syncLayout = () => setIsDesktopLayout(mediaQuery.matches);
        syncLayout();
        if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', syncLayout);
        else mediaQuery.addListener?.(syncLayout);
        return () => {
            if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', syncLayout);
            else mediaQuery.removeListener?.(syncLayout);
        };
    }, []);

    // UI strings ...
    const uiText = useMemo(() => ({
        en: { history: 'History', vocab: 'Vocabulary' },
        zh: { history: '对话历史', vocab: '生词本' },
        ja: { history: '履歴', vocab: '単語帳' },
    }[uiLangCode]), [uiLangCode]);

    // Persist sequentially so an older response cannot overwrite a newer
    // snapshot. Revision conflicts merge messages by itemId and retry once.
    const persistConversation = useCallback(async (
        news,
        conversationHistory,
        {
            keepalive = false,
            mergeOnServer = false,
            userId = userSession?.user?.id || null,
            identityGeneration = identityGenerationRef.current,
        } = {},
    ) => {
        const isCurrentIdentity = () => (
            identityGeneration === identityGenerationRef.current
            && userId === (userSession?.user?.id || null)
        );
        if (!news || !hasUserMessage(conversationHistory) || !userId || !isCurrentIdentity()) return;

        const newsKey = getNewsKey(news);
        const baseline = conversationBaselineRef.current.get(newsKey) || [];
        let historyToSave = mergeConversationHistory(baseline, conversationHistory);
        if (keepalive) historyToSave = compactHistoryForKeepalive(historyToSave);
        let expectedRevision = conversationMetaRef.current.get(newsKey)?.revision ?? 0;

        for (let attempt = 0; attempt < 2; attempt += 1) {
            if (!isCurrentIdentity()) return;
            const payload = {
                newsKey,
                newsTitle: news.originalTitle || news.title || news.id || 'Untitled',
                history: historyToSave,
                summary: null,
                sourceType: news._isScenario ? 'scenario' : 'news',
                revision: expectedRevision,
                mergeOnServer,
                newsContent: mergeOnServer ? compactNewsForKeepalive(news) : news,
            };

            try {
                const res = await fetch('/api/chat-history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    keepalive,
                });
                const json = await res.json().catch(() => ({}));
                if (!isCurrentIdentity()) return;

                if (res.status === 409) {
                    const current = [json.current, json.conflict, json.data]
                        .find((value) => value && typeof value === 'object');
                    if (attempt === 0 && current && Array.isArray(current.history)) {
                        historyToSave = mergeConversationHistory(current.history, historyToSave);
                        expectedRevision = current.revision ?? null;
                        conversationBaselineRef.current.set(newsKey, historyToSave);
                        if (pendingPersistRef.current?.news
                            && getNewsKey(pendingPersistRef.current.news) === newsKey) {
                            pendingPersistRef.current = {
                                ...pendingPersistRef.current,
                                history: mergeConversationHistory(
                                    historyToSave,
                                    pendingPersistRef.current.history,
                                ),
                            };
                        }
                        conversationMetaRef.current.set(newsKey, {
                            id: current.id,
                            revision: current.revision,
                        });
                        continue;
                    }
                }

                if (!res.ok) {
                    console.error('Failed to persist chat history:', json?.error || res.status);
                    return;
                }
                if (json?.skipped) return;

                const saved = json?.data;
                if (saved?.id) {
                    const existingMeta = conversationMetaRef.current.get(newsKey);
                    const savedRevision = saved.revision ?? expectedRevision;
                    if (!existingMeta?.revision || !savedRevision || savedRevision >= existingMeta.revision) {
                        conversationMetaRef.current.set(newsKey, {
                            id: saved.id,
                            revision: savedRevision,
                        });
                    }
                }
                const savedHistory = mergeConversationHistory(
                    conversationBaselineRef.current.get(newsKey) || [],
                    Array.isArray(saved?.history) ? saved.history : historyToSave,
                );
                conversationBaselineRef.current.set(newsKey, savedHistory);
                if (getNewsKey(selectedNewsRef.current) === newsKey) {
                    const visibleHistory = mergeConversationHistory(savedHistory, historyRef.current);
                    historyRef.current = visibleHistory;
                    if (attempt > 0) setHistory(visibleHistory);
                }
                return;
            } catch (saveError) {
                console.error('Error saving chat history:', saveError);
                return;
            }
        }
    }, [userSession?.user?.id]);

    const enqueueConversationPersist = useCallback((snapshot) => {
        persistQueueRef.current = persistQueueRef.current
            .catch(() => undefined)
            .then(() => persistConversation(snapshot.news, snapshot.history, {
                userId: snapshot.userId,
                identityGeneration: snapshot.identityGeneration,
            }));
        return persistQueueRef.current;
    }, [persistConversation]);

    const flushPendingConversation = useCallback(({
        keepalive = false,
        mergeOnServer = false,
    } = {}) => {
        if (persistTimeoutRef.current) {
            clearTimeout(persistTimeoutRef.current);
            persistTimeoutRef.current = null;
        }
        const snapshot = pendingPersistRef.current || (
            selectedNewsRef.current && hasUserMessage(historyRef.current)
                ? {
                    news: selectedNewsRef.current,
                    history: historyRef.current,
                    userId: userSession?.user?.id || null,
                    identityGeneration: identityGenerationRef.current,
                }
                : null
        );
        pendingPersistRef.current = null;
        if (!snapshot) return Promise.resolve();
        if (keepalive) {
            // Starting the fetch directly is important during pagehide; a
            // queued Promise may never run once the page is discarded.
            return persistConversation(snapshot.news, snapshot.history, {
                keepalive: true,
                mergeOnServer,
                userId: snapshot.userId,
                identityGeneration: snapshot.identityGeneration,
            });
        }
        return enqueueConversationPersist(snapshot);
    }, [enqueueConversationPersist, persistConversation, userSession?.user?.id]);

    flushPendingRef.current = flushPendingConversation;

    // Delay frequent streaming updates, while retaining the exact news object
    // associated with each snapshot so topic switches cannot cancel each other.
    const scheduleConversationPersist = useCallback((news, conversationHistory) => {
        if (!news || !hasUserMessage(conversationHistory) || !userSession?.user?.id) return;
        pendingPersistRef.current = {
            news,
            history: dedupeManualMessages(conversationHistory),
            userId: userSession.user.id,
            identityGeneration: identityGenerationRef.current,
        };
        if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = setTimeout(() => {
            flushPendingConversation();
        }, 800);
    }, [flushPendingConversation, userSession?.user?.id]);

    useEffect(() => {
        historyRef.current = history;
    }, [history]);

    useEffect(() => {
        const flushForUnload = () => {
            const currentNews = selectedNewsRef.current;
            const currentHistory = historyRef.current;
            if (!currentNews || !hasUserMessage(currentHistory)) return;
            const lastItem = currentHistory[currentHistory.length - 1];
            const fingerprint = [
                getNewsKey(currentNews),
                currentHistory.length,
                conversationItemKey(lastItem),
                extractMessageText(lastItem).length,
                Boolean(lastItem?.metadata?.isFinal),
            ].join('|');
            if (lastUnloadFingerprintRef.current === fingerprint) return;
            lastUnloadFingerprintRef.current = fingerprint;
            flushPendingRef.current({ keepalive: true, mergeOnServer: true });
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') flushForUnload();
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pagehide', flushForUnload);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pagehide', flushForUnload);
            flushForUnload();
        };
    }, []);

    // localStorage helpers for selected news
    const saveSelectedNewsToStorage = (news) => {
        try {
            localStorage.setItem('selectedNews', JSON.stringify(news));
        } catch (error) {
            console.error('Failed to save selectedNews to localStorage:', error);
        }
    };

    const loadSelectedNewsFromStorage = () => {
        try {
            const saved = localStorage.getItem('selectedNews');
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            console.error('Failed to load selectedNews from localStorage:', error);
            return null;
        }
    };

    // Never carry a private topic, transcript, or pending connection across an
    // in-place sign-in/sign-out or account switch.
    useEffect(() => {
        if (sessionStatus === 'loading') return;
        const currentUserId = userSession?.user?.id || null;
        if (!identityStateRef.current.initialized) {
            identityStateRef.current = { initialized: true, userId: currentUserId };
            return;
        }
        if (identityStateRef.current.userId === currentUserId) return;
        identityStateRef.current = { initialized: true, userId: currentUserId };
        identityGenerationRef.current += 1;

        if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
        pendingPersistRef.current = null;
        activeConnectionAttemptRef.current = 0;
        connectionAbortControllerRef.current?.abort();
        connectionAbortControllerRef.current = null;
        serviceRef.current?.disconnect();
        topicGenerationRef.current += 1;
        conversationMetaRef.current.clear();
        conversationBaselineRef.current.clear();
        selectedNewsRef.current = null;
        historyRef.current = [];
        skipNextNewsLoadRef.current = false;
        topicHistoryLoadingRef.current = false;
        setSelectedNews(null);
        setHistory([]);
        setIsConnected(false);
        setIsConnecting(false);
        setIsTopicHistoryLoading(false);
        try { localStorage.removeItem('selectedNews'); } catch (_) { /* ignore */ }
    }, [sessionStatus, userSession?.user?.id]);

    // Flush the current transcript before a language switch causes topic
    // context to be rebuilt. A connecting socket is also cancelled so it can
    // never finish setup with the previous tool language declaration.
    useEffect(() => {
        if (previousLanguagePairKeyRef.current === languagePairKey) return;
        previousLanguagePairKeyRef.current = languagePairKey;
        languageGenerationRef.current += 1;
        topicGenerationRef.current += 1;
        flushPendingRef.current();

        const service = serviceRef.current;
        const hadActiveAttempt = activeConnectionAttemptRef.current !== 0
            || isConnecting
            || Boolean(service?.session || service?.webSocket);
        if (hadActiveAttempt) {
            activeConnectionAttemptRef.current = 0;
            connectionAbortControllerRef.current?.abort();
            connectionAbortControllerRef.current = null;
            service?.disconnect();
            setIsConnected(false);
            setIsConnecting(false);
            setError('学习语言已更改，请重新连接以使用新的语言组合。');
        }
    }, [isConnecting, languagePairKey]);

    // Restore a conversation selected from /history before falling back to the
    // browser's last selected topic. The skip ref prevents the topic effect
    // from immediately replacing the restored history with a second request.
    useEffect(() => {
        if (sessionStatus === 'loading' || isLanguageLoading) return undefined;
        setIsRestoringConversation(true);
        const controller = new AbortController();

        const restoreInitialConversation = async () => {
            try {
                const conversationId = new URL(window.location.href).searchParams.get('conversation');
                if (conversationId && userSession?.user?.id) {
                    const response = await fetch(
                        `/api/chat-history?id=${encodeURIComponent(conversationId)}`,
                        { cache: 'no-store', signal: controller.signal },
                    );
                    const json = await response.json().catch(() => ({}));
                    if (!response.ok || !json?.data) {
                        throw new Error(json?.error || `Failed to restore conversation: ${response.status}`);
                    }

                    const row = json.data;
                    const isScenario = row.sourceType === 'scenario';
                    const fallbackNews = {
                        id: row.newsKey,
                        title: row.title || row.newsTitle || 'Saved conversation',
                        originalTitle: row.title || row.newsTitle || 'Saved conversation',
                        ...(isScenario
                            ? { _isScenario: true, _scenarioId: row.newsKey?.replace(/^scenario:/, '') }
                            : {}),
                    };
                    const embeddedNews = row.newsContent || row.news;
                    const restoredNews = embeddedNews && typeof embeddedNews === 'object'
                        ? { ...embeddedNews, ...(isScenario ? { _isScenario: true } : {}) }
                        : fallbackNews;
                    const newsKey = getNewsKey(restoredNews);
                    const contextMessage = createNewsContextMessage(restoredNews, activeLanguagePair);
                    const restoredHistory = ensureContextMessage(row.history, contextMessage);

                    conversationMetaRef.current.set(newsKey, {
                        id: row.id,
                        revision: row.revision ?? null,
                    });
                    conversationBaselineRef.current.set(newsKey, restoredHistory);
                    selectedNewsRef.current = restoredNews;
                    historyRef.current = restoredHistory;
                    skipNextNewsLoadRef.current = true;
                    setMode(isScenario ? 'scenario' : 'news');
                    setSelectedNews(restoredNews);
                    setHistory(restoredHistory);
                    try { localStorage.setItem('talk-mode', isScenario ? 'scenario' : 'news'); } catch (_) { /* ignore */ }
                    return;
                }

                try {
                    const savedMode = localStorage.getItem('talk-mode');
                    if (savedMode === 'news' || savedMode === 'scenario') setMode(savedMode);
                } catch (_) { /* ignore */ }
                const savedNews = loadSelectedNewsFromStorage();
                if (savedNews) setSelectedNews(savedNews);
            } catch (restoreError) {
                if (restoreError.name === 'AbortError') return;
                console.error('Failed to restore saved conversation:', restoreError);
                setError(restoreError.message || 'Failed to restore saved conversation');
                const savedNews = loadSelectedNewsFromStorage();
                if (savedNews) setSelectedNews(savedNews);
            } finally {
                if (!controller.signal.aborted) setIsRestoringConversation(false);
            }
        };

        restoreInitialConversation();
        return () => controller.abort();
    }, [activeLanguagePair, isLanguageLoading, sessionStatus, userSession?.user?.id]);

    // 当选择新闻时保存引用，并尝试从服务端读取对应的历史记录
    useEffect(() => {
        if (!selectedNews) {
            selectedNewsRef.current = null;
            historyRef.current = [];
            topicHistoryLoadingRef.current = false;
            setIsTopicHistoryLoading(false);
            setHistory([]);
            return;
        }

        selectedNewsRef.current = selectedNews;
        saveSelectedNewsToStorage(selectedNews);
        const contextMessage = createNewsContextMessage(selectedNews, activeLanguagePair);

        if (skipNextNewsLoadRef.current) {
            skipNextNewsLoadRef.current = false;
            topicHistoryLoadingRef.current = false;
            setIsTopicHistoryLoading(false);
            return;
        }

        // Clear history immediately to prevent showing stale content from previous article
        historyRef.current = [];
        setHistory([]);

        if (!userSession?.user?.id) {
            const seededHistory = ensureContextMessage([], contextMessage);
            historyRef.current = seededHistory;
            setHistory(seededHistory);
            topicHistoryLoadingRef.current = false;
            setIsTopicHistoryLoading(false);
            return;
        }

        topicHistoryLoadingRef.current = true;
        setIsTopicHistoryLoading(true);
        const controller = new AbortController();
        const notifyConnectedService = (conversationHistory) => {
            if (!serviceRef.current?.session) return;
            if (hasUserMessage(conversationHistory)) {
                serviceRef.current.sendContextMessage(
                    buildResumeContext(selectedNews, conversationHistory, activeLanguagePair),
                );
            } else if (selectedNews._isScenario) {
                const scenarioContext = buildTopicContext(selectedNews, activeLanguagePair);
                serviceRef.current.sendContextMessage(
                    `[System Update] The user has switched to a new scenario. Please start this role-play:\n${scenarioContext}`,
                );
            } else {
                const newsContext = buildTopicContext(selectedNews, activeLanguagePair);
                serviceRef.current.sendContextMessage(
                    `[System Update] The user has switched to a new news article. Please focus on this new content:\n${newsContext}`,
                );
            }
        };
        const loadConversation = async () => {
            try {
                const newsKey = getNewsKey(selectedNews);
                const res = await fetch(`/api/chat-history?newsKey=${encodeURIComponent(newsKey)}`, {
                    cache: 'no-store',
                    signal: controller.signal,
                });
                if (!res.ok) {
                    throw new Error(`Failed to load conversation: ${res.status}`);
                }
                const json = await res.json().catch(() => ({}));
                const rows = Array.isArray(json?.data) ? json.data : [];
                if (rows.length > 0 && Array.isArray(rows[0]?.history)) {
                    const nextHistory = ensureContextMessage(rows[0].history, contextMessage);
                    conversationMetaRef.current.set(newsKey, {
                        id: rows[0].id,
                        revision: rows[0].revision ?? null,
                    });
                    conversationBaselineRef.current.set(newsKey, nextHistory);
                    historyRef.current = nextHistory;
                    setHistory(nextHistory);
                    notifyConnectedService(nextHistory);
                } else {
                    const seededHistory = ensureContextMessage([], contextMessage);
                    conversationBaselineRef.current.set(newsKey, seededHistory);
                    historyRef.current = seededHistory;
                    setHistory(seededHistory);
                    notifyConnectedService(seededHistory);
                }
            } catch (error) {
                if (error.name === 'AbortError') return;
                console.error('Failed to load conversation from server:', error);
                const fallbackHistory = ensureContextMessage([], contextMessage);
                conversationBaselineRef.current.set(getNewsKey(selectedNews), fallbackHistory);
                historyRef.current = fallbackHistory;
                setHistory(fallbackHistory);
                notifyConnectedService(fallbackHistory);
            } finally {
                if (!controller.signal.aborted) {
                    const latestNews = selectedNewsRef.current;
                    if (
                        latestNews
                        && latestNews !== selectedNews
                        && getNewsKey(latestNews) === getNewsKey(selectedNews)
                    ) {
                        const latestContext = createNewsContextMessage(latestNews, activeLanguagePair);
                        const reconciledHistory = ensureContextMessage(historyRef.current, latestContext);
                        historyRef.current = reconciledHistory;
                        setHistory(reconciledHistory);
                        skipNextNewsLoadRef.current = true;
                        setSelectedNews(latestNews);
                    }
                    topicHistoryLoadingRef.current = false;
                    setIsTopicHistoryLoading(false);
                }
            }
        };

        loadConversation();
        return () => controller.abort();
    }, [activeLanguagePair, selectedNews, userSession?.user?.id]);


    // Handle Gemini Message
    const handleGeminiMessage = useCallback((text, isFinal, role) => {
        if (topicHistoryLoadingRef.current) return;
        lastUnloadFingerprintRef.current = null;
        setHistory(prev => {
            const prevHistory = [...prev];
            const lastMsg = prevHistory[prevHistory.length - 1];

            // Update existing message (streaming)
            if (lastMsg && lastMsg.role === (role === 'model' ? 'assistant' : 'user') && !lastMsg.metadata?.isFinal) {
                const updatedMsg = {
                    ...lastMsg,
                    content: [{
                        type: role === 'model' ? 'output_text' : 'input_text',
                        text: lastMsg.content[0].text + (text || "") // Append or keep same if empty
                    }],
                    metadata: {
                        ...lastMsg.metadata,
                        isFinal: isFinal
                    }
                };

                const newHistory = [...prevHistory.slice(0, -1), updatedMsg];

                // Persist if final
                if (isFinal && selectedNewsRef.current) {
                    scheduleConversationPersist(selectedNewsRef.current, newHistory);
                }

                historyRef.current = newHistory;
                return newHistory;
            }

            // Create new message
            if (text) {
                const newMsg = {
                    itemId: uuidv4(),
                    type: 'message',
                    role: role === 'model' ? 'assistant' : 'user',
                    content: [{
                        type: role === 'model' ? 'output_text' : 'input_text',
                        text: text
                    }],
                    metadata: {
                        isFinal: isFinal,
                        createdAt: new Date().toISOString()
                    }
                };

                const newHistory = [...prevHistory, newMsg];
                if (isFinal && selectedNewsRef.current) {
                    scheduleConversationPersist(selectedNewsRef.current, newHistory);
                }
                historyRef.current = newHistory;
                return newHistory;
            }

            // Finalize command for empty text
            if (!text && isFinal && lastMsg && !lastMsg.metadata?.isFinal) {
                const finalizedMsg = { ...lastMsg, metadata: { ...lastMsg.metadata, isFinal: true } };
                const newHistory = [...prevHistory.slice(0, -1), finalizedMsg];
                if (selectedNewsRef.current) {
                    scheduleConversationPersist(selectedNewsRef.current, newHistory);
                }
                historyRef.current = newHistory;
                return newHistory;
            }

            return prevHistory;
        });
    }, [scheduleConversationPersist]);

    // The Live service survives normal React renders. Update the forwarding
    // callback only after commit; the earlier identity-reset effect disconnects
    // the previous account's socket before this effect installs the new user.
    useEffect(() => {
        onMessageRef.current = handleGeminiMessage;
    }, [handleGeminiMessage]);

    const initService = useCallback(() => {
        if (!serviceRef.current) {
            const config = {
                onMessage: (...args) => onMessageRef.current?.(...args),
                onConnectionUpdate: (connected) => {
                    setIsConnected(connected);
                    setIsConnecting(false);
                },
                onError: (err) => {
                    setError(err);
                    setIsConnected(false);
                    setIsConnecting(false);
                },
                onPlaybackError: (err) => setError(err),
            };

            serviceRef.current = new GeminiLiveServiceImpl(config);
        }
    }, []);

    async function connect() {
        if (isConnecting || activeConnectionAttemptRef.current !== 0) {
            activeConnectionAttemptRef.current = 0;
            connectionAbortControllerRef.current?.abort();
            connectionAbortControllerRef.current = null;
            serviceRef.current?.disconnect();
            setIsConnected(false);
            setIsConnecting(false);
            setError('已取消连接。');
            return;
        }
        setError(null);
        if (isLanguageLoading || isRestoringConversation || topicHistoryLoadingRef.current) {
            setError('正在恢复对话，请稍候再连接。');
            return;
        }
        if (isConnected) {
            activeConnectionAttemptRef.current = 0;
            connectionAbortControllerRef.current?.abort();
            connectionAbortControllerRef.current = null;
            serviceRef.current?.disconnect();
            setIsConnected(false);
        } else {
            // Clear any half-open service state before priming audio for this
            // new, user-initiated attempt.
            connectionAbortControllerRef.current?.abort();
            connectionAbortControllerRef.current = null;
            serviceRef.current?.disconnect();
            const connectionAttemptId = ++connectionAttemptSequenceRef.current;
            activeConnectionAttemptRef.current = connectionAttemptId;
            connectionAbortControllerRef.current?.abort();
            const connectionController = new AbortController();
            connectionAbortControllerRef.current = connectionController;
            const isCurrentAttempt = () => (
                activeConnectionAttemptRef.current === connectionAttemptId
            );
            const finishCurrentAttempt = () => {
                if (!isCurrentAttempt()) return false;
                activeConnectionAttemptRef.current = 0;
                if (connectionAbortControllerRef.current === connectionController) {
                    connectionAbortControllerRef.current = null;
                }
                setIsConnecting(false);
                return true;
            };
            const connectionTopicGeneration = topicGenerationRef.current;
            const connectionLanguageGeneration = languageGenerationRef.current;
            const connectionLanguagePair = activeLanguagePair;
            setIsConnecting(true);

            // ── Prime AudioContext FIRST, synchronously, before any await ──
            // Chrome's user gesture activation window (~5s) may expire during
            // the token fetch + WebSocket setup. Creating & resuming now ensures
            // the first audio chunk plays without requiring another interaction.
            initService();

            // Fetch ephemeral token
            let token;
            const tokenTimeout = setTimeout(() => connectionController.abort(), 15000);
            try {
                token = await fetchRealtimeTokenAfterPriming({
                    service: serviceRef.current,
                    signal: connectionController.signal,
                });
            } catch (e) {
                if (isCurrentAttempt()) {
                    setError("Connection Failed: " + e.message);
                    serviceRef.current?.disconnect();
                    finishCurrentAttempt();
                }
                return;
            } finally {
                clearTimeout(tokenTimeout);
            }

            if (
                !isCurrentAttempt()
                || connectionTopicGeneration !== topicGenerationRef.current
                || connectionLanguageGeneration !== languageGenerationRef.current
            ) {
                if (isCurrentAttempt()) {
                    serviceRef.current?.disconnect();
                    finishCurrentAttempt();
                }
                return;
            }

            const savedHistory = historyRef.current;
            const isResuming = hasUserMessage(savedHistory);
            const connectedNewsKey = getNewsKey(selectedNewsRef.current);

            // Build Context Prompt
            const baseInstructions = buildInstructions(
                uiLangCode,
                nativeLanguage?.label || '中文',
                learningLanguage?.label || 'English',
                selectedNewsRef.current?._isScenario || false,
                isResuming,
            );

            let didConnect = false;
            try {
                didConnect = await serviceRef.current?.connect(
                    baseInstructions,
                    token,
                    connectionLanguagePair,
                );
            } catch (connectionError) {
                if (isCurrentAttempt() && (
                    connectionTopicGeneration === topicGenerationRef.current
                    && connectionLanguageGeneration === languageGenerationRef.current
                )) {
                    setError(`Connection Failed: ${connectionError.message}`);
                    finishCurrentAttempt();
                }
                return;
            }

            if (
                !isCurrentAttempt()
            ) return;

            if (
                !didConnect
                || connectionTopicGeneration !== topicGenerationRef.current
                || connectionLanguageGeneration !== languageGenerationRef.current
                || connectedNewsKey !== getNewsKey(selectedNewsRef.current)
            ) {
                serviceRef.current?.disconnect();
                setIsConnected(false);
                finishCurrentAttempt();
                if (didConnect) setError('话题或学习语言已切换，请重新连接以开始当前对话。');
                return;
            }

            // Once connected, either resume the saved transcript or seed a
            // fresh topic and ask for the normal bilingual introduction.
            if (selectedNewsRef.current && serviceRef.current) {
                const current = selectedNewsRef.current;
                const nativeL = nativeLanguage?.label || '中文';
                const targetL = learningLanguage?.label || 'English';

                if (isResuming) {
                    await serviceRef.current.sendContextMessage(
                        buildResumeContext(current, savedHistory, connectionLanguagePair),
                    );
                } else if (current._isScenario) {
                    const scenarioContext = buildTopicContext(current, connectionLanguagePair);
                    const openingGuide = uiLangCode === 'en'
                        ? `Please start the scenario role-play now using a natural mix of ${nativeL} and ${targetL}.`
                        : uiLangCode === 'ja'
                        ? `今すぐ${nativeL}と${targetL}を混ぜてシナリオのロールプレイを始めてください。`
                        : `请现在用${nativeL}和${targetL}夹杂的方式开始这个场景的角色扮演。`;
                    await serviceRef.current.sendContextMessage(
                        `[System Initialize] The user wants to practice a scenario.\n${openingGuide}\n\n${scenarioContext}`
                    );
                } else {
                    const newsContext = buildTopicContext(current, connectionLanguagePair);
                    const openingGuide = uiLangCode === 'en'
                        ? `Please introduce this news now using a natural mix of ${nativeL} and ${targetL}, then invite the user to discuss.`
                        : uiLangCode === 'ja'
                        ? `このニュースを今すぐ${nativeL}と${targetL}を混ぜて自然に紹介し、ユーザーに議論を促してください。`
                        : `请现在用${nativeL}和${targetL}夹杂的方式简短介绍这篇新闻的主要内容，然后邀请用户展开讨论。`;
                    await serviceRef.current.sendContextMessage(
                        `[System Initialize] The user is viewing the following news article.\n${openingGuide}\n\n${newsContext}`
                    );
                }
            }
            if (isCurrentAttempt()) activeConnectionAttemptRef.current = 0;
        }
    }

    async function toggleMute() {
        if (!serviceRef.current) return;
        const newMuted = !isMuted;
        serviceRef.current.setMuted(newMuted);
        setIsMuted(newMuted);
    }

    // 文本输入消息发送，并将本地 history 与后端同步
    const sendTextMessage = async function (input) {
        if (isLanguageLoading || isRestoringConversation || topicHistoryLoadingRef.current) {
            setError('正在恢复对话，请稍候再发送。');
            return;
        }
        if (isConnecting) {
            setError('连接仍在建立，请连接完成后再发送。');
            return;
        }
        if (!serviceRef.current || !isConnected) {
            setError('请先连接 Gemini Live，再发送消息。');
            return;
        }
        await serviceRef.current.sendText(input);
    }

    // Clean up on unmount
    useEffect(() => {
        return () => {
            activeConnectionAttemptRef.current = 0;
            connectionAbortControllerRef.current?.abort();
            connectionAbortControllerRef.current = null;
            serviceRef.current?.disconnect();
        };
    }, []);

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <header className="border-b border-border bg-card hidden md:block">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-card-foreground">
                                {activeLanguagePair.learningLanguage.label} Learning Hub
                            </h1>
                            <p className="text-muted-foreground mt-1">
                                Learn {activeLanguagePair.learningLanguage.label} through news and AI conversation
                            </p>
                        </div>
                        <div className="flex items-center gap-4">
                            <Link
                                href="/history"
                                className="px-4 py-2 border border-border text-foreground rounded hover:bg-accent transition-colors text-sm font-medium"
                            >
                                {uiText?.history || '对话历史'}
                            </Link>
                            <Link
                                href="/vocabulary"
                                className="px-4 py-2 border border-border text-foreground rounded hover:bg-accent transition-colors text-sm font-medium"
                            >
                                {uiText?.vocab || '生词本'}
                            </Link>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <div
                className="container mx-auto px-4 py-2 flex flex-col h-screen lg:h-auto lg:min-h-0"
                style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
            >
                <div className="flex flex-col lg:flex-row lg:gap-6 flex-1 min-h-0 lg:h-[calc(100vh-140px)]">
                    {/* Mobile Cards - 在中等屏幕以下显示 */}
                    {isDesktopLayout === false && <div className="lg:hidden flex-shrink-0">
                        <div className="flex items-center justify-between mb-1">
                            <h2 className="text-xl font-semibold text-foreground">
                                {mode === 'news' ? 'Latest News' : (uiLangCode === 'zh' ? '场景练习' : uiLangCode === 'ja' ? 'シナリオ' : 'Scenarios')}
                            </h2>
                            <ModeToggle mode={mode} onToggle={handleModeToggle} lang={uiLangCode} />
                        </div>
                        <div className="overflow-x-auto custom-scroll pb-2 -mx-4 px-4">
                            {mode === 'news' ? (
                                <NewsFeed
                                    onArticleSelect={handleArticleSelect}
                                    onArticleUpdate={handleArticleUpdate}
                                    onCategoryChange={handleCategoryChange}
                                    selectedNews={selectedNews}
                                    nativeLanguage={nativeLanguage?.code || 'zh-CN'}
                                    isMobile={true}
                                />
                            ) : (
                                <ScenarioFeed
                                    onArticleSelect={handleArticleSelect}
                                    onCategoryChange={handleCategoryChange}
                                    selectedNews={selectedNews}
                                    isMobile={true}
                                    lang={uiLangCode}
                                    learningLanguage={activeLanguagePair.learningLanguage}
                                    nativeLanguage={activeLanguagePair.nativeLanguage}
                                    languageReady={!isLanguageLoading}
                                />
                            )}
                        </div>
                    </div>}

                    {/* Desktop Cards - 在大屏幕以上显示 */}
                    {isDesktopLayout === true && <div className="hidden lg:flex lg:w-[40%] flex-col min-h-0 h-[calc(100vh-140px)]">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-foreground">
                                {mode === 'news' ? 'Latest News' : (uiLangCode === 'zh' ? '场景练习' : uiLangCode === 'ja' ? 'シナリオ' : 'Scenarios')}
                            </h2>
                            <ModeToggle mode={mode} onToggle={handleModeToggle} lang={uiLangCode} />
                        </div>
                        <div
                            className="min-h-0 h-full overflow-y-auto custom-scroll overscroll-contain"
                            style={{ overscrollBehaviorY: 'contain' }}
                        >
                            {mode === 'news' ? (
                                <NewsFeed
                                    onArticleSelect={handleArticleSelect}
                                    onArticleUpdate={handleArticleUpdate}
                                    onCategoryChange={handleCategoryChange}
                                    selectedNews={selectedNews}
                                    nativeLanguage={nativeLanguage?.code || 'zh-CN'}
                                />
                            ) : (
                                <ScenarioFeed
                                    onArticleSelect={handleArticleSelect}
                                    onCategoryChange={handleCategoryChange}
                                    selectedNews={selectedNews}
                                    lang={uiLangCode}
                                    learningLanguage={activeLanguagePair.learningLanguage}
                                    nativeLanguage={activeLanguagePair.nativeLanguage}
                                    languageReady={!isLanguageLoading}
                                />
                            )}
                        </div>
                    </div>}

                    {/* Chat Interface - Full width on mobile, 70% on desktop */}
                    <div className="flex-1 lg:w-[70%] flex flex-col min-h-0 lg:h-[calc(100vh-140px)]">
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-600 p-2 rounded mb-2 text-sm">
                                {error}
                            </div>
                        )}
                        <History
                            isConnected={isConnected}
                            isConnecting={isConnecting || isLanguageLoading || isRestoringConversation || isTopicHistoryLoading}
                            isMuted={isMuted}
                            toggleMute={toggleMute}
                            connect={connect}
                            history={history}
                            sendTextMessage={sendTextMessage}
                            onInputFocus={() => {
                                // Mute mic when typing to prevent double inputs (audio + text)
                                if (!isMuted && serviceRef.current) {
                                    // Store that we auto-muted, so we can restore later
                                    serviceRef.current._autoMuted = true;
                                    toggleMute();
                                }
                            }}
                            onInputBlur={() => {
                                // Restore mic if it was auto-muted
                                if (isMuted && serviceRef.current && serviceRef.current._autoMuted) {
                                    serviceRef.current._autoMuted = false;
                                    toggleMute();
                                }
                            }}
                        />
                    </div>
                </div>
            </div>
            <OnboardingGuide lang={uiLangCode} />
        </div>
    )
}
