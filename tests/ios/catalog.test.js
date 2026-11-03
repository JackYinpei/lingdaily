import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/ios/scenarios/route'
import { catalogScenarioSchema, SCENARIO_CATALOG, SCENARIO_CATALOG_VERSION } from '@/app/lib/ios/scenarioCatalog'
import { voiceForPartner } from '@/app/lib/ios/live'

describe('built-in scenario catalog', () => {
  it('serves every scenario publicly, with a version and a short cache', async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=600')
    const data = await response.json()
    expect(data.version).toBe(SCENARIO_CATALOG_VERSION)
    expect(data.scenarios).toEqual(JSON.parse(JSON.stringify(SCENARIO_CATALOG)))
  })
  it('keeps the bundled ids and every entry valid for the app', () => {
    const ids = SCENARIO_CATALOG.map(item => item.id)
    expect(ids).toEqual(expect.arrayContaining(['deadline', 'hotel', 'introduction', 'coffee']))
    expect(new Set(SCENARIO_CATALOG.map(item => item.id)).size).toBe(SCENARIO_CATALOG.length)
    for (const scenario of SCENARIO_CATALOG) {
      expect(catalogScenarioSchema.safeParse(scenario).success, scenario.id).toBe(true)
      expect(new Set(scenario.steps.map(item => item.id)).size, scenario.id).toBe(3)
    }
  })
  it('covers everyday life and school, not only work, and leads with them', () => {
    const count = category => SCENARIO_CATALOG.filter(item => item.category === category).length
    expect(count('日常')).toBeGreaterThanOrEqual(5)
    expect(count('学习')).toBeGreaterThanOrEqual(4)
    expect(count('社交')).toBeGreaterThanOrEqual(2)
    expect(SCENARIO_CATALOG.slice(0, 6).every(item => item.category !== '职场')).toBe(true)
    // Each person is somebody else: one partner name per scenario.
    expect(new Set(SCENARIO_CATALOG.map(item => item.partner)).size).toBe(SCENARIO_CATALOG.length)
  })
  it('gives every built-in partner a fixed voice', () => {
    const pinned = SCENARIO_CATALOG.map(item => voiceForPartner(item.partner, ''))
    expect(pinned.every(Boolean)).toBe(true)
    expect(new Set(pinned).size).toBeGreaterThanOrEqual(6)
  })
})
