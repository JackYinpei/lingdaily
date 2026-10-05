import { z } from 'zod'

// Models a signed-in learner may pick in the app, per feature. The client can
// only choose from this list; anything else silently falls back to the server
// default, so a crafted request can never reach an unlisted (costlier) model.
// Each entry was verified with this project's real prompts on 2026-10-05.
export const MODEL_FEATURES = Object.freeze(['practice', 'suggest', 'translate', 'live'])

const TEXT_CHOICES = Object.freeze([
  { id: 'gemini-3.1-flash-lite', note: '稳定、便宜' },
  { id: 'gemini-3.5-flash-lite', note: '实测更快，同样便宜' },
  { id: 'gemini-3.8-flash', note: '更强；高峰期常繁忙，思考也计费' },
])

export const MODEL_CHOICES = Object.freeze({
  practice: TEXT_CHOICES,
  suggest: TEXT_CHOICES,
  translate: TEXT_CHOICES,
  live: Object.freeze([
    { id: 'gemini-3.1-flash-live-preview', note: '当前实时语音模型' },
    { id: 'gemini-3.8-live', note: '较新的实时语音模型' },
    { id: 'gemini-2.5-flash-native-audio-latest', note: '上一代原生音频模型' },
  ]),
})

export const requestedModelSchema = z.string().trim().max(100).optional()

/** The requested model when it is on the feature's list (or is the server default), else the default. */
export function resolveModel(feature, requested, serverDefault) {
  if (!requested || requested === serverDefault) return serverDefault
  return MODEL_CHOICES[feature]?.some(choice => choice.id === requested) ? requested : serverDefault
}

/** Per-feature default and choices for the app's model picker. */
export function modelCatalog(defaults) {
  return Object.fromEntries(MODEL_FEATURES.map(feature => {
    const listed = MODEL_CHOICES[feature]
    const choices = listed.some(choice => choice.id === defaults[feature])
      ? listed : [{ id: defaults[feature], note: '服务端默认' }, ...listed]
    return [feature, { default: defaults[feature], choices }]
  }))
}
