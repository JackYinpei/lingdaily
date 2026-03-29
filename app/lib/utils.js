import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function CombineInitPrompt(news) {
  if (!news) return "";
  const title = news.title || news.originalTitle || "";
  const content = news.content || news.description || "";
  return `Title: ${title}\nContent: ${content}`;
}