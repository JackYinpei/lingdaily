import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getSupabaseAdminConfig,
  getSupabasePublicAuthConfig,
  getSupabaseRestConfig,
  SUPABASE_CREDENTIALS,
  supabaseRestRequest,
} from '@/app/lib/server/supabaseRest'

const require = createRequire(import.meta.url)
const supabaseEnv = require('../../app/lib/supabaseEnv.js')

function stubSupabaseEnv(values) {
  for (const name of [
    'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SCHEMA',
  ]) vi.stubEnv(name, values[name] ?? '')
}

beforeEach(() => stubSupabaseEnv({}))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('supabaseEnv (CommonJS, shared with next-sitemap)', () => {
  it('prefers NEXT_PUBLIC_* names over the plain aliases', () => {
    stubSupabaseEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://public.test', SUPABASE_URL: 'https://server.test',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon', SUPABASE_ANON_KEY: 'server-anon',
    })
    expect(supabaseEnv.getSupabaseUrl()).toBe('https://public.test')
    expect(supabaseEnv.getSupabaseAnonKey()).toBe('public-anon')
  })

  it('falls back to the plain aliases and the public schema', () => {
    stubSupabaseEnv({ SUPABASE_URL: 'https://server.test', SUPABASE_ANON_KEY: 'server-anon' })
    expect(supabaseEnv.getSupabaseUrl()).toBe('https://server.test')
    expect(supabaseEnv.getSupabaseAnonKey()).toBe('server-anon')
    expect(supabaseEnv.getSupabaseSchema()).toBe('public')
  })
})

describe('getSupabaseRestConfig credential modes', () => {
  const session = { supabaseAccessToken: 'user-token' }
  const config = (credentials, withSession) => getSupabaseRestConfig({ credentials, session: withSession ? session : undefined })

  it('always uses the service-role key when it is configured', () => {
    stubSupabaseEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://db.test/', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_SCHEMA: 'app',
    })
    for (const mode of Object.values(SUPABASE_CREDENTIALS)) {
      expect(config(mode, true)).toEqual({ baseUrl: 'https://db.test', apiKey: 'service', bearer: 'service', schema: 'app' })
    }
  })

  it('applies each mode fallback without a service-role key', () => {
    stubSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://db.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' })
    expect(config(SUPABASE_CREDENTIALS.SERVICE_ROLE, true)).toBeNull()
    expect(config(SUPABASE_CREDENTIALS.SERVICE_ROLE_OR_SESSION, false)).toBeNull()
    expect(config(SUPABASE_CREDENTIALS.SERVICE_ROLE_OR_SESSION, true)).toMatchObject({ apiKey: 'anon', bearer: 'user-token' })
    expect(config(SUPABASE_CREDENTIALS.SERVICE_ROLE_OR_SESSION_OR_ANON, true)).toMatchObject({ apiKey: 'anon', bearer: 'user-token' })
    expect(config(SUPABASE_CREDENTIALS.SERVICE_ROLE_OR_SESSION_OR_ANON, false)).toMatchObject({ apiKey: 'anon', bearer: 'anon' })
  })

  it('requires a URL and rejects unknown modes', () => {
    stubSupabaseEnv({ SUPABASE_SERVICE_ROLE_KEY: 'service' })
    expect(config(SUPABASE_CREDENTIALS.SERVICE_ROLE)).toBeNull()
    expect(() => getSupabaseRestConfig({ credentials: 'anything' })).toThrow(/Unknown Supabase credentials mode/)
  })
})

describe('supabaseRestRequest', () => {
  const config = { baseUrl: 'https://db.test', apiKey: 'key', bearer: 'bearer', schema: 'app' }

  it('sends read headers and parses JSON', async () => {
    const fetch = vi.fn(async () => new Response('[{"id":1}]', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const result = await supabaseRestRequest(config, 'scenarios', { params: new URLSearchParams({ id: 'eq.1' }) })
    expect(result).toEqual({ ok: true, status: 200, data: [{ id: 1 }], text: '[{"id":1}]' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://db.test/rest/v1/scenarios?id=eq.1')
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', body: undefined })
    expect(init.headers).toEqual({
      apikey: 'key', Authorization: 'Bearer bearer', Accept: 'application/json',
      'Cache-Control': 'no-cache', 'Accept-Profile': 'app',
    })
  })

  it('sends the schema profile on every mutation and JSON content type with a body', async () => {
    const fetch = vi.fn(async () => new Response('not json', { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    const write = await supabaseRestRequest(config, 'scenarios', { method: 'POST', body: { a: 1 }, prefer: 'return=representation' })
    expect(write).toMatchObject({ ok: false, status: 400, data: null, text: 'not json' })
    expect(fetch.mock.calls[0][1].body).toBe('{"a":1}')
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      'Content-Profile': 'app', 'Content-Type': 'application/json', Prefer: 'return=representation',
    })

    await supabaseRestRequest(config, 'scenarios', { method: 'DELETE' })
    expect(fetch.mock.calls[1][1].headers['Content-Profile']).toBe('app')
    expect(fetch.mock.calls[1][1].headers['Content-Type']).toBeUndefined()
  })
})

describe('Supabase Auth configs', () => {
  it('builds service-role admin and anon public headers from the shared env', () => {
    expect(getSupabaseAdminConfig()).toBeNull()
    expect(getSupabasePublicAuthConfig()).toBeNull()
    stubSupabaseEnv({ SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })
    const admin = getSupabaseAdminConfig()
    expect(admin.baseUrl).toBe('https://db.test')
    expect(admin.headers({ 'Content-Type': 'application/json' })).toEqual({
      apikey: 'service', Authorization: 'Bearer service', 'Content-Type': 'application/json',
    })
    expect(getSupabasePublicAuthConfig().headers()).toEqual({ apikey: 'anon', Authorization: 'Bearer anon' })
  })
})
