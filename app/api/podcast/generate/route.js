import path from 'node:path'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fetchPodcastNews } from '@/app/lib/podcast/news'
import { generatePodcastScript } from '@/app/lib/podcast/script'
import { synthesizePodcast } from '@/app/lib/podcast/tts'
import { uploadPodcastToCos } from '@/app/lib/podcast/storage'
import {
  buildEpisodeEnclosureUrl,
  loadManifest,
  saveManifest,
  upsertEpisode,
  writeFeed,
} from '@/app/lib/podcast/feed'
import {
  claimPodcastGeneration,
  updatePodcastEpisode,
} from '@/app/lib/podcast/repository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PODCAST_DIR = path.join(process.cwd(), 'public', 'podcasts')
const MANIFEST_PATH = path.join(PODCAST_DIR, 'manifest.json')
const FEED_PATH = path.join(PODCAST_DIR, 'feed.xml')
let inFlight = false

function jsonResponse(body, status = 200) {
  return Response.json(body, { status })
}

function renderScriptTxt(id, script) {
  const lines = [
    `成杨英语日刊 ${id}`,
    script.episode_title,
    '',
    script.episode_summary,
    '',
    '─'.repeat(60),
  ]
  for (const chunk of script.chunks) {
    lines.push('', `[ ${chunk.name.toUpperCase()} ]`, '')
    for (const turn of chunk.turns) lines.push(`${turn.speaker}: ${turn.text}`, '')
  }
  return lines.join('\n')
}

function checkSecret(req) {
  const expected = process.env.PODCAST_SECRET
  if (!expected) return { ok: false, reason: 'PODCAST_SECRET not configured' }
  const provided = req.headers.get('x-podcast-secret')
  if (!provided || provided !== expected) return { ok: false, reason: 'Invalid secret' }
  return { ok: true }
}

function todayId() {
  const timeZone = process.env.PODCAST_TIMEZONE || 'Asia/Shanghai'
  const toDateId = (zone) => {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  }
  try {
    return toDateId(timeZone)
  } catch (error) {
    console.warn(`[podcast/generate] Invalid PODCAST_TIMEZONE "${timeZone}", using UTC.`, error)
    return toDateId('UTC')
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function localEpisode(id, overrides = {}) {
  const filename = `${id}.mp3`
  const audioUrl = overrides.audioUrl || buildEpisodeEnclosureUrl(filename)
  return {
    id,
    date: id,
    title: overrides.title || `成杨英语日刊 ${id}`,
    summary: overrides.summary || null,
    script: overrides.script || null,
    content: overrides.content || null,
    status: 'completed',
    pubDate: overrides.pubDate || new Date().toISOString(),
    filename,
    size: overrides.size || 0,
    duration: overrides.duration || 0,
    enclosureUrl: audioUrl,
    audioUrl,
  }
}

// The production cron treats any literal `"error"` string in the response as
// a failed attempt. Keep successful responses free of generated prose so a
// vocabulary item or quotation cannot accidentally trigger that legacy check.
function cronSafeEpisode(episode) {
  if (!episode) return null
  return {
    id: episode.id,
    date: episode.date,
    status: episode.status,
    filename: episode.filename,
    size: episode.size,
    duration: episode.duration,
    enclosureUrl: episode.enclosureUrl,
    audioUrl: episode.audioUrl,
  }
}

function legacyManifestEpisode(episode) {
  return {
    id: episode.id,
    title: episode.title,
    summary: episode.summary,
    pubDate: episode.pubDate,
    filename: episode.filename,
    size: episode.size,
    duration: episode.duration,
    enclosureUrl: episode.enclosureUrl,
  }
}

export async function POST(req) {
  const secret = checkSecret(req)
  if (!secret.ok) return jsonResponse({ error: secret.reason }, 401)
  if (inFlight) return jsonResponse({ error: 'A podcast generation is already in progress on this instance' }, 429)

  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date')?.trim()
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return jsonResponse({ error: 'date must use YYYY-MM-DD' }, 400)
  }

  const id = dateParam || todayId()
  const force = searchParams.get('force') === 'true'
  const suffix = `${process.pid}-${Date.now()}`
  const mp3Filename = `${id}.mp3`
  const finalMp3Path = path.join(PODCAST_DIR, mp3Filename)
  const tempMp3Path = path.join(PODCAST_DIR, `.${id}-${suffix}.mp3`)
  const finalTxtPath = path.join(PODCAST_DIR, `${id}.txt`)
  const tempTxtPath = path.join(PODCAST_DIR, `.${id}-${suffix}.txt`)
  const tempManifestPath = path.join(PODCAST_DIR, `.manifest-${suffix}.json`)
  const tempFeedPath = path.join(PODCAST_DIR, `.feed-${suffix}.xml`)
  const workDir = path.join(PODCAST_DIR, `.work-${id}-${suffix}`)
  let databaseTracking = false
  let databaseCompleted = false
  let generationId = null

  const updateTrackedEpisode = async (fields) => {
    if (!databaseTracking) return null
    return updatePodcastEpisode(id, generationId, fields)
  }

  const publishLegacyArtifacts = async (episode) => {
    const manifest = await loadManifest(MANIFEST_PATH)
    const updated = await upsertEpisode(manifest, legacyManifestEpisode(episode))
    await saveManifest(tempManifestPath, updated)
    await writeFeed(tempFeedPath, updated)
    await rename(tempManifestPath, MANIFEST_PATH)
    await rename(tempFeedPath, FEED_PATH)
  }

  const publishLocalFiles = async ({ required }) => {
    const results = await Promise.allSettled([
      rename(tempTxtPath, finalTxtPath),
      rename(tempMp3Path, finalMp3Path),
    ])
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length === 0) return
    if (required) throw failures[0].reason
    console.warn(
      `[podcast/generate] Episode ${id} is published in COS/database, but local mirror update failed.`,
      failures.map((failure) => failure.reason),
    )
  }

  inFlight = true
  try {
    await mkdir(PODCAST_DIR, { recursive: true })

    let claim = null
    try {
      claim = await claimPodcastGeneration(id, force)
    } catch (error) {
      console.warn(
        `[podcast/generate] Podcast database is unavailable for ${id}; continuing in cron compatibility mode.`,
        error,
      )
    }

    if (claim && !claim.claimed) {
      if (claim.episode?.status === 'completed') {
        return jsonResponse({
          ok: true,
          skipped: true,
          episode: cronSafeEpisode(claim.episode),
        })
      }
      return jsonResponse({
        error: `Episode ${id} is already being generated`,
        status: claim.episode?.status || 'in_progress',
      }, 409)
    }

    if (claim?.claimed) {
      databaseTracking = true
      generationId = claim.generationId
    } else if (!force && await fileExists(finalMp3Path)) {
      return jsonResponse({
        ok: true,
        skipped: true,
        compatibilityMode: true,
        episode: cronSafeEpisode(localEpisode(id)),
      })
    }

    const news = await fetchPodcastNews()
    const script = await generatePodcastScript(news)
    const scriptText = renderScriptTxt(id, script)

    await updateTrackedEpisode({
      status: 'script_generated',
      title: script.episode_title,
      summary: script.episode_summary,
      script: scriptText,
      content: script,
      error_message: null,
    })

    await writeFile(tempTxtPath, scriptText, 'utf8')

    const { size, duration, mp3Buffer } = await synthesizePodcast(script, {
      outputMp3Path: tempMp3Path,
      workDir,
    })
    const audioBody = mp3Buffer || await readFile(tempMp3Path)
    const storageFilename = databaseTracking
      ? `${id}-${generationId}.mp3`
      : mp3Filename
    const audioUrl = await uploadPodcastToCos({
      filename: storageFilename,
      contentType: 'audio/mpeg',
      body: audioBody,
    })

    const fallbackEpisode = localEpisode(id, {
      title: script.episode_title,
      summary: script.episode_summary,
      script: scriptText,
      content: script,
      size,
      duration,
      audioUrl,
    })
    let episode = fallbackEpisode

    if (databaseTracking) {
      episode = await updateTrackedEpisode({
        status: 'completed',
        audio_url: audioUrl,
        audio_bytes: size,
        audio_duration_seconds: duration,
        error_message: null,
      })
      databaseCompleted = true

      try {
        await publishLegacyArtifacts(fallbackEpisode)
      } catch (legacyError) {
        console.warn('[podcast/generate] Failed to update legacy podcast feed mirror:', legacyError)
      }
      await publishLocalFiles({ required: false })
    } else {
      // Without the database, the manifest/feed and local files remain the
      // canonical idempotency path used by the existing server deployment.
      await publishLegacyArtifacts(fallbackEpisode)
      await publishLocalFiles({ required: true })
    }

    return jsonResponse({
      ok: true,
      compatibilityMode: !databaseTracking,
      episode: cronSafeEpisode(episode),
    })
  } catch (error) {
    console.error('[podcast/generate] Error:', error)
    if (databaseTracking && !databaseCompleted) {
      try {
        await updatePodcastEpisode(id, generationId, {
          status: 'failed',
          error_message: String(error?.message || 'Unexpected error').slice(0, 2000),
        })
      } catch (statusError) {
        console.error('[podcast/generate] Failed to record failure state:', statusError)
      }
    }
    return jsonResponse({ error: error?.message || 'Unexpected error' }, 500)
  } finally {
    inFlight = false
    await Promise.allSettled([
      rm(tempMp3Path, { force: true }),
      rm(tempTxtPath, { force: true }),
      rm(tempManifestPath, { force: true }),
      rm(tempFeedPath, { force: true }),
      rm(workDir, { recursive: true, force: true }),
    ])
  }
}
