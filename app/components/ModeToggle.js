"use client";

import { cn } from "@/app/lib/utils";

const modes = [
  { key: "news", label_zh: "新闻", label_en: "News", label_ja: "ニュース" },
  { key: "scenario", label_zh: "场景", label_en: "Scenarios", label_ja: "シナリオ" },
];

export function ModeToggle({ mode, onToggle, lang = "en" }) {
  const labelKey = `label_${lang}`;
  return (
    <div className="inline-flex rounded-full bg-secondary p-0.5 gap-0.5" data-tour="mode-toggle">
      {modes.map((m) => (
        <button
          key={m.key}
          onClick={() => onToggle(m.key)}
          className={cn(
            "px-3 py-1 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap",
            mode === m.key
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-secondary-foreground hover:bg-secondary/80"
          )}
        >
          {m[labelKey] || m.label_en}
        </button>
      ))}
    </div>
  );
}
