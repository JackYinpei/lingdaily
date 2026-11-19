import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { SCENARIO_DIFFICULTIES, UUID_PATTERN, toScenarioCategories } from '@/app/lib/scenarios'

describe('scenario domain rules', () => {
  it('dedupes categories by slug, skips rows without a slug and keeps the DTO shape', () => {
    const rows = [
      { category_slug: 'travel', category_name_zh: '旅行', category_name_en: 'Travel', category_name_ja: '旅行', category_icon: '✈️', category_sort: 1 },
      { category_slug: 'travel', category_name_zh: '重复', category_name_en: 'Dup', category_name_ja: null, category_icon: null, category_sort: 9 },
      { category_slug: null, category_name_en: 'Broken' },
      { category_slug: 'work', category_name_zh: '职场', category_name_en: 'Work', category_name_ja: null, category_icon: '💼', category_sort: 2 },
    ]
    expect(toScenarioCategories(rows)).toEqual([
      { id: 'travel', slug: 'travel', name_zh: '旅行', name_en: 'Travel', name_ja: '旅行', icon: '✈️', sort_order: 1 },
      { id: 'work', slug: 'work', name_zh: '职场', name_en: 'Work', name_ja: null, icon: '💼', sort_order: 2 },
    ])
    expect(toScenarioCategories(null)).toEqual([])
  })

  it('exposes the shared difficulty list and UUID pattern', () => {
    expect(SCENARIO_DIFFICULTIES).toEqual(['beginner', 'intermediate', 'advanced'])
    expect(UUID_PATTERN.test('123e4567-e89b-42d3-a456-426614174000')).toBe(true)
    expect(UUID_PATTERN.test('not-a-uuid')).toBe(false)
  })
})
