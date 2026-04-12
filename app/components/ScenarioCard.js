"use client";

import { Card } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { cn } from "@/app/lib/utils";

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
        "cursor-pointer transition-all duration-200 hover:shadow-md w-full h-full flex flex-col overflow-hidden p-0",
        isSelected ? "ring-2 ring-inset ring-primary bg-accent/10" : "hover:bg-card/80"
      )}
      onClick={onSelect}
    >
      <div className="p-3 flex flex-col h-full gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {scenario.category}
          </Badge>
          <span className={cn("text-xs text-white px-1.5 py-0.5 rounded", diff.color)}>
            {diff[labelKey] || diff.label_en}
          </span>
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
