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

export const GEMINI_REQUEST_TIMEOUT_MS = 25000

// baseUrl: 'default' follows the configured relay, 'official' always uses
// Google's endpoint, any other string is an explicit override.
export function createServerGeminiClient({ baseUrl = 'default', apiVersion, timeout } = {}) {
  const apiKey = getServerGeminiApiKey()
  if (!apiKey) return null

  const resolvedBaseUrl = baseUrl === 'default' ? getServerGeminiBaseUrl()
    : baseUrl === 'official' ? '' : baseUrl
  const httpOptions = {
    ...(resolvedBaseUrl ? { baseUrl: resolvedBaseUrl } : {}),
    ...(apiVersion ? { apiVersion } : {}),
    ...(timeout ? { timeout } : {}),
  }
  return new GoogleGenAI({
    apiKey,
    ...(Object.keys(httpOptions).length ? { httpOptions } : {}),
  })
}
