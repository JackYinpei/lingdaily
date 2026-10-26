import 'server-only'

import { listPodcastEpisodes } from '../podcast/repository'
import { normalizePodcastShownotes } from '../podcast/shownotes'
import { generateNewsScenario } from './iosPractice'

// 「今日」 on the app's home page: the latest completed daily podcast and one
// rehearsal about it. The rehearsal is generated once per episode and shared by
// every learner; it only uses facts the episode states (see NEWS_SCENARIO_INSTRUCTION).
const EPISODE_TTL_MS = 5 * 60_000
const RETRY_AFTER_FAILURE_MS = 10 * 60_000
const MAX_EPISODE_AGE_DAYS = 7
const GENERATION_WAIT_MS = 12_000

export function todayDTO(episode, scenario = null) {
  const notes = normalizePodcastShownotes(episode)
  const audioURL = typeof episode.audioUrl === 'string' && episode.audioUrl.startsWith('https://') ? episode.audioUrl : null
  return {
    date: episode.date, title: episode.title || 'LingDaily 每日播客',
    summary: notes.summaryZh.slice(0, 600), audioURL,
    duration: Number.isFinite(episode.duration) && episode.duration > 0 ? Math.round(episode.duration) : null,
    vocabulary: notes.vocabulary.slice(0, 8).map(item => ({
      term: item.term.slice(0, 80), meaning: item.meaningZh.slice(0, 120), example: item.exampleEn.slice(0, 300),
    })).filter(item => item.meaning),
    scenario,
  }
}

const isRecent = (date, now) => {
  const day = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(day) && now - day <= (MAX_EPISODE_AGE_DAYS + 1) * 86_400_000
}

export function createTodayService({ loadLatest = async () => (await listPodcastEpisodes({ limit: 1 }))[0] || null,
  generate = generateNewsScenario, now = Date.now, wait = GENERATION_WAIT_MS } = {}) {
  let latest = null // { at, episode }
  const rehearsals = new Map() // episode date -> { promise, scenario, failedAt }

  function rehearsal(episode, userId) {
    let entry = rehearsals.get(episode.date)
    if (entry?.failedAt && now() - entry.failedAt < RETRY_AFTER_FAILURE_MS) return entry
    if (!entry || entry.failedAt) {
      rehearsals.clear() // Only the current episode is ever needed.
      entry = { scenario: null, failedAt: null }
      entry.promise = generate(episode, userId)
        .then(result => { entry.scenario = result.scenario; return entry.scenario })
        .catch(error => {
          console.error('[ios-today] rehearsal generation failed', error?.code || error?.name)
          entry.failedAt = now()
          return null
        })
      rehearsals.set(episode.date, entry)
    }
    return entry
  }

  return async userId => {
    if (!latest || now() - latest.at > EPISODE_TTL_MS) {
      try { latest = { at: now(), episode: await loadLatest() } } catch (error) {
        console.error('[ios-today] podcast unavailable', error?.name)
        return { today: null }
      }
    }
    const episode = latest.episode
    if (!episode?.date || !isRecent(episode.date, now())) return { today: null }
    const entry = rehearsal(episode, userId)
    // A slow first generation of the day must not hold up the podcast card.
    let timer
    const scenario = entry.scenario || await Promise.race([
      entry.promise, new Promise(resolve => { timer = setTimeout(resolve, wait, null) }),
    ])
    clearTimeout(timer)
    return { today: todayDTO(episode, scenario) }
  }
}

const stateKey = Symbol.for('lingdaily.iosToday.v1')
export function performTodayRequest(userId) {
  globalThis[stateKey] ||= createTodayService()
  return globalThis[stateKey](userId)
}
