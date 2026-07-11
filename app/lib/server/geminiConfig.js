import 'server-only'

import { GoogleGenAI } from '@google/genai'

export function getServerGeminiApiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()
}

export function getServerGeminiBaseUrl() {
  return (
    process.env.GEMINI_BASE_URL
    || process.env.GOOGLE_GEMINI_BASE_URL
    || process.env.NEXT_PUBLIC_GEMINI_BASE_URL
    || ''
  ).trim()
}

export function createServerGeminiClient() {
  const apiKey = getServerGeminiApiKey()
  if (!apiKey) return null

  const baseUrl = getServerGeminiBaseUrl()
  return new GoogleGenAI({
    apiKey,
    ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
  })
}
