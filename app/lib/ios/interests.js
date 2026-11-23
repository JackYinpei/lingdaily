import { z } from 'zod'

// What the learner picked on the app's first-run page: why they learn English and which
// speaking moments they find hard. Kept on the device; the app sends the ids to
// scenario-ideas and matches them against the catalog's tags to order the home page.
// The Chinese labels live in the apps; these English notes are only for the model.
// Keep ids in sync with ios/.../LearnerInterests.swift and android/.../LearnerInterests.kt.
export const LEARNING_GOALS = Object.freeze({
  travel: 'travelling abroad: hotels, airports, restaurants, shops, asking for help',
  campus: 'studying abroad: classmates, teachers, group work, campus services',
  work: 'English at work: colleagues, meetings, disagreeing, pushing back, deadlines',
  interview: 'job interviews and career conversations',
  social: 'making friends and small talk: neighbours, parties, hobbies, weekend plans',
  living: 'daily life abroad: landlords, deliveries, pharmacies, repairs, bills',
})

export const SPEAKING_FEARS = Object.freeze({
  fast: 'people who talk fast or casually and are hard to follow',
  pushback: 'being pushed back on, blamed or treated unfairly and not knowing how to answer',
  smalltalk: 'awkward silences: keeping a casual chat going',
  asking: 'saying no, complaining or asking for something without feeling rude',
})

export const INTEREST_IDS = Object.freeze([...Object.keys(LEARNING_GOALS), ...Object.keys(SPEAKING_FEARS)])
export const interestIdSchema = z.enum(INTEREST_IDS)
// Unknown ids from a newer app are dropped instead of failing the request.
export const interestsSchema = z.array(z.string().trim().max(20)).max(12)
  .transform(ids => [...new Set(ids)].filter(id => INTEREST_IDS.includes(id)))
  .optional()

/** The learner's picks as English notes for a prompt, or null when there are none. */
export function interestNotes(ids = []) {
  const goals = ids.filter(id => LEARNING_GOALS[id]).map(id => LEARNING_GOALS[id])
  const fears = ids.filter(id => SPEAKING_FEARS[id]).map(id => SPEAKING_FEARS[id])
  if (!goals.length && !fears.length) return null
  return {
    ...(goals.length ? { learnerGoals: goals } : {}),
    ...(fears.length ? { learnerHardMoments: fears } : {}),
  }
}
