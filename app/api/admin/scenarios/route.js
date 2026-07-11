import { checkAdmin } from '@/app/lib/adminAuth'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseSchema = process.env.SUPABASE_SCHEMA || 'public'
const tableUrl = supabaseUrl ? `${supabaseUrl}/rest/v1/scenarios` : null

const DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced'])
const SLUG_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WRITABLE_FIELDS = new Set([
  'category_slug', 'category_name_zh', 'category_name_en', 'category_name_ja',
  'category_icon', 'category_sort', 'title_zh', 'title_en', 'title_ja',
  'description_zh', 'description_en', 'description_ja', 'difficulty',
  'system_prompt', 'sort_order', 'is_active',
])

function jsonResponse(body, status = 200) {
  return Response.json(body, { status })
}

function requireConfig() {
  if (!tableUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ error: 'Admin scenarios require Supabase URL and service role key' }, 500)
  }
  return null
}

function supabaseHeaders(prefer = 'return=representation') {
  return {
    'Content-Type': 'application/json',
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    'Content-Profile': supabaseSchema,
    'Accept-Profile': supabaseSchema,
    Accept: 'application/json',
    Prefer: prefer,
  }
}

async function readResponse(response, fallback = null) {
  const text = await response.text()
  try { return text ? JSON.parse(text) : fallback } catch { return fallback }
}

function validateSlug(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug) && slug.length <= 80
}

function toInteger(value, fallback = 0) {
  const number = Number(value)
  return Number.isInteger(number) ? number : fallback
}

function buildScenarioRow(body, { partial = false } = {}) {
  const row = {}
  for (const field of WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) row[field] = body[field]
  }

  if (!partial || Object.prototype.hasOwnProperty.call(row, 'category_slug')) {
    if (!validateSlug(row.category_slug)) throw new Error('A valid category_slug is required')
  }
  if (!partial || Object.prototype.hasOwnProperty.call(row, 'title_zh')) {
    if (typeof row.title_zh !== 'string' || !row.title_zh.trim()) throw new Error('title_zh is required')
    row.title_zh = row.title_zh.trim()
  }
  if (!partial || Object.prototype.hasOwnProperty.call(row, 'title_en')) {
    if (typeof row.title_en !== 'string' || !row.title_en.trim()) throw new Error('title_en is required')
    row.title_en = row.title_en.trim()
  }
  if (!partial || Object.prototype.hasOwnProperty.call(row, 'system_prompt')) {
    if (typeof row.system_prompt !== 'string' || !row.system_prompt.trim()) throw new Error('system_prompt is required')
    row.system_prompt = row.system_prompt.trim()
  }
  if (Object.prototype.hasOwnProperty.call(row, 'difficulty') && !DIFFICULTIES.has(row.difficulty)) {
    throw new Error('Invalid difficulty')
  }

  if (Object.prototype.hasOwnProperty.call(row, 'category_sort')) row.category_sort = toInteger(row.category_sort)
  if (Object.prototype.hasOwnProperty.call(row, 'sort_order')) row.sort_order = toInteger(row.sort_order)
  if (Object.prototype.hasOwnProperty.call(row, 'is_active')) row.is_active = row.is_active !== false

  for (const field of ['category_name_zh', 'category_name_en', 'category_name_ja', 'category_icon', 'title_ja', 'description_zh', 'description_en', 'description_ja']) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      row[field] = typeof row[field] === 'string' && row[field].trim() ? row[field].trim() : null
    }
  }
  return row
}

async function ensureAdmin() {
  const session = await checkAdmin()
  return session || null
}

export async function GET(req) {
  try {
    if (!(await ensureAdmin())) return jsonResponse({ error: 'Forbidden' }, 403)
    const configError = requireConfig()
    if (configError) return configError

    const { searchParams } = new URL(req.url)
    const query = new URLSearchParams({
      user_id: 'is.null',
      order: 'category_sort.asc,sort_order.asc,title_en.asc',
    })

    if (searchParams.get('categories') === 'true') {
      query.set('select', 'category_slug,category_name_zh,category_name_en,category_name_ja,category_icon,category_sort')
      const response = await fetch(`${tableUrl}?${query}`, { headers: supabaseHeaders(), cache: 'no-store' })
      const rows = await readResponse(response, [])
      if (!response.ok) return jsonResponse({ error: rows?.message || 'Failed to fetch categories' }, response.status)

      const seen = new Set()
      const categories = rows.filter((row) => {
        if (!row.category_slug || seen.has(row.category_slug)) return false
        seen.add(row.category_slug)
        return true
      }).map((row) => ({
        id: row.category_slug,
        slug: row.category_slug,
        name_zh: row.category_name_zh,
        name_en: row.category_name_en,
        name_ja: row.category_name_ja,
        icon: row.category_icon,
        sort_order: row.category_sort,
      }))
      return jsonResponse({ ok: true, data: categories })
    }

    const categorySlug = searchParams.get('categorySlug')
    if (!validateSlug(categorySlug)) return jsonResponse({ error: 'A valid categorySlug is required' }, 400)
    query.set('category_slug', `eq.${categorySlug}`)
    query.set('select', '*')

    const response = await fetch(`${tableUrl}?${query}`, { headers: supabaseHeaders(), cache: 'no-store' })
    const data = await readResponse(response, [])
    if (!response.ok) return jsonResponse({ error: data?.message || 'Failed to fetch scenarios' }, response.status)
    return jsonResponse({ ok: true, data: Array.isArray(data) ? data : [] })
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500)
  }
}

export async function POST(req) {
  try {
    if (!(await ensureAdmin())) return jsonResponse({ error: 'Forbidden' }, 403)
    const configError = requireConfig()
    if (configError) return configError

    const body = await req.json().catch(() => ({}))
    let row
    try { row = buildScenarioRow(body) } catch (error) { return jsonResponse({ error: error.message }, 400) }
    row.user_id = null
    row.is_public = true
    row.is_active = row.is_active !== false
    row.difficulty = row.difficulty || 'intermediate'
    row.category_sort = toInteger(row.category_sort)
    row.sort_order = toInteger(row.sort_order)

    const response = await fetch(tableUrl, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify(row),
      cache: 'no-store',
    })
    const data = await readResponse(response)
    if (!response.ok) return jsonResponse({ error: data?.message || 'Create failed' }, response.status)
    return jsonResponse({ ok: true, data: Array.isArray(data) ? data[0] : data }, 201)
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500)
  }
}

export async function PUT(req) {
  try {
    if (!(await ensureAdmin())) return jsonResponse({ error: 'Forbidden' }, 403)
    const configError = requireConfig()
    if (configError) return configError

    const body = await req.json().catch(() => ({}))
    if (!UUID_PATTERN.test(body?.id || '')) return jsonResponse({ error: 'A valid id is required' }, 400)

    let fields
    try { fields = buildScenarioRow(body, { partial: true }) } catch (error) { return jsonResponse({ error: error.message }, 400) }
    if (Object.keys(fields).length === 0) return jsonResponse({ error: 'No writable fields supplied' }, 400)

    const response = await fetch(`${tableUrl}?id=eq.${body.id}&user_id=is.null`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify(fields),
      cache: 'no-store',
    })
    const data = await readResponse(response, [])
    if (!response.ok) return jsonResponse({ error: data?.message || 'Update failed' }, response.status)
    if (!Array.isArray(data) || data.length === 0) return jsonResponse({ error: 'System scenario not found' }, 404)
    return jsonResponse({ ok: true, data: data[0] })
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500)
  }
}

export async function DELETE(req) {
  try {
    if (!(await ensureAdmin())) return jsonResponse({ error: 'Forbidden' }, 403)
    const configError = requireConfig()
    if (configError) return configError

    const id = new URL(req.url).searchParams.get('id')
    if (!UUID_PATTERN.test(id || '')) return jsonResponse({ error: 'A valid id is required' }, 400)

    const response = await fetch(`${tableUrl}?id=eq.${id}&user_id=is.null`, {
      method: 'DELETE',
      headers: supabaseHeaders(),
      cache: 'no-store',
    })
    const data = await readResponse(response, [])
    if (!response.ok) return jsonResponse({ error: data?.message || 'Delete failed' }, response.status)
    if (!Array.isArray(data) || data.length === 0) return jsonResponse({ error: 'System scenario not found' }, 404)
    return jsonResponse({ ok: true, data: data[0] })
  } catch (error) {
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500)
  }
}
