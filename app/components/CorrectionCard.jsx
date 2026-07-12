'use client';

import { Sparkles, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/app/contexts/LanguageContext';

const CATEGORY_LABELS = {
    zh: { grammar: '语法', vocabulary: '词汇', phrasing: '表达', other: '建议' },
    ja: { grammar: '文法', vocabulary: '語彙', phrasing: '言い回し', other: '提案' },
    en: { grammar: 'Grammar', vocabulary: 'Vocabulary', phrasing: 'Phrasing', other: 'Tip' },
};

const TITLES = { zh: 'AI 纠错与建议', ja: 'AI 添削とヒント', en: 'AI Correction & Tips' };

// Inline card that renders a `record_language_correction` tool result: shows the
// original → corrected rewrite plus a short explanation. Styled to match the
// homepage hero preview so the feature reads consistently.
export function CorrectionCard({ correction }) {
    const { nativeLanguage } = useLanguage();
    const code = (nativeLanguage?.code || 'en').toLowerCase();
    const lang = code.startsWith('zh') ? 'zh' : code.startsWith('ja') ? 'ja' : 'en';

    const { original, corrected, explanation, category } = correction || {};
    if (!original || !corrected) return null;

    const categoryLabel = CATEGORY_LABELS[lang][category] || CATEGORY_LABELS[lang].other;

    return (
        <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4">
            <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-brand">
                    <Sparkles className="size-4" aria-hidden />
                    {TITLES[lang]}
                </span>
                <span className="rounded-full border border-brand/30 bg-background px-2 py-0.5 text-xs text-brand">
                    {categoryLabel}
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground line-through decoration-destructive/50">{original}</span>
                <ArrowRight className="size-4 text-brand" aria-hidden />
                <span className="font-medium text-brand">{corrected}</span>
            </div>
            {explanation ? (
                <p className="mt-2 text-sm text-muted-foreground">{explanation}</p>
            ) : null}
        </div>
    );
}
