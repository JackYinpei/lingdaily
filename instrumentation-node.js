// Node-only part of instrumentation.js (kept out of the Edge bundle).
//
// The Supabase database is in mainland China while this server runs in Tokyo:
// a new TLS connection costs ~250-360 ms, a reused one ~85 ms (measured
// 2026-11-03). Node's fetch drops idle connections after 4 s, so almost every
// API request paid a fresh handshake. The database gateway keeps idle
// connections for about 60 s, so keep ours for 45 s. Only connection reuse
// changes; request and body timeouts stay at Node's defaults.
//
// The agent comes from the `undici` package pinned to the same major as the copy
// built into Node 20 (the production runtime); other Node versions keep their default.
import { Agent, setGlobalDispatcher } from 'undici'

if (process.versions.undici?.split('.')[0] === '6') {
  setGlobalDispatcher(new Agent({ keepAliveTimeout: 45_000, keepAliveMaxTimeout: 45_000 }))
}
