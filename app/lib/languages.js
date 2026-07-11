export const LANGUAGE_CATALOG = Object.freeze([
  Object.freeze({ code: 'zh-CN', label: '中文', englishName: 'Simplified Chinese' }),
  Object.freeze({ code: 'en', label: 'English', englishName: 'English' }),
  Object.freeze({ code: 'ja', label: '日本語', englishName: 'Japanese' }),
  Object.freeze({ code: 'es', label: 'Español', englishName: 'Spanish' }),
  Object.freeze({ code: 'fr', label: 'Français', englishName: 'French' }),
  Object.freeze({ code: 'de', label: 'Deutsch', englishName: 'German' }),
  Object.freeze({ code: 'ko', label: '한국어', englishName: 'Korean' }),
  Object.freeze({ code: 'pt', label: 'Português', englishName: 'Portuguese' }),
  Object.freeze({ code: 'it', label: 'Italiano', englishName: 'Italian' }),
])

export const DEFAULT_LEARNING_LANGUAGE = LANGUAGE_CATALOG.find((item) => item.code === 'en')
export const DEFAULT_NATIVE_LANGUAGE = LANGUAGE_CATALOG.find((item) => item.code === 'zh-CN')
export const LEARNING_LANGUAGE_OPTIONS = Object.freeze(
  LANGUAGE_CATALOG.filter((item) => item.code !== 'zh-CN'),
)
export const NATIVE_LANGUAGE_OPTIONS = LANGUAGE_CATALOG

const LANGUAGE_BY_CODE = new Map(LANGUAGE_CATALOG.map((item) => [item.code, item]))

export function normalizeLanguageCode(value) {
  const raw = String(value || '').trim()
  const lower = raw.toLowerCase()
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN'
  return lower.split('-')[0]
}

export function getLanguage(value, { allowChinese = true } = {}) {
  const language = LANGUAGE_BY_CODE.get(normalizeLanguageCode(value)) || null
  if (!allowChinese && language?.code === 'zh-CN') return null
  return language
}

export function getLanguageFromPreference(value, options) {
  return getLanguage(typeof value === 'string' ? value : value?.code, options)
}

export function getLanguageOrDefault(value, fallback, options) {
  return getLanguageFromPreference(value, options) || fallback
}

export function areLanguagesDistinct(learningValue, nativeValue) {
  const learning = getLanguageFromPreference(learningValue, { allowChinese: false })
  const native = getLanguageFromPreference(nativeValue)
  return Boolean(learning && native && learning.code !== native.code)
}

export function resolveDistinctLanguagePair(learningValue, nativeValue) {
  const nativeLanguage = getLanguageFromPreference(nativeValue) || DEFAULT_NATIVE_LANGUAGE
  let learningLanguage = getLanguageFromPreference(
    learningValue,
    { allowChinese: false },
  ) || DEFAULT_LEARNING_LANGUAGE

  if (learningLanguage.code === nativeLanguage.code) {
    learningLanguage = LEARNING_LANGUAGE_OPTIONS.find(
      (language) => language.code !== nativeLanguage.code,
    ) || DEFAULT_LEARNING_LANGUAGE
  }

  return { learningLanguage, nativeLanguage }
}
