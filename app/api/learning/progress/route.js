import { auth } from "@/app/auth"
import {
  getHistoryDatabaseConfig,
  getRealUserMessages,
  getUserMessageTimestamp,
  historyDatabaseRequest,
  isMissingColumn,
  logHistoryDatabaseError,
} from "@/app/lib/history/server"

const PAGE_SIZE = 500

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

function validateTimeZone(value) {
  if (typeof value !== "string" || !value || value.length > 100) return null
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format()
    return value
  } catch {
    return null
  }
}

function createDateFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function localDateKey(date, formatter) {
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

function sourceTypeForRow(row) {
  if (row?.source_type === "scenario") return "scenario"
  if (row?.source_type === "news") return "news"
  return String(row?.news_key || "").startsWith("scenario:") ? "scenario" : "news"
}

async function loadAllHistoryRows(config, userId) {
  const rows = []
  let offset = 0
  let includeSourceType = true

  while (true) {
    const select = includeSourceType
      ? "id,news_key,history,source_type,updated_at"
      : "id,news_key,history,updated_at"
    const params = new URLSearchParams({
      user_id: `eq.${userId}`,
      select,
      order: "updated_at.desc,id.desc",
      limit: String(PAGE_SIZE),
      offset: String(offset),
    })
    const result = await historyDatabaseRequest(config, "chat_history", { params })

    if (!result.ok && includeSourceType && isMissingColumn(result)) {
      includeSourceType = false
      rows.length = 0
      offset = 0
      continue
    }
    if (!result.ok) return { ...result, rows: null }

    const page = Array.isArray(result.data) ? result.data : []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { ok: true, rows }
    offset += PAGE_SIZE
  }
}

export async function GET(req) {
  try {
    const session = await auth()
    if (!session?.user?.id) return jsonResponse({ error: "Unauthorized" }, 401)

    const config = getHistoryDatabaseConfig()
    if (!config) return jsonResponse({ error: "Server configuration error" }, 500)

    const { searchParams } = new URL(req.url)
    const timeZone = validateTimeZone(searchParams.get("timezone") || "UTC")
    if (!timeZone) return jsonResponse({ error: "'timezone' must be a valid IANA time zone" }, 400)

    const result = await loadAllHistoryRows(config, session.user.id)
    if (!result.ok) {
      logHistoryDatabaseError("calculate progress", result)
      return jsonResponse({ error: "Learning progress is temporarily unavailable" }, 502)
    }

    const formatter = createDateFormatter(timeZone)
    const now = new Date()
    const today = localDateKey(now, formatter)
    const activeDates = new Set()
    const turnsByDate = new Map()
    const conversationsByDate = new Map()
    const bySource = {
      news: { conversations: 0, userTurns: 0 },
      scenario: { conversations: 0, userTurns: 0 },
    }
    let totalConversations = 0
    let totalUserTurns = 0

    for (const row of result.rows) {
      const userMessages = getRealUserMessages(row.history)
      if (userMessages.length === 0) continue

      totalConversations += 1
      totalUserTurns += userMessages.length
      const sourceType = sourceTypeForRow(row)
      bySource[sourceType].conversations += 1
      bySource[sourceType].userTurns += userMessages.length

      const rowDates = new Set()
      for (const message of userMessages) {
        const timestamp = getUserMessageTimestamp(message, row.updated_at)
        if (!timestamp) continue
        const dateKey = localDateKey(timestamp, formatter)
        activeDates.add(dateKey)
        rowDates.add(dateKey)
        turnsByDate.set(dateKey, (turnsByDate.get(dateKey) || 0) + 1)
      }
      for (const dateKey of rowDates) {
        if (!conversationsByDate.has(dateKey)) conversationsByDate.set(dateKey, new Set())
        conversationsByDate.get(dateKey).add(row.id)
      }
    }

    const sortedActiveDates = [...activeDates].sort()
    const lastActiveDate = sortedActiveDates.at(-1) || null
    let currentStreak = 0
    if (lastActiveDate === today || lastActiveDate === shiftDateKey(today, -1)) {
      let cursor = lastActiveDate
      while (activeDates.has(cursor)) {
        currentStreak += 1
        cursor = shiftDateKey(cursor, -1)
      }
    }

    const recent7Days = Array.from({ length: 7 }, (_, index) => {
      const date = shiftDateKey(today, index - 6)
      return {
        date,
        userTurns: turnsByDate.get(date) || 0,
        conversations: conversationsByDate.get(date)?.size || 0,
      }
    })

    return jsonResponse({
      ok: true,
      data: {
        timezone: timeZone,
        totalConversations,
        totalUserTurns,
        activeDays: activeDates.size,
        currentStreak,
        lastActiveDate,
        recent7Days,
        bySource,
      },
    })
  } catch (error) {
    console.error("[history] unexpected progress failure", error)
    return jsonResponse({ error: "Unable to calculate learning progress" }, 500)
  }
}
