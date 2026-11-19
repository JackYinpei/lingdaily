import { describe, expect, it } from 'vitest'
import FeatureShell from '@/app/components/FeatureShell'
import { LanguageProvider } from '@/app/contexts/LanguageContext'
import { ThemeProvider } from '@/app/contexts/ThemeContext'

describe('shared feature imports', () => {
  it('loads the shell with real JSX-in-JS context modules', () => {
    expect(typeof FeatureShell).toBe('function')
    expect(typeof LanguageProvider).toBe('function')
    expect(typeof ThemeProvider).toBe('function')
  })
})
