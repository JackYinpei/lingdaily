export const CORRECTION_LIMITS = { original: 2000, corrected: 2000, explanation: 4000 };
const CATEGORIES = new Set(['grammar', 'vocabulary', 'phrasing', 'other']);

export function normalizeCorrection(value, { truncate = false } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const result = {};
    for (const [field, limit] of Object.entries(CORRECTION_LIMITS)) {
        const text = value[field] ?? (field === 'explanation' ? '' : null);
        if (typeof text !== 'string') return null;
        if (!truncate && text.length > limit) return null;
        result[field] = text.trim().slice(0, limit);
    }
    if (!result.original || !result.corrected || result.original === result.corrected) return null;
    if (value.category !== undefined && !CATEGORIES.has(value.category) && !truncate) return null;
    result.category = CATEGORIES.has(value.category) ? value.category : 'other';
    return result;
}

export function normalizeCorrectionItem(item) {
    const correction = normalizeCorrection(item?.correction);
    if (!correction || typeof item.itemId !== 'string' || !item.itemId || item.itemId.length > 200) return null;
    const createdAt = item.metadata?.createdAt;
    return {
        itemId: item.itemId,
        type: 'correction',
        role: 'assistant',
        correction,
        metadata: {
            isFinal: true,
            ...(typeof createdAt === 'string' && createdAt.length <= 64 && !Number.isNaN(Date.parse(createdAt))
                ? { createdAt } : {}),
        },
    };
}

export function sanitizeHistoryCorrections(history) {
    return (Array.isArray(history) ? history : []).flatMap(item => {
        if (item?.type !== 'correction') return [item];
        const normalized = normalizeCorrectionItem(item);
        return normalized ? [normalized] : [];
    });
}
