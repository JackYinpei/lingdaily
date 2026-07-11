// Conversation identity, reconciliation, and persistence payload helpers.

const sanitizeKeyString = (value) => String(value || 'default').replace(/\s+/g, '');

export const getNewsKey = (news) => {
    if (!news) return 'default';
    if (news._isScenario) return `scenario:${news._scenarioId}`;
    const base = news.originalTitle || news.title || news.link || news.id || 'default';
    return sanitizeKeyString(base);
};

export const ensureContextMessage = (historyItems, contextMessage) => {
    const list = Array.isArray(historyItems) ? historyItems : [];
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

export const compactHistoryForKeepalive = (historyItems, maxBytes = 40000) => {
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
