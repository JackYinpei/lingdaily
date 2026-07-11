import 'server-only'
import { randomUUID } from 'node:crypto'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const schema = process.env.SUPABASE_SCHEMA || 'public'

export class PodcastLeaseLostError extends Error {
  constructor(date) {
    super(`Podcast ${date} generation lease is no longer active`)
    this.name = 'PodcastLeaseLostError'
    this.code = 'PODCAST_LEASE_LOST'
  }
}

function requireConfig() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Podcast storage requires Supabase URL and service role key')
  }
}

function headers(prefer) {
  return {
    'Content-Type': 'application/json',
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Profile': schema,
    'Accept-Profile': schema,
    Accept: 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  }
}

async function parseResponse(response, fallback) {
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : fallback } catch { data = fallback }
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || `Supabase request failed (${response.status})`)
  }
  return data
}

export function toPodcastEpisode(row) {
  if (!row) return null
  return {
    id: row.date_folder,
    date: row.date_folder,
    title: row.title,
    summary: row.summary,
    script: row.script,
    content: row.content,
    status: row.status,
    pubDate: row.created_at,
    updatedAt: row.updated_at,
    filename: `${row.date_folder}.mp3`,
    size: Number(row.audio_bytes || 0),
    duration: Number(row.audio_duration_seconds || 0),
    enclosureUrl: row.audio_url,
    audioUrl: row.audio_url,
  }
}

export async function claimPodcastGeneration(date, force = false) {
  requireConfig()
  const generationId = randomUUID()
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_podcast_generation`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      p_date_folder: date,
      p_force: force,
      p_generation_id: generationId,
    }),
    cache: 'no-store',
  })
  const data = await parseResponse(response, [])
  const row = Array.isArray(data) ? data[0] : data
  if (row) return { claimed: true, generationId, episode: toPodcastEpisode(row) }
  return { claimed: false, episode: await getPodcastEpisode(date, { includeIncomplete: true }) }
}

export async function updatePodcastEpisode(date, generationId, fields) {
  requireConfig()
  if (!generationId) throw new Error('Podcast generation lease is required for updates')
  const response = await fetch(
    `${supabaseUrl}/rest/v1/podcasts?date_folder=eq.${encodeURIComponent(date)}&category=eq.daily&generation_id=eq.${encodeURIComponent(generationId)}`,
    {
      method: 'PATCH',
      headers: headers('return=representation'),
      body: JSON.stringify(fields),
      cache: 'no-store',
    },
  )
  const data = await parseResponse(response, [])
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new PodcastLeaseLostError(date)
  return toPodcastEpisode(row)
}

export async function getPodcastEpisode(date, { includeIncomplete = false } = {}) {
  requireConfig()
  const params = new URLSearchParams({
    date_folder: `eq.${date}`,
    category: 'eq.daily',
    select: '*',
    limit: '1',
  })
  if (!includeIncomplete) params.set('status', 'eq.completed')
  const response = await fetch(`${supabaseUrl}/rest/v1/podcasts?${params}`, {
    headers: headers(),
    cache: 'no-store',
  })
  const data = await parseResponse(response, [])
  return toPodcastEpisode(Array.isArray(data) ? data[0] : null)
}

export async function listPodcastEpisodes({ limit = 50 } = {}) {
  requireConfig()
  const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 50, 1), 1000)
  const params = new URLSearchParams({
    status: 'eq.completed',
    category: 'eq.daily',
    select: '*',
    order: 'date_folder.desc',
    limit: String(safeLimit),
  })
  const response = await fetch(`${supabaseUrl}/rest/v1/podcasts?${params}`, {
    headers: headers(),
    cache: 'no-store',
  })
  const data = await parseResponse(response, [])
  return Array.isArray(data) ? data.map(toPodcastEpisode) : []
}
