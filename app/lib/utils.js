import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"
import { DEFAULT_LEARNING_LANGUAGE, DEFAULT_NATIVE_LANGUAGE } from "@/app/lib/languages";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

function normalizePair(pair = {}) {
  return {
    learningLanguage: pair.learningLanguage?.code
      ? pair.learningLanguage
      : DEFAULT_LEARNING_LANGUAGE,
    nativeLanguage: pair.nativeLanguage?.code
      ? pair.nativeLanguage
      : DEFAULT_NATIVE_LANGUAGE,
  };
}

export function CombineInitPrompt(news, pair) {
  if (!news) return "";
  const { learningLanguage, nativeLanguage } = normalizePair(pair);
  const originalTitle = news.originalTitle || news.title || "";
  const translatedTitle = news.translatedLanguageCode === nativeLanguage.code
    ? news.translatedTitle || (news.title && news.title !== originalTitle ? news.title : "")
    : "";
  const sourceLanguage = news.sourceLanguage || "en";
  const content = news.content || news.description || "";

  return [
    "[News Discussion Context]",
    `Original headline (${sourceLanguage}): ${originalTitle}`,
    translatedTitle
      ? `Native-language headline (${nativeLanguage.label}, ${nativeLanguage.code}): ${translatedTitle}`
      : `Native-language headline (${nativeLanguage.label}, ${nativeLanguage.code}): translation not available`,
    `Article content language: ${sourceLanguage}`,
    `Article content: ${content}`,
    "",
    `[Learning Goal]`,
    `Discuss this story and teach primarily in ${learningLanguage.label} (${learningLanguage.code}).`,
    `Use ${nativeLanguage.label} (${nativeLanguage.code}) only for concise support or clarification.`,
  ].join("\n");
}
