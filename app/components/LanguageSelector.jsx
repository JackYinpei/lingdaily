'use client'

import React, { useMemo } from 'react'
import { useLanguage } from '@/app/contexts/LanguageContext'

export default function LanguageSelector({ className = '', kind = 'learning', label }) {
  const {
    loading,
    learningLanguage,
    nativeLanguage,
    setLearningLanguage,
    setNativeLanguage,
    learningOptions,
    nativeOptions,
  } = useLanguage()

  const isNative = kind === 'native'

  const { value, onChange, list } = useMemo(() => {
    if (isNative) {
      return {
        value: nativeLanguage?.code || 'zh-CN',
        onChange: (code) => setNativeLanguage(code),
        list: nativeOptions.filter((option) => option.code !== learningLanguage?.code),
      }
    }
    return {
      value: learningLanguage?.code || 'en',
      onChange: (code) => setLearningLanguage(code),
      list: learningOptions.filter((option) => option.code !== nativeLanguage?.code),
    }
  }, [isNative, learningLanguage?.code, learningOptions, nativeLanguage?.code, nativeOptions, setLearningLanguage, setNativeLanguage])

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {label ? (
        <label htmlFor={`${kind}-language`} className="text-sm text-zinc-300">
          {label}
        </label>
      ) : null}
      <select
        id={`${kind}-language`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        className="bg-zinc-900 border border-zinc-700 text-white text-sm rounded-md px-2 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-50 disabled:cursor-wait"
        aria-label={`Select ${kind} language`}
      >
        {list.map((opt) => (
          <option key={opt.code} value={opt.code}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
