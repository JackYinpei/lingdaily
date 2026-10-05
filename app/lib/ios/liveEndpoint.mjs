// Credentials never belong in configuration. Only these controlled origins may
// receive an ephemeral token; the Swift client enforces the same exact endpoints.
export const LIVE_WS_PATH = '/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained'
export const LIVE_WS_HOSTS = ['generativelanguage.googleapis.com', 'lingdailyapi-jp.yasobi.xyz', 'lingdailyapi.yasobi.xyz']
export const DEFAULT_LIVE_WS_URL = `wss://${LIVE_WS_HOSTS[0]}${LIVE_WS_PATH}`

export function liveWebSocketEndpoint(base = '') {
  if (!base.trim()) return DEFAULT_LIVE_WS_URL
  const origin = new URL(base.trim())
  if (!['https:', 'wss:'].includes(origin.protocol) || !LIVE_WS_HOSTS.includes(origin.hostname)
      || origin.username || origin.password || origin.search || origin.hash
      || (origin.port && origin.port !== '443') || origin.pathname !== '/') {
    throw new Error('Invalid Live WebSocket origin')
  }
  return `wss://${origin.hostname}${LIVE_WS_PATH}`
}

export function isLiveWebSocketEndpoint(value) {
  return LIVE_WS_HOSTS.some(host => value === `wss://${host}${LIVE_WS_PATH}`)
}
