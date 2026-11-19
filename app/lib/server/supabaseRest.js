import {
  getSupabaseAnonKey,
  getSupabaseSchema,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from '../supabaseEnv'

// Which key a PostgREST request may authenticate with when no service-role key
// is configured. Each route picks the mode that matches its authorization model.
export const SUPABASE_CREDENTIALS = Object.freeze({
  SERVICE_ROLE: 'serviceRole',
  SERVICE_ROLE_OR_SESSION: 'serviceRoleOrSession',
  SERVICE_ROLE_OR_SESSION_OR_ANON: 'serviceRoleOrSessionOrAnon',
})

function resolveKeys(credentials, session) {
  const serviceRoleKey = getSupabaseServiceRoleKey()
  const anonKey = getSupabaseAnonKey()
  switch (credentials) {
    case SUPABASE_CREDENTIALS.SERVICE_ROLE:
      return { apiKey: serviceRoleKey, bearer: serviceRoleKey }
    case SUPABASE_CREDENTIALS.SERVICE_ROLE_OR_SESSION:
      return {
        apiKey: serviceRoleKey || anonKey,
        bearer: serviceRoleKey || session?.supabaseAccessToken,
      }
    case SUPABASE_CREDENTIALS.SERVICE_ROLE_OR_SESSION_OR_ANON:
      return {
        apiKey: serviceRoleKey || anonKey,
        bearer: serviceRoleKey || session?.supabaseAccessToken || anonKey,
      }
    default:
      throw new Error(`Unknown Supabase credentials mode: ${credentials}`)
  }
}

/** PostgREST connection settings, or null when the mode cannot be satisfied. */
export function getSupabaseRestConfig({ credentials, session } = {}) {
  const url = getSupabaseUrl()
  const { apiKey, bearer } = resolveKeys(credentials, session)
  if (!url || !apiKey || !bearer) return null
  return {
    baseUrl: url.replace(/\/$/, ''),
    apiKey,
    bearer,
    schema: getSupabaseSchema(),
  }
}

export async function supabaseRestRequest(
  config,
  resource,
  { method = 'GET', params, body, prefer, headers: extraHeaders, signal } = {},
) {
  const url = new URL(`${config.baseUrl}/rest/v1/${resource}`)
  if (params) {
    for (const [key, value] of params.entries()) url.searchParams.append(key, value)
  }

  const headers = {
    apikey: config.apiKey,
    Authorization: `Bearer ${config.bearer}`,
    Accept: 'application/json',
    'Cache-Control': 'no-cache',
    'Accept-Profile': config.schema,
    ...extraHeaders,
  }
  // PostgREST selects the schema of every mutation, bodyless DELETE included,
  // from Content-Profile.
  if (method !== 'GET' && method !== 'HEAD') headers['Content-Profile'] = config.schema
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  return { ok: response.ok, status: response.status, data, text }
}

/** Supabase Auth Admin API settings (service role only), or null. */
export function getSupabaseAdminConfig() {
  const baseUrl = getSupabaseUrl()
  const serviceRoleKey = getSupabaseServiceRoleKey()
  if (!baseUrl || !serviceRoleKey) return null
  return {
    baseUrl,
    headers: (extra) => ({ apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, ...extra }),
  }
}

/** Public Supabase Auth settings (anon key), or null. */
export function getSupabasePublicAuthConfig() {
  const baseUrl = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  if (!baseUrl || !anonKey) return null
  return {
    baseUrl,
    headers: (extra) => ({ apikey: anonKey, Authorization: `Bearer ${anonKey}`, ...extra }),
  }
}
