import { auth } from "@/app/auth"
import {
  CHAT_SOURCE_TYPES,
  UUID_PATTERN,
  createHistoryCursor,
  getHistoryDatabaseConfig,
  getRealUserMessages,
  historyDatabaseRequest,
  isMissingColumn,
  isMissingHistoryRpc,
  isRevisionConflict,
  logHistoryDatabaseError,
  mergeChatHistories,
  parseHistoryCursor,
  toChatHistoryDetail,
  toChatHistoryListItem,
} from "@/app/lib/history/server"

const MAX_REQUEST_BYTES = 1_000_000
const MAX_NEWS_KEY_LENGTH = 1_000
const MAX_TITLE_LENGTH = 1_000
const MAX_SUMMARY_LENGTH = 10_000
const MAX_HISTORY_ITEMS = 500
const MAX_NEWS_CONTENT_BYTES = 300_000

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function databaseFailure() {
  return jsonResponse({ error: "History storage is temporarily unavailable" }, 502)
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

function quotedFilterValue(value) {
  const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  return `"${escaped}"`
}

function validateOptionalText(value, name, maxLength) {
  if (value === undefined || value === null) return { value: null }
  if (typeof value !== "string") return { error: `'${name}' must be a string` }
  if (value.length > maxLength) return { error: `'${name}' is too long` }
  const normalized = value.trim()
  return { value: normalized || null }
}

function validatePostPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Request body must be a JSON object" }
  }

  if (typeof payload.newsKey !== "string" || !payload.newsKey.trim()) {
    return { error: "'newsKey' is required" }
  }
  const newsKey = payload.newsKey.trim()
  if (newsKey.length > MAX_NEWS_KEY_LENGTH) return { error: "'newsKey' is too long" }

  const sourceType = payload.sourceType ?? (newsKey.startsWith("scenario:") ? "scenario" : "news")
  if (!CHAT_SOURCE_TYPES.has(sourceType)) {
    return { error: "'sourceType' must be 'news' or 'scenario'" }
  }

  if (!Array.isArray(payload.history)) return { error: "'history' must be an array" }
  if (payload.history.length > MAX_HISTORY_ITEMS) return { error: "'history' has too many items" }
  if (payload.history.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    return { error: "Every history item must be an object" }
  }

  const title = validateOptionalText(payload.newsTitle, "newsTitle", MAX_TITLE_LENGTH)
  if (title.error) return title
  const summary = validateOptionalText(payload.summary, "summary", MAX_SUMMARY_LENGTH)
  if (summary.error) return summary

  const newsContent = payload.newsContent ?? null
  const hasNewsContent = Object.hasOwn(payload, "newsContent")
  if (hasNewsContent && byteLength(JSON.stringify(newsContent)) > MAX_NEWS_CONTENT_BYTES) {
    return { error: "'newsContent' is too large" }
  }

  if (payload.mergeOnServer !== undefined && typeof payload.mergeOnServer !== "boolean") {
    return { error: "'mergeOnServer' must be a boolean" }
  }

  let revision = null
  if (payload.revision !== undefined && payload.revision !== null) {
    if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) {
      return { error: "'revision' must be a non-negative integer" }
    }
    revision = payload.revision
  }

  return {
    value: {
      newsKey,
      newsTitle: title.value,
      newsContent: hasNewsContent ? newsContent : undefined,
      history: payload.history,
      summary: summary.value,
      sourceType,
      revision,
      mergeOnServer: payload.mergeOnServer === true,
    },
  }
}

async function readRequestBody(req) {
  const contentLength = Number.parseInt(req.headers.get("content-length") || "0", 10)
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return { error: "Request body is too large", status: 413 }
  }

  const raw = await req.text()
  if (byteLength(raw) > MAX_REQUEST_BYTES) return { error: "Request body is too large", status: 413 }
  try {
    return { value: JSON.parse(raw) }
  } catch {
    return { error: "Request body must be valid JSON", status: 400 }
  }
}

async function fetchCurrentRow(config, userId, { id, newsKey }) {
  const params = new URLSearchParams({
    user_id: `eq.${userId}`,
    select: "*",
    limit: "1",
  })
  if (id) params.set("id", `eq.${id}`)
  else params.set("news_key", `eq.${quotedFilterValue(newsKey)}`)
  const result = await historyDatabaseRequest(config, "chat_history", { params })
  const row = result.ok && Array.isArray(result.data) ? result.data[0] || null : null
  return { ...result, row }
}

function conflictResponse(currentRow) {
  return jsonResponse({
    error: "This conversation was updated in another session",
    code: "REVISION_CONFLICT",
    current: toChatHistoryDetail(currentRow),
  }, 409)
}

function rpcPayload(userId, payload) {
  return {
    p_user_id: userId,
    p_news_key: payload.newsKey,
    p_news_title: payload.newsTitle,
    p_news: payload.newsContent,
    p_history: payload.history,
    p_summary: payload.summary,
    p_source_type: payload.sourceType,
    p_expected_revision: payload.revision,
  }
}

function mergePayloadWithRow(payload, currentRow) {
  const currentRevision = currentRow
    ? (Number.isInteger(currentRow.revision) && currentRow.revision > 0 ? currentRow.revision : 1)
    : 0
  return {
    ...payload,
    newsTitle: payload.newsTitle ?? currentRow?.news_title ?? null,
    newsContent: currentRow?.news ?? payload.newsContent ?? null,
    history: mergeChatHistories(currentRow?.history || [], payload.history),
    revision: currentRevision,
  }
}

function mergedPayloadError(payload) {
  if (payload.history.length > MAX_HISTORY_ITEMS) return "Merged history has too many items"
  if (byteLength(JSON.stringify(payload.history)) > MAX_REQUEST_BYTES) {
    return "Merged history is too large"
  }
  return null
}

async function prepareServerMergedPayload(config, userId, payload) {
  const current = await fetchCurrentRow(config, userId, { newsKey: payload.newsKey })
  if (!current.ok) return { ok: false, result: current }
  const mergedPayload = mergePayloadWithRow(payload, current.row)
  const error = mergedPayloadError(mergedPayload)
  if (error) return { ok: false, error, status: 413 }
  return { ok: true, payload: mergedPayload }
}

function tableRow(userId, payload) {
  return {
    user_id: userId,
    news_key: payload.newsKey,
    news_title: payload.newsTitle,
    news: payload.newsContent,
    history: payload.history,
    summary: payload.summary,
    source_type: payload.sourceType,
  }
}

async function writeWithLegacySchemaFallback(config, options) {
  const variants = [options.body]
  if (Object.hasOwn(options.body, "revision")) {
    const withoutRevision = { ...options.body }
    delete withoutRevision.revision
    variants.push(withoutRevision)
  }
  const lastVariant = variants[variants.length - 1]
  if (Object.hasOwn(lastVariant, "source_type")) {
    const legacy = { ...lastVariant }
    delete legacy.source_type
    variants.push(legacy)
  }

  let result = null
  for (const body of variants) {
    result = await historyDatabaseRequest(config, "chat_history", { ...options, body })
    if (result.ok || !isMissingColumn(result)) return result
  }
  return result
}

async function saveWithoutRpc(config, userId, payload) {
  const currentResult = await fetchCurrentRow(config, userId, { newsKey: payload.newsKey })
  if (!currentResult.ok) return { kind: "error", result: currentResult }

  const current = currentResult.row
  const currentRevision = current && Number.isInteger(current.revision) && current.revision > 0
    ? current.revision
    : current ? 1 : 0
  if (payload.revision !== null && payload.revision !== currentRevision) {
    return { kind: "conflict", current }
  }

  const row = tableRow(userId, payload)
  if (current) {
    if (Object.hasOwn(current, "revision")) row.revision = currentRevision + 1
    if (!Object.hasOwn(current, "source_type")) delete row.source_type

    const params = new URLSearchParams({
      id: `eq.${current.id}`,
      user_id: `eq.${userId}`,
    })
    if (payload.revision !== null && Object.hasOwn(current, "revision")) {
      params.set("revision", `eq.${payload.revision}`)
    }
    const result = await writeWithLegacySchemaFallback(config, {
      method: "PATCH",
      params,
      body: row,
      prefer: "return=representation",
    })
    const saved = result.ok && Array.isArray(result.data) ? result.data[0] || null : null
    if (result.ok && !saved) {
      const latest = await fetchCurrentRow(config, userId, { newsKey: payload.newsKey })
      return { kind: "conflict", current: latest.row }
    }
    return result.ok ? { kind: "saved", row: saved } : { kind: "error", result }
  }

  if (payload.revision !== null && payload.revision !== 0) {
    return { kind: "conflict", current: null }
  }
  row.revision = 1
  const result = await writeWithLegacySchemaFallback(config, {
    method: "POST",
    body: row,
    prefer: "return=representation",
  })
  if (result.ok) {
    const saved = Array.isArray(result.data) ? result.data[0] || null : result.data
    return { kind: "saved", row: saved }
  }

  if (result.status === 409) {
    const latest = await fetchCurrentRow(config, userId, { newsKey: payload.newsKey })
    if (latest.ok && latest.row) return { kind: "conflict", current: latest.row }
  }
  return { kind: "error", result }
}

export async function POST(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401)

    const config = getHistoryDatabaseConfig()
    if (!config) return jsonResponse({ error: "Server configuration error" }, 500)

    const parsedBody = await readRequestBody(req)
    if (parsedBody.error) return jsonResponse({ error: parsedBody.error }, parsedBody.status)
    const validation = validatePostPayload(parsedBody.value)
    if (validation.error) return jsonResponse({ error: validation.error }, 400)
    let payload = validation.value

    if (getRealUserMessages(payload.history).length === 0) {
      return jsonResponse({ ok: true, skipped: true })
    }

    if (payload.mergeOnServer) {
      const prepared = await prepareServerMergedPayload(config, session.user.id, payload)
      if (!prepared.ok) {
        if (prepared.error) return jsonResponse({ error: prepared.error }, prepared.status)
        logHistoryDatabaseError("prepare merge save", prepared.result)
        return databaseFailure()
      }
      payload = prepared.payload
    } else if (payload.newsContent === undefined) {
      payload = { ...payload, newsContent: null }
    }

    let rpcResult = await historyDatabaseRequest(config, "rpc/save_chat_history", {
      method: "POST",
      body: rpcPayload(session.user.id, payload),
    })

    if (isRevisionConflict(rpcResult) && payload.mergeOnServer) {
      const prepared = await prepareServerMergedPayload(config, session.user.id, payload)
      if (!prepared.ok) {
        if (prepared.error) return jsonResponse({ error: prepared.error }, prepared.status)
        logHistoryDatabaseError("retry merge save", prepared.result)
        return databaseFailure()
      }
      payload = prepared.payload
      rpcResult = await historyDatabaseRequest(config, "rpc/save_chat_history", {
        method: "POST",
        body: rpcPayload(session.user.id, payload),
      })
    }

    if (rpcResult.ok) {
      const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data
      return jsonResponse({ ok: true, data: toChatHistoryDetail(row) })
    }

    if (isRevisionConflict(rpcResult)) {
      const current = await fetchCurrentRow(config, session.user.id, { newsKey: payload.newsKey })
      if (!current.ok) logHistoryDatabaseError("read current revision", current)
      return conflictResponse(current.row)
    }

    if (!isMissingHistoryRpc(rpcResult)) {
      logHistoryDatabaseError("save via RPC", rpcResult)
      return databaseFailure()
    }

    console.warn("[history] save_chat_history RPC is unavailable; using the migration-compatible write path")
    let fallback = await saveWithoutRpc(config, session.user.id, payload)
    if (fallback.kind === "conflict" && payload.mergeOnServer) {
      payload = mergePayloadWithRow(payload, fallback.current)
      const mergeError = mergedPayloadError(payload)
      if (mergeError) return jsonResponse({ error: mergeError }, 413)
      fallback = await saveWithoutRpc(config, session.user.id, payload)
    }
    if (fallback.kind === "saved") {
      return jsonResponse({ ok: true, data: toChatHistoryDetail(fallback.row) })
    }
    if (fallback.kind === "conflict") return conflictResponse(fallback.current)
    logHistoryDatabaseError("save via compatibility path", fallback.result)
    return databaseFailure()
  } catch (error) {
    console.error("[history] unexpected POST failure", error)
    return jsonResponse({ error: "Unable to save history" }, 500)
  }
}

function parseLimit(value) {
  if (value === null) return 20
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : null
}

export async function GET(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401)

    const config = getHistoryDatabaseConfig()
    if (!config) return jsonResponse({ error: "Server configuration error" }, 500)

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    const newsKey = searchParams.get("newsKey")

    if (id) {
      if (!UUID_PATTERN.test(id)) return jsonResponse({ error: "'id' must be a valid UUID" }, 400)
      const result = await fetchCurrentRow(config, session.user.id, { id })
      if (!result.ok) {
        logHistoryDatabaseError("read detail", result)
        return databaseFailure()
      }
      if (!result.row) return jsonResponse({ error: "Conversation not found" }, 404)
      return jsonResponse({ ok: true, data: toChatHistoryDetail(result.row) })
    }

    if (newsKey !== null) {
      if (!newsKey.trim() || newsKey.length > MAX_NEWS_KEY_LENGTH) {
        return jsonResponse({ error: "'newsKey' is invalid" }, 400)
      }
      const result = await fetchCurrentRow(config, session.user.id, { newsKey })
      if (!result.ok) {
        logHistoryDatabaseError("read by news key", result)
        return databaseFailure()
      }
      return jsonResponse({
        ok: true,
        data: result.row ? [toChatHistoryDetail(result.row)] : [],
      })
    }

    const limit = parseLimit(searchParams.get("limit"))
    if (limit === null) return jsonResponse({ error: "'limit' must be an integer from 1 to 50" }, 400)

    const sourceType = searchParams.get("sourceType")
    if (sourceType !== null && !CHAT_SOURCE_TYPES.has(sourceType)) {
      return jsonResponse({ error: "'sourceType' must be 'news' or 'scenario'" }, 400)
    }

    const rawCursor = searchParams.get("before")
    const cursor = rawCursor ? parseHistoryCursor(rawCursor) : null
    if (rawCursor && !cursor) return jsonResponse({ error: "'before' must be a valid composite cursor" }, 400)

    const batchSize = Math.max(100, limit + 1)
    const eligibleRows = []
    let scanCursor = cursor
    let exhausted = false
    let filterSourceInMemory = false

    // Skip legacy rows that contain only a system context. Scan in bounded
    // batches so an old account with empty rows still gets a full useful page.
    for (let scan = 0; scan < 100 && eligibleRows.length <= limit && !exhausted; scan += 1) {
      const params = new URLSearchParams({
        user_id: `eq.${session.user.id}`,
        select: "*",
        order: "updated_at.desc,id.desc",
        limit: String(batchSize),
      })
      if (sourceType && !filterSourceInMemory) params.set("source_type", `eq.${sourceType}`)
      if (scanCursor) {
        params.set("or", `(updated_at.lt.${scanCursor.timestamp},and(updated_at.eq.${scanCursor.timestamp},id.lt.${scanCursor.id}))`)
      }

      let result = await historyDatabaseRequest(config, "chat_history", { params })
      if (!result.ok && sourceType && !filterSourceInMemory && isMissingColumn(result)) {
        filterSourceInMemory = true
        params.delete("source_type")
        result = await historyDatabaseRequest(config, "chat_history", { params })
      }
      if (!result.ok) {
        logHistoryDatabaseError("list", result)
        return databaseFailure()
      }

      const rows = Array.isArray(result.data) ? result.data : []
      for (const row of rows) {
        if (getRealUserMessages(row.history).length === 0) continue
        if (sourceType && toChatHistoryListItem(row).sourceType !== sourceType) continue
        eligibleRows.push(row)
        if (eligibleRows.length > limit) break
      }
      exhausted = rows.length < batchSize
      const lastRow = rows.at(-1)
      scanCursor = lastRow
        ? { timestamp: new Date(lastRow.updated_at).toISOString(), id: lastRow.id }
        : scanCursor
    }

    const page = eligibleRows.slice(0, limit)
    return jsonResponse({
      ok: true,
      data: page.map(toChatHistoryListItem),
      nextCursor: (eligibleRows.length > limit || !exhausted) && page.length > 0
        ? createHistoryCursor(page[page.length - 1])
        : null,
    })
  } catch (error) {
    console.error("[history] unexpected GET failure", error)
    return jsonResponse({ error: "Unable to load history" }, 500)
  }
}

export async function DELETE(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401)

    const config = getHistoryDatabaseConfig()
    if (!config) return jsonResponse({ error: "Server configuration error" }, 500)

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    const newsKey = searchParams.get("newsKey")
    if (id && !UUID_PATTERN.test(id)) return jsonResponse({ error: "'id' must be a valid UUID" }, 400)
    if (!id && (!newsKey || !newsKey.trim() || newsKey.length > MAX_NEWS_KEY_LENGTH)) {
      return jsonResponse({ error: "'id' or 'newsKey' is required" }, 400)
    }

    const params = new URLSearchParams({ user_id: `eq.${session.user.id}` })
    if (id) params.set("id", `eq.${id}`)
    else params.set("news_key", `eq.${quotedFilterValue(newsKey)}`)

    const result = await historyDatabaseRequest(config, "chat_history", {
      method: "DELETE",
      params,
      prefer: "return=representation",
    })
    if (!result.ok) {
      logHistoryDatabaseError("delete", result)
      return databaseFailure()
    }

    const deleted = Array.isArray(result.data) ? result.data[0] || null : result.data
    if (!deleted) return jsonResponse({ error: "Conversation not found" }, 404)
    return jsonResponse({ ok: true, data: toChatHistoryDetail(deleted) })
  } catch (error) {
    console.error("[history] unexpected DELETE failure", error)
    return jsonResponse({ error: "Unable to delete history" }, 500)
  }
}
