"use client";

import { useState } from "react";
import { cn } from "@/app/lib/utils";

const difficultyConfig = {
  beginner: { label_zh: "入门", label_en: "Beginner", label_ja: "初級", color: "bg-green-600" },
  intermediate: { label_zh: "中级", label_en: "Intermediate", label_ja: "中級", color: "bg-yellow-600" },
  advanced: { label_zh: "高级", label_en: "Advanced", label_ja: "上級", color: "bg-red-600" },
};

const i18n = {
  zh: {
    title: "用 AI 创建场景",
    ideaLabel: "描述你想要的场景",
    ideaPlaceholder: "例如：在旧金山一家初创公司应聘产品经理，面试官是个很严格的前谷歌工程师……\n或者：和来自法国的旅伴讨论卢浮宫里的名画，对方是个业余艺术爱好者……",
    generateBtn: "AI 生成",
    generating: "生成中……",
    savePrivate: "保存为私密",
    savePublic: "公开分享",
    saving: "保存中……",
    saved: "已保存！",
    cancel: "取消",
    tryNow: "直接试用",
    regenerate: "重新生成",
    errorTitle: "生成失败",
    saveError: "保存失败",
    publicNote: "公开后其他用户也能看到这个场景",
    preview: "预览生成结果",
    difficultyLabel: "难度",
  },
  en: {
    title: "Create with AI",
    ideaLabel: "Describe the scenario you want",
    ideaPlaceholder: "e.g.: Interviewing for a Product Manager role at a SF startup — the interviewer is a tough ex-Google engineer...\nOr: Discussing famous paintings in the Louvre with a French travel companion who's an amateur art enthusiast...",
    generateBtn: "Generate with AI",
    generating: "Generating...",
    savePrivate: "Save (Private)",
    savePublic: "Share Publicly",
    saving: "Saving...",
    saved: "Saved!",
    cancel: "Cancel",
    tryNow: "Try It Now",
    regenerate: "Regenerate",
    errorTitle: "Generation failed",
    saveError: "Save failed",
    publicNote: "Other users can discover this scenario when public",
    preview: "Preview",
    difficultyLabel: "Difficulty",
  },
  ja: {
    title: "AIでシナリオ作成",
    ideaLabel: "シナリオのアイデアを入力",
    ideaPlaceholder: "例：サンフランシスコのスタートアップでPMの面接、面接官は元Googleの厳しいエンジニア...\nまたは：ルーブルで名画についてフランス人の旅行仲間と話す...",
    generateBtn: "AIで生成",
    generating: "生成中...",
    savePrivate: "非公開で保存",
    savePublic: "公開シェア",
    saving: "保存中...",
    saved: "保存完了！",
    cancel: "キャンセル",
    tryNow: "今すぐ試す",
    regenerate: "再生成",
    errorTitle: "生成失敗",
    saveError: "保存失敗",
    publicNote: "公開すると他のユーザーも使えます",
    preview: "プレビュー",
    difficultyLabel: "難易度",
  },
};

export default function GenerateScenarioDialog({ lang = "zh", onClose, onScenarioReady, onSaved }) {
  const t = i18n[lang] || i18n.en;
  const [idea, setIdea] = useState("");
  const [generated, setGenerated] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState(null); // null | "saved"
  const [error, setError] = useState(null);

  async function handleGenerate() {
    if (!idea.trim() || loading) return;
    setLoading(true);
    setError(null);
    setGenerated(null);
    setSaveState(null);
    try {
      const res = await fetch("/api/scenarios/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, lang }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Unknown error");
      setGenerated(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(isPublic) {
    if (!generated || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...generated, is_public: isPublic }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      setSaveState("saved");
      onSaved?.(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleTryNow() {
    if (!generated) return;
    const titleKey = `title_${lang}`;
    const descKey = `description_${lang}`;
    onScenarioReady?.({
      id: `generated-${Date.now()}`,
      title: generated[titleKey] || generated.title_en,
      description: generated[descKey] || generated.description_en || "",
      originalTitle: generated.title_en,
      category: lang === "zh" ? "AI 生成" : lang === "ja" ? "AI生成" : "AI Generated",
      _isScenario: true,
      _scenarioId: `generated-${Date.now()}`,
      _systemPrompt: generated.system_prompt,
      difficulty: generated.difficulty || "intermediate",
    });
    onClose?.();
  }

  const diff = generated ? (difficultyConfig[generated.difficulty] || difficultyConfig.intermediate) : null;
  const labelKey = `label_${lang}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-2 sm:px-4">
      <div className="bg-background border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-background z-10">
          <h2 className="font-semibold text-base">✨ {t.title}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4 flex-1">
          {/* Idea input */}
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">{t.ideaLabel}</label>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder={t.ideaPlaceholder}
              rows={4}
              className="w-full resize-none rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
            />
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!idea.trim() || loading}
            className={cn(
              "w-full py-2.5 rounded-lg text-sm font-medium transition-all",
              !idea.trim() || loading
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]"
            )}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                {t.generating}
              </span>
            ) : generated ? t.regenerate : t.generateBtn}
          </button>

          {/* Error */}
          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Generated preview */}
          {generated && (
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t.preview}
              </div>
              <div className="p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {diff && (
                    <span className={cn("text-xs text-white px-2 py-0.5 rounded-full font-medium", diff.color)}>
                      {diff[labelKey] || diff.label_en}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {generated.title_en}
                  </span>
                </div>
                <h3 className="font-semibold text-sm text-foreground">
                  {generated[`title_${lang}`] || generated.title_en}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                  {generated[`description_${lang}`] || generated.description_en}
                </p>
              </div>

              {/* Actions */}
              {saveState === "saved" ? (
                <div className="px-3 pb-3 text-center text-sm text-green-600 font-medium">
                  ✓ {t.saved}
                </div>
              ) : (
                <div className="px-3 pb-3 flex flex-col gap-2">
                  <button
                    onClick={handleTryNow}
                    className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 active:scale-[0.98] transition-all"
                  >
                    {t.tryNow}
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSave(false)}
                      disabled={saving}
                      className="flex-1 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
                    >
                      {saving ? t.saving : t.savePrivate}
                    </button>
                    <button
                      onClick={() => handleSave(true)}
                      disabled={saving}
                      className="flex-1 py-2 rounded-lg border border-primary/40 text-primary text-sm font-medium hover:bg-primary/5 transition-colors disabled:opacity-50"
                    >
                      {saving ? t.saving : t.savePublic}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">{t.publicNote}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
