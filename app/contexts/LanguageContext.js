'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'

// Supported languages and self-names
const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
]

const DEFAULT_LEARNING = { code: 'en', label: 'English' }
const DEFAULT_NATIVE = { code: 'zh-CN', label: '中文' }

function parseAcceptLanguageHeader(header) {
  if (!header || typeof header !== 'string') return []
  return header
    .split(',')
    .map((part) => part.trim().split(';')[0])
    .filter(Boolean)
}

function mapToSupportedNative(acceptLangs) {
  // Try to map accept-language codes to our supported set for native.
  const langs = Array.isArray(acceptLangs) ? acceptLangs : []
  for (const raw of langs) {
    const lower = raw.toLowerCase()
    if (lower.startsWith('zh')) return { code: 'zh-CN', label: '中文' }
    if (lower.startsWith('ja')) return { code: 'ja', label: '日本語' }
    if (lower.startsWith('es')) return { code: 'es', label: 'Español' }
    if (lower.startsWith('fr')) return { code: 'fr', label: 'Français' }
    if (lower.startsWith('de')) return { code: 'de', label: 'Deutsch' }
    if (lower.startsWith('en')) return { code: 'en', label: 'English' }
  }
  return DEFAULT_NATIVE
}

const LanguageContext = createContext(null)

export function LanguageProvider({ children, initialAcceptLanguage = '' }) {
  const { data: session } = useSession()

  const [learningLanguage, setLearningLanguage] = useState(DEFAULT_LEARNING)
  const [nativeLanguage, setNativeLanguage] = useState(DEFAULT_NATIVE)
  const [loading, setLoading] = useState(true)

  const hasHydratedRef = useRef(false)

  const saveLocal = useCallback((key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {}
  }, [])

  const loadLocal = useCallback((key) => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }, [])

  const persistToServer = useCallback(async (native, learning) => {
    const res = await fetch('/api/user/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ native, learning }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.error || 'Failed to save language preferences')
    }
  }, [])

  // Initial hydrate: prefer DB (if logged in), else localStorage, else Accept-Language, else defaults
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        // If logged-in, try server first
        if (session?.user?.id) {
          try {
            const res = await fetch('/api/user/preferences', { method: 'GET', cache: 'no-store' })
            if (res.ok) {
              const data = await res.json().catch(() => ({}))
              const pref = data?.data || null
              if (!cancelled && pref) {
                setNativeLanguage({
                  code: pref.native_language_code || DEFAULT_NATIVE.code,
                  label: pref.native_language_label || DEFAULT_NATIVE.label,
                })
                setLearningLanguage({
                  code: pref.learning_language_code || DEFAULT_LEARNING.code,
                  label: pref.learning_language_label || DEFAULT_LEARNING.label,
                })
                setLoading(false)
                hasHydratedRef.current = true
                return
              }
            }
          } catch {}
        }

        // Fallback to localStorage
        const localNative = loadLocal('nativeLanguage')
        const localLearning = loadLocal('learningLanguage')
        if (!cancelled && (localNative || localLearning)) {
          if (localNative) setNativeLanguage(localNative)
          if (localLearning) setLearningLanguage(localLearning)
          setLoading(false)
          hasHydratedRef.current = true
          return
        }

        // Fallback to Accept-Language header from server
        const fromHeader = mapToSupportedNative(parseAcceptLanguageHeader(initialAcceptLanguage))
        if (!cancelled) {
          setNativeLanguage(fromHeader || DEFAULT_NATIVE)
          setLearningLanguage(DEFAULT_LEARNING)
          setLoading(false)
          hasHydratedRef.current = true
        }
      } finally {
        setLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [initialAcceptLanguage, loadLocal, session?.user?.id])

  // Do not auto-persist. Persist only on explicit commit (e.g., Start Learning click).

  const commitPreferences = useCallback(async () => {
    // persist to localStorage
    saveLocal('nativeLanguage', nativeLanguage)
    saveLocal('learningLanguage', learningLanguage)
    // persist to DB if logged-in
    if (session?.user?.id) {
      await persistToServer(nativeLanguage, learningLanguage)
    }
  }, [learningLanguage, nativeLanguage, persistToServer, saveLocal, session?.user?.id])

  // Helper setters that also persist when logged in
  const updateLearningLanguage = useCallback((nextCode) => {
    const found = LANGUAGE_OPTIONS.find((l) => l.code === nextCode) || DEFAULT_LEARNING
    setLearningLanguage(found)
  }, [])

  const updateNativeLanguage = useCallback((nextCode) => {
    // Allow setting supported ones; if not found, default to zh-CN
    if (nextCode === 'zh' || nextCode === 'zh-CN' || nextCode === 'zh-TW') {
      setNativeLanguage({ code: 'zh-CN', label: '中文' })
      return
    }
    const found = LANGUAGE_OPTIONS.find((l) => l.code === nextCode)
    if (found) setNativeLanguage(found)
  }, [])

  const value = useMemo(() => ({
    loading,
    learningLanguage,
    nativeLanguage,
    setLearningLanguage: updateLearningLanguage,
    setNativeLanguage: updateNativeLanguage,
    options: LANGUAGE_OPTIONS,
    commitPreferences,
  }), [commitPreferences, learningLanguage, loading, nativeLanguage, updateLearningLanguage, updateNativeLanguage])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
