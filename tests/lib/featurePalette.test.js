import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8')
const featureCss = readFileSync(new URL('../../app/components/features.css', import.meta.url), 'utf8')
const palettes = {
  light: { background: '#f6f7f2', card: '#fdfef9', foreground: '#26382f', 'muted-foreground': '#58675d', secondary: '#e8eee5', border: '#cbd5c9', primary: '#365d4a', 'primary-hover': '#294b3b', 'primary-foreground': '#ffffff' },
  dark: { background: '#18241e', card: '#213128', foreground: '#eef3e9', 'muted-foreground': '#b6c5b7', secondary: '#2c3f32', border: '#465f4d', primary: '#b1cbaa', 'primary-hover': '#c8dabd', 'primary-foreground': '#18241e' },
}

function tokens(theme) {
  const selector = theme === 'dark' ? '.dark .feature-app' : '.feature-app'
  const block = css.split(`${selector} {`)[1].split('}')[0]
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]+);/g)].map(([, name, value]) => [name, value]))
}

function luminance(hex) {
  const [red, green, blue] = hex.slice(1).match(/../g).map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('selected Paper & Pine feature palette', () => {
  it.each(['light', 'dark'])('matches option A in %s mode', (theme) => {
    const actual = tokens(theme)
    expect(actual).toMatchObject(palettes[theme])
    expect(actual.popover).toBe(actual.card)
    expect(actual.accent).toBe(actual.secondary)
    for (const role of ['brand', 'brand-from', 'brand-via', 'brand-to', 'ring']) {
      expect(actual[role]).toBe(actual.primary)
    }
  })

  it.each(['light', 'dark'])('keeps text, actions and chart marks readable in %s mode', (theme) => {
    const palette = tokens(theme)
    for (const surface of ['background', 'card', 'secondary']) {
      expect(contrast(palette.foreground, palette[surface])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette['muted-foreground'], palette[surface])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.primary, palette[surface])).toBeGreaterThanOrEqual(3)
    }
    for (const action of ['primary', 'primary-hover']) {
      expect(contrast(palette['primary-foreground'], palette[action])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('extends the page palette to portaled controls and uses the selected hover shade', () => {
    expect(css).toContain('body:has(.feature-app),\n.feature-app {')
    expect(css).toContain('.dark body:has(.feature-app),\n.dark .feature-app {')
    const utilityLayer = featureCss.match(/@layer utilities \{([\s\S]*?)\n\}/)[1]
    expect(utilityLayer).toContain('background-color: var(--primary-hover)')
  })
})
