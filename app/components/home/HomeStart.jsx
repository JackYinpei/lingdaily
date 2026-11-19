'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { useLanguage } from '@/app/contexts/LanguageContext'

export default function HomeStart({ t, signedIn }) {
  const router = useRouter()
  const {
    loading,
    nativeLanguage,
    learningLanguage,
    nativeOptions,
    learningOptions,
    setNativeLanguage,
    setLearningLanguage,
    commitPreferences,
  } = useLanguage()
  const [submitting, setSubmitting] = useState(false)
  const start = async (event) => {
    event.preventDefault()
    if (loading || submitting) return
    setSubmitting(true)
    // commitPreferences saves locally first; a sync outage must not block practice.
    try {
      await commitPreferences()
    } catch {
      /* The local selection is already saved. */
    }
    router.push(signedIn ? '/talk' : '/sign-in?callbackUrl=%2Ftalk')
  }
  return (
    <form className="home-start-form" onSubmit={start}>
      <div className="home-language-pair">
        <label htmlFor="home-native-language">
          {t.native}
          <select
            id="home-native-language"
            value={nativeLanguage.code}
            onChange={(event) => setNativeLanguage(event.target.value)}
            disabled={loading || submitting}
          >
            {nativeOptions
              .filter((option) => option.code !== learningLanguage.code)
              .map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
          </select>
        </label>
        <ArrowRight
          className="home-language-arrow"
          size={18}
          aria-hidden="true"
        />
        <label htmlFor="home-learning-language">
          {t.learning}
          <select
            id="home-learning-language"
            value={learningLanguage.code}
            onChange={(event) => setLearningLanguage(event.target.value)}
            disabled={loading || submitting}
          >
            {learningOptions
              .filter((option) => option.code !== nativeLanguage.code)
              .map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
          </select>
        </label>
      </div>
      <button
        className="home-button"
        type="submit"
        disabled={loading || submitting}
      >
        {submitting ? t.starting : signedIn ? t.continue : t.start}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  )
}
