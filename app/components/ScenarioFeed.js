"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { ScenarioCard } from "./ScenarioCard";
import GenerateScenarioDialog from "./GenerateScenarioDialog";

const MY_CATEGORY_ID = "__mine__";
const PUBLIC_CATEGORY_ID = "__public__";

const i18n = {
  zh: {
    myScenarios: "我的场景",
    publicScenarios: "社区场景",
    noScenarios: "暂无场景",
    noMine: "还没有自己创建的场景",
    noPublic: "暂无社区场景",
    createBtn: "✨ AI 创建",
    loginToCreate: "登录后可创建场景",
    deleteConfirm: "确认删除这个场景？",
  },
  en: {
    myScenarios: "My Scenarios",
    publicScenarios: "Community",
    noScenarios: "No scenarios yet",
    noMine: "No custom scenarios yet",
    noPublic: "No community scenarios yet",
    createBtn: "✨ Create with AI",
    loginToCreate: "Log in to create scenarios",
    deleteConfirm: "Delete this scenario?",
  },
  ja: {
    myScenarios: "マイシナリオ",
    publicScenarios: "コミュニティ",
    noScenarios: "シナリオがありません",
    noMine: "カスタムシナリオなし",
    noPublic: "コミュニティシナリオなし",
    createBtn: "✨ AIで作成",
    loginToCreate: "ログインして作成",
    deleteConfirm: "このシナリオを削除しますか？",
  },
};

export default function ScenarioFeed({
  onArticleSelect,
  onCategoryChange,
  selectedNews = null,
  isMobile = false,
  lang = "en",
}) {
  const { data: session } = useSession();
  const [categories, setCategories] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);

  const t = i18n[lang] || i18n.en;
  const nameKey = `name_${lang}`;
  const titleKey = `title_${lang}`;
  const descKey = `description_${lang}`;

  // Fetch categories on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/scenarios?categories=true", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        const cats = Array.isArray(json?.data) ? json.data : [];
        setCategories(cats);
        const saved = localStorage.getItem("scenario-category");
        const initial = cats.find((c) => c.slug === saved) || cats[0];
        if (initial) setSelectedCategory(initial);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch scenarios when category changes
  useEffect(() => {
    if (!selectedCategory) return;
    let cancelled = false;
    setLoading(true);
    setScenarios([]);

    (async () => {
      try {
        let url;
        if (selectedCategory.id === MY_CATEGORY_ID) {
          url = "/api/scenarios?mine=true";
        } else if (selectedCategory.id === PUBLIC_CATEGORY_ID) {
          url = "/api/scenarios?public=true";
        } else {
          url = `/api/scenarios?categorySlug=${selectedCategory.slug}`;
        }
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setScenarios(Array.isArray(json?.data) ? json.data : []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCategory]);

  const handleCategoryClick = useCallback(
    (cat) => {
      setSelectedCategory(cat);
      if (cat.id !== MY_CATEGORY_ID && cat.id !== PUBLIC_CATEGORY_ID) {
        localStorage.setItem("scenario-category", cat.slug);
      }
      onCategoryChange?.();
    },
    [onCategoryChange]
  );

  const handleSelect = useCallback(
    (scenario) => {
      if (selectedNews?._scenarioId === scenario.id) {
        onArticleSelect?.(null);
        return;
      }
      const categoryName = selectedCategory?.[nameKey] || selectedCategory?.name_en || "";
      onArticleSelect?.({
        id: scenario.id,
        title: scenario[titleKey] || scenario.title_en,
        description: scenario[descKey] || scenario.description_en || "",
        originalTitle: scenario.title_en,
        category: categoryName,
        _isScenario: true,
        _scenarioId: scenario.id,
        _systemPrompt: scenario.system_prompt,
        difficulty: scenario.difficulty,
      });
    },
    [selectedNews, selectedCategory, onArticleSelect, nameKey, titleKey, descKey]
  );

  const handleDelete = useCallback(
    async (scenario, e) => {
      e.stopPropagation();
      if (!confirm(t.deleteConfirm)) return;
      try {
        await fetch(`/api/scenarios?id=${scenario.id}`, { method: "DELETE" });
        setScenarios((prev) => prev.filter((s) => s.id !== scenario.id));
        if (selectedNews?._scenarioId === scenario.id) {
          onArticleSelect?.(null);
        }
      } catch {}
    },
    [selectedNews, onArticleSelect, t.deleteConfirm]
  );

  const handleSaved = useCallback((saved) => {
    // If we're viewing "My Scenarios", add the new one to the list
    if (selectedCategory?.id === MY_CATEGORY_ID) {
      setScenarios((prev) => [saved, ...prev]);
    }
  }, [selectedCategory]);

  const handleScenarioReady = useCallback((scenario) => {
    onArticleSelect?.(scenario);
  }, [onArticleSelect]);

  // Build virtual categories for mine/public
  const virtualCats = [];
  if (session?.user) {
    virtualCats.push({
      id: MY_CATEGORY_ID,
      slug: "__mine__",
      icon: "⭐",
      name_zh: t.myScenarios,
      name_en: t.myScenarios,
      name_ja: t.myScenarios,
    });
  }
  virtualCats.push({
    id: PUBLIC_CATEGORY_ID,
    slug: "__public__",
    icon: "🌐",
    name_zh: t.publicScenarios,
    name_en: t.publicScenarios,
    name_ja: t.publicScenarios,
  });

  const allCats = [...virtualCats, ...categories];

  const isUserCategory = selectedCategory?.id === MY_CATEGORY_ID || selectedCategory?.id === PUBLIC_CATEGORY_ID;

  // Category pills
  const categorySelectorJSX = (
    <div data-tour="category-bar" className={`${isMobile ? "px-2 sticky top-0 bg-background z-10" : "px-2"} mb-3`}>
      <div className="flex overflow-x-auto custom-scroll gap-2 py-2 items-center">
        {allCats.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat)}
            disabled={loading}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              selectedCategory?.id === cat.id
                ? "bg-primary text-primary-foreground shadow-md scale-105"
                : "bg-secondary hover:bg-secondary/80 text-secondary-foreground"
            } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {cat.icon ? `${cat.icon} ` : ""}
            {cat[nameKey] || cat.name_en}
          </button>
        ))}

        {/* AI Create button */}
        <button
          onClick={() => {
            if (!session?.user) return;
            setShowGenerateDialog(true);
          }}
          title={!session?.user ? t.loginToCreate : undefined}
          className={`flex-shrink-0 ml-1 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all border ${
            session?.user
              ? "border-primary/40 text-primary hover:bg-primary/10 active:scale-95"
              : "border-border text-muted-foreground cursor-not-allowed opacity-60"
          }`}
        >
          {t.createBtn}
        </button>
      </div>
    </div>
  );

  if (loading && categories.length === 0) {
    return (
      <div>
        {categorySelectorJSX}
        <div className={isMobile ? "flex gap-3" : "space-y-4 px-2 py-2"}>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className={`bg-card rounded-lg border p-4 ${isMobile ? "min-w-[280px]" : ""}`}>
                <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                <div className="h-3 bg-muted rounded w-full mb-1" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {categorySelectorJSX}
        <div className="p-4">
          <div className="text-red-500 bg-red-100 p-3 rounded-lg">Error: {error}</div>
        </div>
      </div>
    );
  }

  const noScenariosText =
    selectedCategory?.id === MY_CATEGORY_ID
      ? t.noMine
      : selectedCategory?.id === PUBLIC_CATEGORY_ID
      ? t.noPublic
      : t.noScenarios;

  return (
    <div>
      {categorySelectorJSX}
      <div className={isMobile ? "flex gap-3 overflow-x-auto custom-scroll px-2" : "space-y-4 px-2 py-2"}>
        {scenarios.map((scenario, index) => {
          const isSelected = selectedNews?._scenarioId === scenario.id;
          const isOwn = scenario.user_id && scenario.user_id === session?.user?.id;

          return (
            <div
              key={scenario.id}
              {...(index === 0 ? { "data-tour": "news-card" } : {})}
              className={
                isMobile
                  ? "flex-shrink-0 transition-all duration-300 ease-in-out w-[260px] h-48"
                  : `transition-all duration-300 ease-in-out ${isSelected ? "h-auto min-h-48" : "h-40"}`
              }
            >
              <div className="relative h-full">
                <ScenarioCard
                  scenario={{
                    ...scenario,
                    title: scenario[titleKey] || scenario.title_en,
                    description: scenario[descKey] || scenario.description_en,
                    category: selectedCategory?.[nameKey] || selectedCategory?.name_en || "",
                  }}
                  isSelected={isSelected}
                  onSelect={() => handleSelect(scenario)}
                  compact={isMobile}
                  lang={lang}
                />
                {/* Delete button for own scenarios */}
                {isOwn && (
                  <button
                    onClick={(e) => handleDelete(scenario, e)}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-background/80 hover:bg-red-100 text-muted-foreground hover:text-red-500 flex items-center justify-center text-xs transition-colors"
                    title="Delete"
                  >
                    ×
                  </button>
                )}
                {/* Public badge for community scenarios */}
                {scenario.user_id && scenario.is_public && !isOwn && (
                  <span className="absolute top-2 right-2 text-xs bg-background/80 px-1.5 py-0.5 rounded text-muted-foreground">
                    🌐
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {!loading && scenarios.length === 0 && (
          <div className="text-muted-foreground text-sm px-2 py-8 text-center">
            {noScenariosText}
            {selectedCategory?.id === MY_CATEGORY_ID && session?.user && (
              <div className="mt-3">
                <button
                  onClick={() => setShowGenerateDialog(true)}
                  className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
                >
                  {t.createBtn}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showGenerateDialog && (
        <GenerateScenarioDialog
          lang={lang}
          onClose={() => setShowGenerateDialog(false)}
          onScenarioReady={handleScenarioReady}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
