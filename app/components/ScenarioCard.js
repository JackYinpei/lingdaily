"use client";

import { Card } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { cn } from "@/app/lib/utils";
import { Check, Users } from 'lucide-react';

const difficultyConfig = {
  beginner: { label_zh: "入门", label_en: "Beginner", label_ja: "初級", color: "bg-green-600" },
  intermediate: { label_zh: "中级", label_en: "Intermediate", label_ja: "中級", color: "bg-yellow-600" },
  advanced: { label_zh: "高级", label_en: "Advanced", label_ja: "上級", color: "bg-red-600" },
};

export function ScenarioCard({ scenario, isSelected, onSelect, compact = false, lang = "en" }) {
  const diff = difficultyConfig[scenario.difficulty] || difficultyConfig.intermediate;
  const labelKey = `label_${lang}`;

  return (
    <Card
      className={cn(
        "feature-topic-card feature-scenario-card cursor-pointer transition-colors duration-200 w-full h-full flex flex-col overflow-hidden p-0",
        isSelected ? "bg-secondary" : "hover:bg-card/80"
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(event); } }}
    >
      <div className="p-4 flex flex-col h-full gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            <Users size={12} aria-hidden="true" />
            {scenario.category}
          </Badge>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {diff[labelKey] || diff.label_en}
          </span>
          {isSelected && <Check size={14} className="text-primary" aria-hidden="true" />}
        </div>

        <h3
          className={cn(
            "font-semibold text-card-foreground leading-tight",
            compact ? "text-base line-clamp-2" : "text-lg line-clamp-2"
          )}
        >
          {scenario.title}
        </h3>

        {scenario.description && (
          <p
            className={cn(
              "text-muted-foreground leading-relaxed flex-1 min-h-0",
              isSelected ? "text-sm" : "text-xs line-clamp-3",
              isSelected && "overflow-y-auto"
            )}
          >
            {scenario.description}
          </p>
        )}
      </div>
    </Card>
  );
}
