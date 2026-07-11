'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  DEFAULT_LEARNING_LANGUAGE,
  DEFAULT_NATIVE_LANGUAGE,
  getLanguage,
  LEARNING_LANGUAGE_OPTIONS,
  NATIVE_LANGUAGE_OPTIONS,
  resolveDistinctLanguagePair,
} from '@/app/lib/languages'

function parseAcceptLanguageHeader(header) {
  if (!header || typeof header !== 'string') return []
  return header
    .split(',')
    .map((part) => part.trim().split(';')[0])
    .filter(Boolean)
}

function mapToSupportedNative(acceptLangs) {
  const langs = Array.isArray(acceptLangs) ? acceptLangs : []
  for (const raw of langs) {
    const language = getLanguage(raw)
    if (language) return language
  }
  return DEFAULT_NATIVE_LANGUAGE
}

const LanguageContext = createContext(null)

export function LanguageProvider({ children, initialAcceptLanguage = '' }) {
  const { data: session, status: sessionStatus } = useSession()

  const [learningLanguage, setLearningLanguage] = useState(DEFAULT_LEARNING_LANGUAGE)
  const [nativeLanguage, setNativeLanguage] = useState(DEFAULT_NATIVE_LANGUAGE)
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
    if (sessionStatus === 'loading') return undefined
    let cancelled = false
    setLoading(true)
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
                const pair = resolveDistinctLanguagePair(
                  pref.learning_language_code,
                  pref.native_language_code,
                )
                setNativeLanguage(pair.nativeLanguage)
                setLearningLanguage(pair.learningLanguage)
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
          const pair = resolveDistinctLanguagePair(localLearning, localNative)
          setNativeLanguage(pair.nativeLanguage)
          setLearningLanguage(pair.learningLanguage)
          setLoading(false)
          hasHydratedRef.current = true
          return
        }

        // Fallback to Accept-Language header from server
        const fromHeader = mapToSupportedNative(parseAcceptLanguageHeader(initialAcceptLanguage))
        if (!cancelled) {
          const pair = resolveDistinctLanguagePair(DEFAULT_LEARNING_LANGUAGE, fromHeader)
          setNativeLanguage(pair.nativeLanguage)
          setLearningLanguage(pair.learningLanguage)
          setLoading(false)
          hasHydratedRef.current = true
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [initialAcceptLanguage, loadLocal, session?.user?.id, sessionStatus])

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
    const language = getLanguage(nextCode, { allowChinese: false })
    if (language && language.code !== nativeLanguage.code) setLearningLanguage(language)
  }, [nativeLanguage.code])

  const updateNativeLanguage = useCallback((nextCode) => {
    const language = getLanguage(nextCode)
    if (language && language.code !== learningLanguage.code) setNativeLanguage(language)
  }, [learningLanguage.code])

  const value = useMemo(() => ({
    loading,
    learningLanguage,
    nativeLanguage,
    setLearningLanguage: updateLearningLanguage,
    setNativeLanguage: updateNativeLanguage,
    // `options` is retained for older consumers; new code should use the
    // purpose-specific collections below.
    options: LEARNING_LANGUAGE_OPTIONS,
    learningOptions: LEARNING_LANGUAGE_OPTIONS,
    nativeOptions: NATIVE_LANGUAGE_OPTIONS,
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
