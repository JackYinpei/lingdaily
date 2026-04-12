"use client";

import { useEffect, useState, useCallback } from "react";
import { ScenarioCard } from "./ScenarioCard";

export default function ScenarioFeed({
  onArticleSelect,
  onCategoryChange,
  selectedNews = null,
  isMobile = false,
  lang = "en",
}) {
  const [categories, setCategories] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        // Restore or default to first
        const saved = localStorage.getItem("scenario-category");
        const initial = cats.find((c) => c.id === saved) || cats[0];
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
        const res = await fetch(`/api/scenarios?categoryId=${selectedCategory.id}`, { cache: "no-store" });
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
      localStorage.setItem("scenario-category", cat.id);
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

  // Category pills
  const categorySelectorJSX = (
    <div className={`${isMobile ? "px-2 sticky top-0 bg-background z-10" : "px-2"} mb-4`}>
      <div className="flex overflow-x-auto custom-scroll gap-2 py-2">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat)}
            disabled={loading}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              selectedCategory?.id === cat.id
                ? "bg-primary text-primary-foreground shadow-md scale-105"
                : "bg-secondary hover:bg-secondary/80 text-secondary-foreground"
            } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {cat.icon ? `${cat.icon} ` : ""}
            {cat[nameKey] || cat.name_en}
          </button>
        ))}
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

  return (
    <div>
      {categorySelectorJSX}
      <div className={isMobile ? "flex gap-3 overflow-x-auto custom-scroll px-2" : "space-y-4 px-2 py-2"}>
        {scenarios.map((scenario) => {
          const isSelected = selectedNews?._scenarioId === scenario.id;
          return (
            <div
              key={scenario.id}
              className={
                isMobile
                  ? "flex-shrink-0 transition-all duration-300 ease-in-out w-[260px] h-48"
                  : `transition-all duration-300 ease-in-out ${isSelected ? "h-72" : "h-40"}`
              }
            >
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
            </div>
          );
        })}
        {!loading && scenarios.length === 0 && (
          <div className="text-muted-foreground text-sm px-2 py-8 text-center">
            {lang === "zh" ? "暂无场景" : lang === "ja" ? "シナリオがありません" : "No scenarios yet"}
          </div>
        )}
      </div>
    </div>
  );
}
