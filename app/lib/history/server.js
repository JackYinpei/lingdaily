import "server-only"

export const CHAT_SOURCE_TYPES = new Set(["news", "scenario"])
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseSchema = process.env.SUPABASE_SCHEMA || "public"

export function getHistoryDatabaseConfig() {
  if (!supabaseUrl || !serviceRoleKey) return null
  return {
    baseUrl: supabaseUrl.replace(/\/$/, ""),
    serviceRoleKey,
    schema: supabaseSchema,
  }
}

export async function historyDatabaseRequest(
  config,
  resource,
  { method = "GET", params, body, prefer, headers: extraHeaders } = {},
) {
  const url = new URL(`${config.baseUrl}/rest/v1/${resource}`)
  if (params) {
    for (const [key, value] of params.entries()) url.searchParams.append(key, value)
  }

  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    Accept: "application/json",
    "Cache-Control": "no-cache",
    "Accept-Profile": config.schema,
    ...extraHeaders,
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json"
    headers["Content-Profile"] = config.schema
  }
  if (prefer) headers.Prefer = prefer

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  return { ok: response.ok, status: response.status, data }
}

export function logHistoryDatabaseError(operation, result) {
  console.error(`[history] ${operation} failed`, {
    status: result?.status,
    code: result?.data?.code,
    message: result?.data?.message,
  })
}

export function isMissingHistoryRpc(result) {
  const code = result?.data?.code
  const message = String(result?.data?.message || "").toLowerCase()
  return code === "PGRST202"
    || (result?.status === 404 && message.includes("save_chat_history"))
    || message.includes("could not find the function")
}

export function isMissingColumn(result) {
  const code = result?.data?.code
  const message = String(result?.data?.message || "").toLowerCase()
  return code === "42703"
    || code === "PGRST204"
    || (message.includes("column") && message.includes("does not exist"))
}

export function isRevisionConflict(result) {
  return result?.data?.message === "CHAT_HISTORY_REVISION_CONFLICT"
}

export function extractMessageText(message) {
  if (!message || typeof message !== "object") return ""
  if (typeof message.content === "string") return message.content.trim()
  if (!Array.isArray(message.content)) return ""

  return message.content
    .map((part) => {
      if (typeof part === "string") return part
      if (!part || typeof part !== "object") return ""
      return typeof part.text === "string" ? part.text : ""
    })
    .join(" ")
    .trim()
}

export function getRealUserMessages(history) {
  if (!Array.isArray(history)) return []
  return history.filter((message) => message?.role === "user" && extractMessageText(message))
}

function historyItemKey(item) {
  return item?.itemId || [
    item?.role || "",
    extractMessageText(item),
    item?.metadata?.createdAt || item?.metadata?.createAt || "",
  ].join(":")
}

function preferCompleteHistoryItem(existing, incoming) {
  const existingFinal = Boolean(existing?.metadata?.isFinal)
  const incomingFinal = Boolean(incoming?.metadata?.isFinal)
  if (existingFinal !== incomingFinal) return incomingFinal ? incoming : existing

  const existingText = extractMessageText(existing)
  const incomingText = extractMessageText(incoming)
  if (existingText.length !== incomingText.length) {
    return incomingText.length > existingText.length ? incoming : existing
  }
  return incoming
}

export function mergeChatHistories(currentHistory, incomingHistory) {
  const merged = []
  const indexByKey = new Map()
  for (const item of [...(currentHistory || []), ...(incomingHistory || [])]) {
    const key = historyItemKey(item)
    const existingIndex = indexByKey.get(key)
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length)
      merged.push(item)
    } else {
      merged[existingIndex] = preferCompleteHistoryItem(merged[existingIndex], item)
    }
  }
  return merged
}

function normalizePreview(value, maxLength = 180) {
  if (typeof value !== "string") return ""
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact
}

function inferSourceType(row) {
  if (CHAT_SOURCE_TYPES.has(row?.source_type)) return row.source_type
  return String(row?.news_key || "").startsWith("scenario:") ? "scenario" : "news"
}

function normalizedRevision(value) {
  return Number.isInteger(value) && value > 0 ? value : 1
}

function normalizedTitle(row) {
  if (typeof row?.news_title === "string" && row.news_title.trim()) return row.news_title.trim()
  const embedded = row?.news
  if (embedded && typeof embedded === "object") {
    const candidate = embedded.originalTitle || embedded.title || embedded.id
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  return "Untitled"
}

export function toChatHistoryDetail(row) {
  if (!row) return null
  const history = Array.isArray(row.history) ? row.history : []
  const title = normalizedTitle(row)
  return {
    id: row.id,
    newsKey: row.news_key,
    newsTitle: title,
    title,
    newsContent: row.news ?? null,
    history,
    summary: typeof row.summary === "string" ? row.summary : null,
    sourceType: inferSourceType(row),
    revision: normalizedRevision(row.revision),
    userTurnCount: getRealUserMessages(history).length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toChatHistoryListItem(row) {
  const history = Array.isArray(row?.history) ? row.history : []
  const lastConversationalMessage = [...history]
    .reverse()
    .find((message) => (message?.role === "user" || message?.role === "assistant") && extractMessageText(message))

  return {
    id: row.id,
    newsKey: row.news_key,
    title: normalizedTitle(row),
    sourceType: inferSourceType(row),
    preview: normalizePreview(extractMessageText(lastConversationalMessage)),
    userTurnCount: getRealUserMessages(history).length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: normalizedRevision(row.revision),
  }
}

export function parseHistoryCursor(value) {
  if (!value || typeof value !== "string") return null
  const separator = value.lastIndexOf("|")
  if (separator <= 0) return null
  const rawTimestamp = value.slice(0, separator)
  const id = value.slice(separator + 1)
  if (!UUID_PATTERN.test(id) || Number.isNaN(Date.parse(rawTimestamp))) return null
  return { timestamp: new Date(rawTimestamp).toISOString(), id }
}

export function createHistoryCursor(row) {
  return row?.updated_at && row?.id ? `${new Date(row.updated_at).toISOString()}|${row.id}` : null
}

export function getUserMessageTimestamp(message, fallback) {
  const candidates = [
    message?.metadata?.createdAt,
    message?.metadata?.createAt,
    message?.createdAt,
    fallback,
  ]
  for (const value of candidates) {
    if (typeof value !== "string" && !(value instanceof Date)) continue
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}
