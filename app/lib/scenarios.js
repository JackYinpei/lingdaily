export { UUID_PATTERN } from "@/app/lib/history/server"

export const SCENARIO_DIFFICULTIES = Object.freeze(["beginner", "intermediate", "advanced"])

export const CATEGORY_SELECT = "category_slug,category_name_zh,category_name_en,category_name_ja,category_icon,category_sort"

export function toScenarioCategories(rows) {
  const seen = new Set()
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      if (!row?.category_slug || seen.has(row.category_slug)) return false
      seen.add(row.category_slug)
      return true
    })
    .map((row) => ({
      id: row.category_slug,
      slug: row.category_slug,
      name_zh: row.category_name_zh,
      name_en: row.category_name_en,
      name_ja: row.category_name_ja,
      icon: row.category_icon,
      sort_order: row.category_sort,
    }))
}
