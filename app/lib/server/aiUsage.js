import 'server-only'

import { z } from 'zod'
import { getHistoryDatabaseConfig, historyDatabaseRequest, UUID_PATTERN } from '../history/server'

// Token accounting for the native iOS app (table public.ai_usage, migration 202610050002).

const count = z.number().int().min(0).max(50_000_000)

/** Sums Gemini usageMetadata objects (one per attempt) into our counters. */
export function tokensFromUsageMetadata(...usages) {
  const totals = { input: 0, output: 0, thinking: 0, total: 0 }
  for (const usage of usages) {
    if (!usage) continue
    totals.input += usage.promptTokenCount || 0
    totals.output += usage.candidatesTokenCount || 0
    totals.thinking += usage.thoughtsTokenCount || 0
    totals.total += usage.totalTokenCount || 0
  }
  return totals
}

async function insertUsage(row, prefer = 'return=minimal') {
  const config = getHistoryDatabaseConfig()
  if (!config) return
  const params = row.report_id ? new URLSearchParams({ on_conflict: 'user_id,report_id' }) : undefined
  const result = await historyDatabaseRequest(config, 'ai_usage', { method: 'POST', params, body: row, prefer })
  if (!result.ok) console.error('[ai-usage] write failed', { status: result.status, code: result.data?.code })
}

/**
 * Records one server-side model call. Never throws and is not awaited by
 * callers' responses: accounting must not slow down or break the learner.
 * The local development pairing has no account and is not recorded.
 */
export function recordUsage(userId, feature, model, tokens) {
  if (!UUID_PATTERN.test(userId || '') || !tokens) return
  insertUsage({
    user_id: userId, feature, model, input_tokens: tokens.input, output_tokens: tokens.output,
    thinking_tokens: tokens.thinking, total_tokens: tokens.total,
  }).catch(error => console.error('[ai-usage] write failed', error?.name))
}

export const liveUsageReportSchema = z.object({
  reportId: z.string().uuid(),
  model: z.string().trim().min(1).max(100),
  inputTokens: count, outputTokens: count, inputAudioTokens: count, outputAudioTokens: count, totalTokens: count,
}).strict().refine(report => report.inputAudioTokens <= report.inputTokens && report.outputAudioTokens <= report.outputTokens)

/** Live usage summed by the app over one connection; idempotent per reportId. */
export async function recordLiveUsage(userId, report) {
  await insertUsage({
    user_id: userId, feature: 'live', model: report.model, report_id: report.reportId,
    input_tokens: report.inputTokens, output_tokens: report.outputTokens,
    input_audio_tokens: report.inputAudioTokens, output_audio_tokens: report.outputAudioTokens,
    total_tokens: report.totalTokens,
  }, 'resolution=ignore-duplicates,return=minimal')
}

/**
 * Optional USD prices per 1M tokens, e.g.
 * AI_PRICING_JSON={"gemini-3.1-flash-lite":{"input":0.1,"output":0.4},
 *   "gemini-3.1-flash-live-preview":{"input":0.5,"output":2,"audioInput":3,"audioOutput":12}}
 * Unpriced models show tokens only; no price is ever guessed.
 */
export function pricingTable(env = process.env) {
  try {
    const parsed = JSON.parse(env.AI_PRICING_JSON || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

/** Estimated USD for aggregated counters of one model, or null when the model has no price. */
export function estimateCost(model, row, prices = pricingTable()) {
  const price = prices[model]
  if (!price || typeof price.input !== 'number' || typeof price.output !== 'number') return null
  const audioIn = price.audioInput ?? price.input
  const audioOut = price.audioOutput ?? price.output
  // Gemini bills thinking tokens as output.
  const usd = ((row.input_tokens - row.input_audio_tokens) * price.input + row.input_audio_tokens * audioIn
    + (row.output_tokens - row.output_audio_tokens + row.thinking_tokens) * price.output
    + row.output_audio_tokens * audioOut) / 1_000_000
  return Math.round(usd * 1e6) / 1e6
}

const SUM_FIELDS = ['calls', 'input_tokens', 'output_tokens', 'thinking_tokens', 'input_audio_tokens', 'output_audio_tokens', 'total_tokens']

function rollUp(rows, keyOf, prices) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key) || Object.fromEntries([['key', key], ...SUM_FIELDS.map(field => [field, 0]), ['cost', 0], ['unpriced', false]])
    for (const field of SUM_FIELDS) group[field] += Number(row[field]) || 0
    const cost = estimateCost(row.model, row, prices)
    if (cost === null) group.unpriced = true
    else group.cost = Math.round((group.cost + cost) * 1e6) / 1e6
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.total_tokens - a.total_tokens)
}

/** Totals plus breakdowns by day, feature, model and (admin only) user. */
export async function usageSummary({ since, userId = null, prices = pricingTable() }) {
  const config = getHistoryDatabaseConfig()
  if (!config) throw new Error('Usage store not configured')
  const result = await historyDatabaseRequest(config, 'rpc/ai_usage_summary', {
    method: 'POST', body: { p_since: since.toISOString(), p_user_id: userId },
  })
  if (!result.ok) throw new Error(`Usage summary failed: ${result.status}`)
  const rows = result.data?.rows || []
  const [total] = rollUp(rows, () => 'total', prices)
  return {
    since: since.toISOString(),
    total: total || Object.fromEntries([['key', 'total'], ...SUM_FIELDS.map(field => [field, 0]), ['cost', 0], ['unpriced', false]]),
    byDay: rollUp(rows, row => row.day, prices).sort((a, b) => b.key.localeCompare(a.key)),
    byFeature: rollUp(rows, row => row.feature, prices),
    byModel: rollUp(rows, row => row.model, prices),
    ...(userId ? {} : {
      users: new Set(rows.map(row => row.user_id)).size,
      byUser: rollUp(rows, row => row.user_id, prices).slice(0, 50),
    }),
  }
}
