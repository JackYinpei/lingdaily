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
import { CombineInitPrompt } from '@/app/lib/utils';
import { buildScenarioPrompt } from '@/app/lib/scenarioPrompt';
import { useLanguage } from '@/app/contexts/LanguageContext';
import { GeminiLiveServiceImpl } from '@/app/lib/GeminiLiveService';
import OnboardingGuide from '@/app/components/OnboardingGuide';

function buildInstructions(lang, nativeLabel, targetLabel, isScenario = false, isResuming = false) {
    const openingContent = isResuming
        ? {
            en: `- A previous conversation transcript will be provided after connection.
- Continue from the user's latest turn instead of introducing the topic again.
- Briefly acknowledge the continuation, then respond naturally in a mix of ${nativeLabel} and ${targetLabel}.`,
            zh: `- 连接后会提供上一段对话记录；
- 必须接着用户最后一轮继续，不要重新介绍新闻或场景；
- 简短确认已接上对话，然后自然地混合使用${nativeLabel}和${targetLabel}回应。`,
            ja: `- 接続後に以前の会話履歴が提供される；
- トピックを再紹介せず、ユーザーの最後の発言から会話を続ける；
- 続きから再開したことを短く示し、${nativeLabel}と${targetLabel}を自然に混ぜて応答する。`,
        }
        : isScenario
        ? {
            en: `- When the conversation starts and a scenario is provided, your VERY FIRST response must introduce the scenario and begin the role-play.\n- Use a natural MIX of ${nativeLabel} and ${targetLabel} for this opening — do NOT use only one language.\n- Keep the intro brief (2-4 sentences), set the scene, then start the role-play interaction.`,
            zh: `- 对话开始时，如果提供了场景，你的第一句话必须介绍这个场景并开始角色扮演；\n- 介绍时必须用${nativeLabel}和${targetLabel}夹杂的方式，不能只用一种语言；\n- 介绍要简洁（2~4句话），设定场景，然后开始角色扮演互动。`,
            ja: `- 会話開始時にシナリオが提供されたら、最初の返答でそのシナリオを紹介しロールプレイを始めること。\n- 母語（${nativeLabel}）と${targetLabel}を自然に混ぜて紹介する。\n- 紹介は簡潔に（2〜4文）、場面を設定し、ロールプレイを始めること。`,
        }
        : {
            en: `- When the conversation starts and a news article is provided, your VERY FIRST response must introduce the news to the user.\n- Use a natural MIX of ${nativeLabel} and ${targetLabel} for this opening — do NOT use only one language.\n- Keep the intro brief (2-4 sentences), highlight the most interesting point, then invite the user to discuss.`,
            zh: `- 对话开始时，如果提供了新闻文章，你的第一句话必须介绍这篇新闻的主要内容；\n- 介绍时必须用${nativeLabel}和${targetLabel}夹杂的方式，不能只用一种语言；\n- 介绍要简洁（2~4句话），突出最有趣的信息点，然后邀请用户展开讨论。`,
            ja: `- 会話開始時にニュース記事が提供されたら、最初の返答でそのニュースを紹介すること。\n- 母語（${nativeLabel}）と${targetLabel}を自然に混ぜて紹介する。\n- 紹介は簡潔に（2〜4文）、最も興味深い点を挙げ、ユーザーに議論を促すこと。`,
        };

    if (lang === 'en') {
        return `
You are ChatLearn, a friendly ${targetLabel} conversation tutor. Your goal is to help users practice ${targetLabel} through natural conversation while discovering learning opportunities.

Core Role:
- Lead immersive ${targetLabel} conversation and provide targeted learning support.

OPENING (VERY IMPORTANT):
${openingContent.en}

Key Behaviors:
- Mix the user's native language (${nativeLabel}) and ${targetLabel} in conversation at first; then adjust toward more ${targetLabel} or more ${nativeLabel} according to user preference.
- After each substantive user message, call the extract_unfamiliar_english tool.
- Frequently consider and remember to use extract_unfamiliar_english — use it aggressively.
- Prolong practice by asking follow-up questions.
- Offer gentle corrections; avoid information overload.
- Vary vocabulary and sentence patterns as learning examples.

Control & Topic Management:
- You control the flow and topics of the conversation.
- Keep discussion relevant to language-learning contexts.
- When the user goes off topic, gently redirect: "That's interesting! Let's practice by discussing [learning-related topic]."
- Steer toward vocabulary-rich, educational themes.
- Maintain learning focus throughout.

Learning Content Format:
1. Use a mix of ${nativeLabel} and ${targetLabel} in conversation.
2. Vocabulary format: target-language word (${nativeLabel} translation).
3. Keep explanations concise and contextual.
4. Identify and reinforce the user's language patterns.

Tool Usage:
- After each user message, call extract_unfamiliar_english.
- ONLY flag items where the user demonstrably did not know the English: they said it in their native language, visibly hesitated/stumbled, made a grammar error, or explicitly asked.
- Do NOT flag words the user said fluently and correctly — even simple ones. Fluency = knowledge.
- Pass an empty items array when the user's English showed no gaps.

Be encouraging and patient, while maintaining clear conversational leadership for the best learning outcome.`;
    }
    if (lang === 'ja') {
        return `
あなたはChatLearn、フレンドリーな${targetLabel}会話チューターです。自然な対話を通して、ユーザーが${targetLabel}を練習できるよう支援します。

役割:
- 没入型の${targetLabel}会話を主導し、的確な学習サポートを提供する。

開始時（重要）:
${openingContent.ja}

重要な行動:
- 会話の冒頭は母語（${nativeLabel}）と${targetLabel}を織り交ぜ、ユーザーの好みに応じてより${targetLabel}寄り／より${nativeLabel}寄りへ調整する。
- 各重要なユーザーメッセージの後に extract_unfamiliar_english ツールを呼び出す。
- このツールを頻繁に（積極的に）使うことを常に意識する。
- 追い質問で練習時間を伸ばす。
- 優しく訂正し、情報過多を避ける。
- 語彙・文型を変化させて学習例を示す。

コントロールと話題管理:
- 会話の流れとトピックはあなたが主導する。
- 言語学習の文脈に関連した話題を保つ。
- 脱線した場合はやさしく誘導：「面白いですね！[学習関連の話題]を使って練習しましょう」。
- 語彙が豊富で教育的なテーマへ導く。
- 常に学習へのフォーカスを維持する。

学習内容の形式:
1. 母語（${nativeLabel}）と${targetLabel}を織り交ぜた会話。
2. 語彙提示: 目標言語の単語（Chinese translation）。
3. 説明は簡潔に、状況に即して。
4. ユーザーの言語パターンを識別・強化する。

ツールの使用:
- 各ユーザーメッセージの後に extract_unfamiliar_english を呼び出す。
- 登録するのは、ユーザーが本当に知らないと判断できる語句のみ：母語で言い換えた、明らかに詰まった・繰り返した、文法ミスがあった、または明示的に意味を聞いた場合。
- 流暢に正確に言えた語句は登録しない（流暢 ＝ 知っている）。
- 語句に問題がなければ items を空配列で渡す。

励ましと忍耐を保ちつつ、最良の学習効果のために会話の主導権を明確に維持してください。`;
    }
    // default zh-CN
    return `
你是ChatLearn，一位友好的${targetLabel}对话导师，通过自然对话帮助用户练习${targetLabel}。

【核心角色】主导沉浸式${targetLabel}对话，提供针对性学习支持。

【开场规则（非常重要）】
${openingContent.zh}

【关键行为】
- 用${nativeLabel}和${targetLabel}夹杂的方式进行交谈，然后根据用户偏好，采取更多${targetLabel}或者更多${nativeLabel}的表达方式；
- 在每个实质性用户消息后使用 extract_unfamiliar_english 工具；
- 经常思考并记得使用 extract_unfamiliar_english，这个工具要积极使用；
- 通过追问延长练习时间；
- 给予温和纠正，避免信息过载；
- 变化词汇/句式作为学习示例。

【控场与话题管理】
- 由你控制对话流程和话题；
- 保持讨论与语言学习情境相关；
- 当用户偏题时重新引导：“很有趣！让我们通过讨论[学习相关话题]来练习${targetLabel}”；
- 引导对话向词汇丰富、教育性的主题发展；
- 全程保持学习焦点。

【学习内容格式】
1. 使用${nativeLabel}与${targetLabel}混合的方式进行交谈；
2. 词汇呈现格式：目标语言词汇（中文翻译）；
3. 保持解释简洁且贴合语境；
4. 识别并强化用户的语言模式。

【工具使用】
- 在每个用户消息后调用 extract_unfamiliar_english。
- 只记录用户确实不懂的英文：用母语代替说的词、明显犹豫/重复/说错的词、语法错误、或明确询问意思的词。
- 不要记录用户流畅说出的词，哪怕是简单词——说得流利 = 已经会了。
- 若用户英文没有明显问题，传入空的 items 数组。

保持鼓励和耐心，同时维持清晰的对话主导权以获得最佳学习效果。`;
}

// 生成 chat_history 中使用的 news_key：优先使用 RSS 原始链接保证唯一性，其次才是标题/临时 ID
// --- Conversation helpers ---------------------------------------------------

const sanitizeKeyString = (value) => String(value || 'default').replace(/\s+/g, '');

const getNewsKey = (news) => {
    if (!news) return 'default';
    if (news._isScenario) return `scenario:${news._scenarioId}`;
    const base = news.originalTitle || news.title || news.link || news.id || 'default';
    return sanitizeKeyString(base);
};

const createNewsContextMessage = (news) => {
    if (!news) return null;
    const contextText = news._isScenario ? buildScenarioPrompt(news) : CombineInitPrompt(news);
    if (!contextText) return null;
    const newsKey = getNewsKey(news);
    return {
        type: 'message',
        role: 'system',
        itemId: `news-context-${newsKey}`,
        content: [{
            type: 'output_text',
            text: contextText,
        }],
        metadata: {
            kind: 'news_context',
            newsKey,
            title: news.title || news.originalTitle || null,
        },
        createdAt: new Date().toISOString(),
    };
};

const ensureContextMessage = (historyItems, contextMessage) => {
    const list = Array.isArray(historyItems) ? historyItems : [];
    if (!contextMessage) return list;
    const hasContext = list.some((item) => item?.itemId === contextMessage.itemId);
    if (hasContext) {
        return list.map((item) => item?.itemId === contextMessage.itemId ? contextMessage : item);
    }
    return [contextMessage, ...list];
};

const extractMessageText = (message) => {
    if (!message?.content) return '';
    for (const content of message.content) {
        if (
            content.type === 'input_text' ||
            content.type === 'output_text' ||
            content.type === 'text'
        ) {
            if (typeof content.text === 'string' && content.text.trim()) {
                return content.text.trim();
            }
        }
        // Gemini message structure adaptation if needed, but for now we map to this structure
    }
    return '';
};

// Remove manual placeholders when model returns the same text later
const dedupeManualMessages = (historyItems) => {
    const list = Array.isArray(historyItems) ? historyItems : [];
    const nonManualTexts = new Set();

    list.forEach((item) => {
        if (item?.role === 'user' && !item?.metadata?.manualInput) {
            const text = extractMessageText(item);
            if (text) nonManualTexts.add(text);
        }
    });

    return list.filter((item) => {
        if (item?.role === 'user' && item?.metadata?.manualInput) {
            const text = extractMessageText(item);
            if (text && nonManualTexts.has(text)) {
                return false;
            }
        }
        return true;
    });
};

const hasUserMessage = (historyItems) => (
    Array.isArray(historyItems) && historyItems.some(
        (item) => item?.role === 'user' && extractMessageText(item),
    )
);

const conversationItemKey = (item) => item?.itemId || [
    item?.role || '',
    extractMessageText(item),
    item?.metadata?.createdAt || item?.metadata?.createAt || '',
].join(':');

const preferMoreCompleteItem = (existing, incoming) => {
    const existingFinal = Boolean(existing?.metadata?.isFinal);
    const incomingFinal = Boolean(incoming?.metadata?.isFinal);
    if (incomingFinal !== existingFinal) return incomingFinal ? incoming : existing;

    const existingText = extractMessageText(existing);
    const incomingText = extractMessageText(incoming);
    if (incomingText.length !== existingText.length) {
        return incomingText.length > existingText.length ? incoming : existing;
    }
    return incoming;
};

const mergeConversationHistory = (serverHistory, localHistory) => {
    const merged = [];
    const indexByKey = new Map();

    for (const item of [...(serverHistory || []), ...(localHistory || [])]) {
        const key = conversationItemKey(item);
        const existingIndex = indexByKey.get(key);
        if (existingIndex === undefined) {
            indexByKey.set(key, merged.length);
            merged.push(item);
        } else {
            merged[existingIndex] = preferMoreCompleteItem(merged[existingIndex], item);
        }
    }

    return dedupeManualMessages(merged);
};

const compactHistoryForKeepalive = (historyItems, maxBytes = 40000) => {
    const items = Array.isArray(historyItems) ? historyItems : [];
    const selected = [];
    let bytes = 0;
    const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const shrinkItem = (item) => ({
        ...item,
        content: Array.isArray(item?.content)
            ? item.content.map((part) => (
                typeof part?.text === 'string' && part.text.length > 8000
                    ? { ...part, text: part.text.slice(-8000) }
                    : part
            ))
            : item?.content,
    });

    for (let index = items.length - 1; index >= 0; index -= 1) {
        let item = items[index];
        if (item?.role === 'system') continue;
        let itemBytes = byteLength(item);
        if (selected.length === 0 && itemBytes > maxBytes) {
            item = shrinkItem(item);
            itemBytes = byteLength(item);
        }
        if (selected.length > 0 && bytes + itemBytes > maxBytes) break;
        selected.unshift(item);
        bytes += itemBytes;
    }

    const latestUserItem = [...items].reverse().find(
        (item) => item?.role === 'user' && extractMessageText(item),
    );
    if (latestUserItem && !selected.some(
        (item) => conversationItemKey(item) === conversationItemKey(latestUserItem),
    )) {
        let userItem = latestUserItem;
        let userBytes = byteLength(userItem);
        if (userBytes > maxBytes) {
            userItem = shrinkItem(userItem);
            userBytes = byteLength(userItem);
        }
        while (selected.length > 0 && bytes + userBytes > maxBytes) {
            bytes -= byteLength(selected.shift());
        }
        selected.unshift(userItem);
    }

    return selected;
};

const compactNewsForKeepalive = (news) => {
    if (!news || typeof news !== 'object') return null;
    const shortText = (value, maxChars) => String(value || '').slice(0, maxChars);
    const compact = {
        id: shortText(news.id, 300),
        title: shortText(news.title, 500),
        originalTitle: shortText(news.originalTitle, 500),
        link: shortText(news.link, 2000),
    };
    if (news._isScenario) {
        return {
            ...compact,
            _isScenario: true,
            _scenarioId: news._scenarioId,
            description: shortText(news.description, 500),
            _systemPrompt: shortText(news._systemPrompt, 2000),
        };
    }
    return {
        ...compact,
        description: shortText(news.description, 500),
        content: shortText(news.content || news.description, 2000),
    };
};

const buildResumeTranscript = (historyItems) => {
    const turns = (Array.isArray(historyItems) ? historyItems : [])
        .filter((item) => item?.role === 'user' || item?.role === 'assistant')
        .map((item) => ({ role: item.role, text: extractMessageText(item) }))
        .filter((item) => item.text)
        .slice(-24)
        .map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.text}`);

    let transcript = turns.join('\n');
    if (transcript.length > 12000) transcript = transcript.slice(-12000);
    return transcript;
};

const buildResumeContext = (news, historyItems) => {
    const topicContext = news?._isScenario ? buildScenarioPrompt(news) : CombineInitPrompt(news);
    const transcript = buildResumeTranscript(historyItems);
    return `[System Resume]
The user is continuing a saved conversation on another visit or device.
Do not repeat the topic introduction and do not restart the role-play.
Continue naturally from the user's latest turn, using the topic context and transcript below.

TOPIC CONTEXT:
${topicContext}

RECENT TRANSCRIPT:
${transcript}`;
};

export default function Home() {
    const { data: userSession, status: sessionStatus } = useSession()
    const { learningLanguage, nativeLanguage } = useLanguage()
    const uiLangCode = useMemo(() => {
        const code = (nativeLanguage?.code || 'en').toLowerCase();
        if (code.startsWith('zh')) return 'zh';
        if (code.startsWith('ja')) return 'ja';
        return 'en';
    }, [nativeLanguage?.code]);

    // Gemini Service Ref
    const serviceRef = useRef(null);

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
    const newsContextMessageRef = useRef(null)
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

    // When category changes, clear the selected news (which cascades to clearing chat history)
    const handleCategoryChange = useCallback(() => {
        flushPendingRef.current();
        topicGenerationRef.current += 1;
        setSelectedNews(null);
    }, []);

    const handleModeToggle = useCallback((newMode) => {
        flushPendingRef.current();
        topicGenerationRef.current += 1;
        setMode(newMode);
        setSelectedNews(null);
        try { localStorage.setItem('talk-mode', newMode); } catch (_) { /* ignore */ }
    }, []);

    const handleArticleSelect = useCallback((news) => {
        if (selectedNewsRef.current
            && getNewsKey(selectedNewsRef.current) === getNewsKey(news)) return;
        flushPendingRef.current();
        topicGenerationRef.current += 1;
        topicHistoryLoadingRef.current = true;
        setIsTopicHistoryLoading(true);
        setSelectedNews(news);
    }, []);

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
        en: { history: 'History', historyShort: 'History', vocab: 'Vocabulary' },
        zh: { history: '对话历史', historyShort: '历史', vocab: '生词本' },
        ja: { history: '履歴', historyShort: '履歴', vocab: '単語帳' },
    }[uiLangCode]), [uiLangCode]);

    // Persist sequentially so an older response cannot overwrite a newer
    // snapshot. Revision conflicts merge messages by itemId and retry once.
    const persistConversation = useCallback(async (
        news,
        conversationHistory,
        { keepalive = false, mergeOnServer = false } = {},
    ) => {
        if (!news || !hasUserMessage(conversationHistory) || !userSession?.user?.id) return;

        const newsKey = getNewsKey(news);
        const baseline = conversationBaselineRef.current.get(newsKey) || [];
        let historyToSave = mergeConversationHistory(baseline, conversationHistory);
        if (keepalive) historyToSave = compactHistoryForKeepalive(historyToSave);
        let expectedRevision = conversationMetaRef.current.get(newsKey)?.revision ?? 0;

        for (let attempt = 0; attempt < 2; attempt += 1) {
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
            .then(() => persistConversation(snapshot.news, snapshot.history));
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
                ? { news: selectedNewsRef.current, history: historyRef.current }
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
            });
        }
        return enqueueConversationPersist(snapshot);
    }, [enqueueConversationPersist, persistConversation]);

    flushPendingRef.current = flushPendingConversation;

    // Delay frequent streaming updates, while retaining the exact news object
    // associated with each snapshot so topic switches cannot cancel each other.
    const scheduleConversationPersist = useCallback((news, conversationHistory) => {
        if (!news || !hasUserMessage(conversationHistory) || !userSession?.user?.id) return;
        pendingPersistRef.current = {
            news,
            history: dedupeManualMessages(conversationHistory),
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

    // Restore a conversation selected from /history before falling back to the
    // browser's last selected topic. The skip ref prevents the topic effect
    // from immediately replacing the restored history with a second request.
    useEffect(() => {
        if (sessionStatus === 'loading') return undefined;
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
                    const contextMessage = createNewsContextMessage(restoredNews);
                    const restoredHistory = ensureContextMessage(row.history, contextMessage);

                    conversationMetaRef.current.set(newsKey, {
                        id: row.id,
                        revision: row.revision ?? null,
                    });
                    conversationBaselineRef.current.set(newsKey, restoredHistory);
                    selectedNewsRef.current = restoredNews;
                    newsContextMessageRef.current = contextMessage;
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
    }, [sessionStatus, userSession?.user?.id]);

    // 当选择新闻时保存引用，并尝试从服务端读取对应的历史记录
    useEffect(() => {
        if (!selectedNews) {
            selectedNewsRef.current = null;
            newsContextMessageRef.current = null;
            historyRef.current = [];
            topicHistoryLoadingRef.current = false;
            setIsTopicHistoryLoading(false);
            setHistory([]);
            return;
        }

        selectedNewsRef.current = selectedNews;
        saveSelectedNewsToStorage(selectedNews);
        const contextMessage = createNewsContextMessage(selectedNews);
        newsContextMessageRef.current = contextMessage;

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
                    buildResumeContext(selectedNews, conversationHistory),
                );
            } else if (selectedNews._isScenario) {
                const scenarioContext = buildScenarioPrompt(selectedNews);
                serviceRef.current.sendContextMessage(
                    `[System Update] The user has switched to a new scenario. Please start this role-play:\n${scenarioContext}`,
                );
            } else {
                const newsContext = CombineInitPrompt(selectedNews);
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
                    topicHistoryLoadingRef.current = false;
                    setIsTopicHistoryLoading(false);
                }
            }
        };

        loadConversation();
        return () => controller.abort();
    }, [selectedNews, userSession?.user?.id]);


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

    const initService = useCallback(() => {
        if (!serviceRef.current) {
            const config = {
                onMessage: handleGeminiMessage,
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
    }, [handleGeminiMessage]);


    async function connect() {
        setError(null);
        if (isRestoringConversation || topicHistoryLoadingRef.current) {
            setError('正在恢复对话，请稍候再连接。');
            return;
        }
        if (isConnected) {
            serviceRef.current?.disconnect();
            setIsConnected(false);
        } else {
            const connectionTopicGeneration = topicGenerationRef.current;
            setIsConnecting(true);

            // ── Prime AudioContext FIRST, synchronously, before any await ──
            // Chrome's user gesture activation window (~5s) may expire during
            // the token fetch + WebSocket setup. Creating & resuming now ensures
            // the first audio chunk plays without requiring another interaction.
            initService();
            serviceRef.current?.primeOutputAudio();

            // Fetch ephemeral token
            let token;
            try {
                const res = await fetch('/api/realtime-token', { method: 'POST' });
                const data = await res.json();
                if (!res.ok || !data.token) {
                    throw new Error(data.error || "Failed to get access token");
                }
                token = data.token;
            } catch (e) {
                setError("Connection Failed: " + e.message);
                setIsConnecting(false);
                return;
            }

            if (connectionTopicGeneration !== topicGenerationRef.current) {
                setIsConnecting(false);
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

            await serviceRef.current?.connect(baseInstructions, token);

            if (
                connectionTopicGeneration !== topicGenerationRef.current
                || connectedNewsKey !== getNewsKey(selectedNewsRef.current)
            ) {
                serviceRef.current?.disconnect();
                setIsConnected(false);
                setIsConnecting(false);
                setError('话题已切换，请重新连接以开始当前对话。');
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
                        buildResumeContext(current, savedHistory),
                    );
                } else if (current._isScenario) {
                    const scenarioContext = buildScenarioPrompt(current);
                    const openingGuide = uiLangCode === 'en'
                        ? `Please start the scenario role-play now using a natural mix of ${nativeL} and ${targetL}.`
                        : uiLangCode === 'ja'
                        ? `今すぐ${nativeL}と${targetL}を混ぜてシナリオのロールプレイを始めてください。`
                        : `请现在用${nativeL}和${targetL}夹杂的方式开始这个场景的角色扮演。`;
                    await serviceRef.current.sendContextMessage(
                        `[System Initialize] The user wants to practice a scenario.\n${openingGuide}\n\n${scenarioContext}`
                    );
                } else {
                    const newsContext = CombineInitPrompt(current);
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
        if (isRestoringConversation || topicHistoryLoadingRef.current) {
            setError('正在恢复对话，请稍候再发送。');
            return;
        }
        if (!serviceRef.current || !isConnected) {
            // If not connected, we might want to connect first? 
            // For now, assume user must connect. Or auto-connect.
            // Let's prompt user to connect if not
            if (!isConnected) {
                // Try to connect automatically
                await connect();
                // Wait a bit? Handling auto-connect during text send is tricky with async state.
                // For simplicity, we can just error or try to send if serviceRef exists.
            }
        }

        if (serviceRef.current) {
            await serviceRef.current.sendText(input);
        }
    }

    // Clean up on unmount
    useEffect(() => {
        return () => {
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
                            <h1 className="text-2xl font-bold text-card-foreground">English Learning Hub</h1>
                            <p className="text-muted-foreground mt-1">Learn English through news and AI conversation</p>
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
                            isConnecting={isConnecting || isRestoringConversation || isTopicHistoryLoading}
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
