// Conversation identity, reconciliation, and persistence payload helpers.
import { sanitizeHistoryCorrections } from '@/app/lib/history/corrections';

const sanitizeKeyString = (value) => String(value || 'default').replace(/\s+/g, '');

export const getNewsKey = (news) => {
    if (!news) return 'default';
    if (news._isScenario) return `scenario:${news._scenarioId}`;
    const base = news.originalTitle || news.title || news.link || news.id || 'default';
    return sanitizeKeyString(base);
};

export const ensureContextMessage = (historyItems, contextMessage) => {
    const list = sanitizeHistoryCorrections(historyItems);
    if (!contextMessage) return list;
    const currentTopicItems = list.filter((item) => (
        item?.itemId === contextMessage.itemId
        || item?.metadata?.kind !== 'news_context'
    ));
    const hasContext = currentTopicItems.some((item) => item?.itemId === contextMessage.itemId);
    if (hasContext) {
        return currentTopicItems.map(
            (item) => item?.itemId === contextMessage.itemId ? contextMessage : item,
        );
    }
    return [contextMessage, ...currentTopicItems];
};

export const extractMessageText = (message) => {
    if (message?.type === 'correction') return '';
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

// Remove manual placeholders when model returns the same text later.
export const dedupeManualMessages = (historyItems) => {
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

export const hasUserMessage = (historyItems) => (
    Array.isArray(historyItems) && historyItems.some(
        (item) => item?.role === 'user' && extractMessageText(item),
    )
);

export const conversationItemKey = (item) => item?.itemId || [
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

export const mergeConversationHistory = (serverHistory, localHistory) => {
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

export const reconcilePersistSnapshot = (pending, live) => {
    if (!pending) return live;
    if (!live || !pending.userId || pending.userId !== live.userId
        || pending.identityGeneration !== live.identityGeneration
        || pending.topicGeneration !== live.topicGeneration
        || getNewsKey(pending.news) !== getNewsKey(live.news)) return pending;
    return { ...pending, history: mergeConversationHistory(pending.history, live.history) };
};

export const historyContainsSnapshot = (savedHistory, snapshot) => {
    const savedByKey = new Map((savedHistory || []).map(item => [conversationItemKey(item), item]));
    return (snapshot || []).filter(item => item?.role !== 'system').every(item => {
        const saved = savedByKey.get(conversationItemKey(item));
        if (!saved || saved.role !== item.role || saved.type !== item.type) return false;
        if (item.type === 'correction') {
            return Object.entries(item.correction || {}).every(([field, value]) => saved.correction?.[field] === value);
        }
        if (item.metadata?.isFinal && !saved.metadata?.isFinal) return false;
        if (saved.metadata?.isFinal && !item.metadata?.isFinal) return true;
        return extractMessageText(saved).includes(extractMessageText(item));
    });
};

export const compactHistoryForKeepalive = (historyItems, maxBytes = 40000) => {
    const items = sanitizeHistoryCorrections(historyItems).filter(item => item?.role !== 'system');
    if (!items.length) return [];
    const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const shrinkItem = (item, limit) => ({
        itemId: item.itemId,
        type: item.type,
        role: item.role,
        metadata: {
            isFinal: item.metadata?.isFinal,
            createdAt: item.metadata?.createdAt,
            manualInput: item.metadata?.manualInput,
        },
        content: Array.isArray(item?.content)
            ? item.content.map((part) => (
                typeof part?.text === 'string'
                    ? { type: part.type, text: limit ? part.text.slice(-limit) : '' }
                    : part
            ))
            : item?.content,
        ...(item.correction ? { correction: item.correction } : {}),
    });
    const latestUserIndex = items.findLastIndex(item => item?.role === 'user' && extractMessageText(item));
    const start = latestUserIndex < 0 ? items.length - 1 : latestUserIndex;
    let selected = items.slice(start);
    if (byteLength(selected) > maxBytes) {
        // Keep dialogue ahead of older cards when correction fields alone exhaust the budget.
        while (byteLength(selected.map(item => shrinkItem(item, 0))) > maxBytes) {
            const correctionIndex = selected.findIndex(item => item?.type === 'correction');
            if (correctionIndex < 0) break;
            selected.splice(correctionIndex, 1);
        }
        let low = 0;
        let high = Math.max(...selected.map(item => extractMessageText(item).length));
        while (low < high) {
            const limit = Math.ceil((low + high) / 2);
            if (byteLength(selected.map(item => shrinkItem(item, limit))) <= maxBytes) low = limit;
            else high = limit - 1;
        }
        selected = selected.map(item => shrinkItem(item, low));
    }
    for (let index = start - 1; index >= 0; index -= 1) {
        const candidate = [items[index], ...selected];
        if (byteLength(candidate) > maxBytes) break;
        selected = candidate;
    }
    return selected;
};

export const compactNewsForKeepalive = (news) => {
    if (!news || typeof news !== 'object') return null;
    const shortText = (value, maxChars) => String(value || '').slice(0, maxChars);
    const compact = {
        id: shortText(news.id, 300),
        title: shortText(news.title, 500),
        originalTitle: shortText(news.originalTitle, 500),
        translatedTitle: shortText(news.translatedTitle, 500),
        translatedLanguageCode: shortText(news.translatedLanguageCode, 32),
        sourceLanguage: shortText(news.sourceLanguage, 32),
        link: shortText(news.link, 2000),
    };
    if (news._isScenario) {
        return {
            ...compact,
            _isScenario: true,
            _scenarioId: news._scenarioId,
            description: shortText(news.description, 500),
            _systemPrompt: shortText(news._systemPrompt, 2000),
            _targetLanguageCode: shortText(news._targetLanguageCode, 32),
            _nativeLanguageCode: shortText(news._nativeLanguageCode, 32),
            _isUserGenerated: news._isUserGenerated === true,
        };
    }
    return {
        ...compact,
        description: shortText(news.description, 500),
        content: shortText(news.content || news.description, 2000),
    };
};
