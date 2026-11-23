// Phone-number accounts without SMS verification.
//
// Supabase Auth only signs in by phone when an SMS provider is configured, and this
// project has none. A phone account is therefore an ordinary email/password account
// whose address is derived from the number (`8613800138000@phone.lingdaily.yasobi.xyz`),
// created through the Admin API with the address already confirmed so no mail is sent.
// The number itself is recorded in the user's metadata. Nothing proves the learner owns
// the number: it is a login name, not a verified contact.

export const PHONE_ACCOUNT_DOMAIN = 'phone.lingdaily.yasobi.xyz'

/**
 * Normalizes a phone number to E.164 (`+8613800138000`), or returns null.
 * An 11-digit number starting with 1 is a mainland China mobile number; any other
 * number needs its country code, written with `+` or `00`.
 */
export function normalizePhone(input) {
  if (typeof input !== 'string') return null
  let value = input.trim().replace(/[\s\-().]/g, '')
  if (value.startsWith('00')) value = `+${value.slice(2)}`
  if (/^1[3-9]\d{9}$/.test(value)) return `+86${value}`
  if (/^861[3-9]\d{9}$/.test(value)) return `+${value}`
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return null
  if (value.startsWith('+86') && !/^\+861[3-9]\d{9}$/.test(value)) return null
  return value
}

/** The Supabase sign-in address of a normalized phone number. */
export const phoneAccountEmail = phone => `${phone.replace(/^\+/, '')}@${PHONE_ACCOUNT_DOMAIN}`

/** The phone number behind a phone account's address, or null for a real email address. */
export function phoneFromAccountEmail(address) {
  if (typeof address !== 'string') return null
  const match = address.toLowerCase().match(/^(\d{8,15})@(.+)$/)
  return match && match[2] === PHONE_ACCOUNT_DOMAIN ? `+${match[1]}` : null
}
