import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { normalizePodcastScript, validatePodcastScript } from './script.js'

const SCHEMA_VERSION = 1
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/

function checkpointError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function contains(parent, target) {
  const relative = path.relative(parent, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function privateDirectory(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const info = await lstat(dir)
  if (!info.isDirectory() || info.isSymbolicLink()) throw checkpointError('UNSAFE_CACHE_DIRECTORY')
  await chmod(dir, 0o700)
  return dir
}

// Whitelist the script schema; never persist request bodies, headers or provider
// client objects accidentally attached by a caller. Validate before normalizing:
// normalization assumes shownotes exists and is not a schema validator.
export function canonicalPodcastScript(script) {
  validatePodcastScript(script)
  const normalized = normalizePodcastScript(script)
  const clean = {
    episode_title: normalized.episode_title,
    shownotes: {
      summary_zh: normalized.shownotes.summary_zh,
      summary_en: normalized.shownotes.summary_en,
      vocabulary: normalized.shownotes.vocabulary.map(({ term, meaning_zh, definition_en, example_en }) => ({ term, meaning_zh, definition_en, example_en })),
    },
    chunks: normalized.chunks.map(({ name, turns }) => ({ name, turns: turns.map(({ speaker, text }) => ({ speaker, text })) })),
    episode_summary: normalized.episode_summary,
  }
  validatePodcastScript(clean)
  return clean
}

export function scriptFingerprint(script) {
  return createHash('sha256').update(JSON.stringify(script)).digest('hex')
}

async function atomicJson(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(data)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, file)
  } finally {
    await handle?.close()
    await rm(temporary, { force: true })
  }
}

export async function openPodcastCheckpoint(date) {
  if (!DATE_PATTERN.test(date)) throw checkpointError('INVALID_CHECKPOINT_DATE')
  const root = path.resolve(process.env.PODCAST_CACHE_DIR?.trim() || path.join(process.cwd(), '.podcast-cache'))
  const publicDir = path.resolve(process.cwd(), 'public')
  // Reject public descendants and ancestors (e.g. cwd) before chmod/mkdir.
  if (contains(publicDir, root) || contains(root, publicDir)) throw checkpointError('PUBLIC_CACHE_DIRECTORY')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const resolvedRoot = await realpath(root)
  const resolvedPublic = await realpath(publicDir).catch((error) => {
    if (error.code === 'ENOENT') return publicDir
    throw error
  })
  if (contains(resolvedPublic, resolvedRoot) || contains(resolvedRoot, resolvedPublic)) throw checkpointError('PUBLIC_CACHE_DIRECTORY')
  await privateDirectory(root)
  const dateDir = await privateDirectory(path.join(root, date))
  return { date, dateDir }
}

export async function loadPodcastScriptCheckpoint(checkpoint) {
  const file = path.join(checkpoint.dateDir, 'script.json')
  let raw
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000) throw checkpointError('INVALID_CHECKPOINT_FILE')
    await chmod(file, 0o600)
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    if (error.code === 'INVALID_CHECKPOINT_FILE') {
      console.warn('[podcast/checkpoint] Rejected saved script:', error.code)
      return null
    }
    throw checkpointError('CHECKPOINT_READ_FAILED')
  }
  try {
    const saved = JSON.parse(raw)
    if (saved.schemaVersion !== SCHEMA_VERSION || saved.date !== checkpoint.date || !HASH_PATTERN.test(saved.scriptFingerprint)) {
      throw checkpointError('CHECKPOINT_SCHEMA_MISMATCH')
    }
    if (scriptFingerprint(saved.script) !== saved.scriptFingerprint) throw checkpointError('CHECKPOINT_CHECKSUM_MISMATCH')
    const script = canonicalPodcastScript(saved.script)
    if (scriptFingerprint(script) !== saved.scriptFingerprint) throw checkpointError('CHECKPOINT_SCRIPT_MISMATCH')
    return { script, scriptFingerprint: saved.scriptFingerprint }
  } catch (error) {
    // Do not log JSON/model text or validator messages containing script prose.
    const safeCode = ['CHECKPOINT_SCHEMA_MISMATCH', 'CHECKPOINT_CHECKSUM_MISMATCH', 'CHECKPOINT_SCRIPT_MISMATCH'].includes(error.code)
      ? error.code : 'INVALID_SCRIPT_CHECKPOINT'
    console.warn('[podcast/checkpoint] Rejected saved script:', safeCode)
    return null
  }
}

export async function savePodcastScriptCheckpoint(checkpoint, input) {
  const script = canonicalPodcastScript(input)
  const fingerprint = scriptFingerprint(script)
  const workDir = await podcastTtsCacheDirectory(checkpoint, fingerprint)
  const saved = {
    schemaVersion: SCHEMA_VERSION, date: checkpoint.date,
    scriptFingerprint: fingerprint, savedAt: new Date().toISOString(), script,
  }
  // Archive by content fingerprint before switching the same-date pointer. Force
  // regeneration leaves earlier drafts/audio available for tracing and recovery.
  await atomicJson(path.join(workDir, 'script.json'), saved)
  await atomicJson(path.join(checkpoint.dateDir, 'script.json'), saved)
  return { script, scriptFingerprint: fingerprint }
}

export async function podcastTtsCacheDirectory(checkpoint, fingerprint) {
  if (!HASH_PATTERN.test(fingerprint)) throw checkpointError('INVALID_SCRIPT_FINGERPRINT')
  return privateDirectory(path.join(checkpoint.dateDir, fingerprint))
}

// TTS returns operational metadata, not the full SDK response. Defense in depth:
// omit credential/request payload fields if a future provider includes them.
function privateMetadata(value, depth = 0) {
  if (depth > 12 || value === undefined) return null
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) return value.map((item) => privateMetadata(item, depth + 1))
  if (typeof value !== 'object') return null
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => key === 'requestedModel'
      ? typeof item === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(item)
      : !/(?:secret|token|api.?key|authorization|cookie|headers?|request|response|body|prompt|credentials?)/i.test(key))
    .map(([key, item]) => [key, privateMetadata(item, depth + 1)]))
}

export async function savePodcastTtsCheckpoint(checkpoint, fingerprint, { model, metadata, size, duration }) {
  const workDir = await podcastTtsCacheDirectory(checkpoint, fingerprint)
  await atomicJson(path.join(workDir, 'tts.json'), {
    schemaVersion: SCHEMA_VERSION, date: checkpoint.date, scriptFingerprint: fingerprint,
    savedAt: new Date().toISOString(), model: typeof model === 'string' ? model : null,
    metadata: privateMetadata(metadata), size, duration,
  })
}
