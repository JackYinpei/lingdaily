// Shared retry helpers for the podcast pipeline's upstream calls (Gemini
// script/TTS generation and news feeds).

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRY_BASE_DELAY_MS = 1500;
const RETRY_MAX_DELAY_MS = 15000;

// Exponential backoff with jitter so simultaneous overloaded requests don't all
// retry in lockstep and re-congest the upstream.
export function backoffDelay(retryNumber) {
  const capped = Math.min(RETRY_BASE_DELAY_MS * 2 ** (retryNumber - 1), RETRY_MAX_DELAY_MS);
  return capped / 2 + Math.random() * (capped / 2);
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
// "terminated" is undici dropping a long-running response (a TTS call stalled ~300 s on 2026-10-26).
const RETRYABLE_STATUS_PATTERN = /\b(?:unavailable|resource_exhausted|internal|overloaded|deadline|terminated)\b|high demand|try again|econnreset|etimedout|fetch failed|socket hang up|network error/i;

// Distinguish transient upstream failures (503 "high demand", 429 rate limits,
// 5xx, network blips) from permanent ones. Only transient failures are worth
// retrying with the same input or failing over to another model.
export function isRetryableApiError(error) {
  if (!error) return false;
  const status = error.status ?? error.code ?? error?.error?.code;
  if (typeof status === "number" && RETRYABLE_STATUS_CODES.has(status)) return true;
  const message = error instanceof Error ? error.message : String(error);
  const codeMatch = message.match(/"code"\s*:\s*(\d{3})/);
  if (codeMatch && RETRYABLE_STATUS_CODES.has(Number(codeMatch[1]))) return true;
  return RETRYABLE_STATUS_PATTERN.test(message);
}
