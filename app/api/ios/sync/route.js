import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import {
  createUserLimiter, PracticeAPIError, practiceFailure, practiceJSON, readBoundedJSON,
} from '@/app/lib/server/iosPractice'
import { applySync, loadSnapshot, syncRequestSchema } from '@/app/lib/server/iosSync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_SYNC_BYTES = 4 * 1024 * 1024
const stateKey = Symbol.for('lingdaily.iosSyncLimiter.v1')
const acquire = userId => (globalThis[stateKey] ||= createUserLimiter({ maxConcurrent: 1, maxPerMinute: 30 }))(userId)

async function accountUser(request) {
  const { userId } = await authorizeIOSRequest(request)
  // The local development pairing has no account to sync into.
  if (userId === 'local-development') throw new PracticeAPIError(400, 'NO_ACCOUNT', '本机开发模式不支持云同步。')
  return userId
}

// Current cloud copy of this account's app data.
export async function GET(request) {
  try {
    const userId = await accountUser(request)
    const release = acquire(userId)
    try { return practiceJSON(await loadSnapshot(userId)) } finally { release() }
  } catch (error) { return practiceFailure(error) }
}

// Applies pending local changes, then returns the authoritative snapshot.
export async function POST(request) {
  try {
    const userId = await accountUser(request)
    const parsed = syncRequestSchema.safeParse(await readBoundedJSON(request, MAX_SYNC_BYTES))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '同步内容格式不正确。')
    const release = acquire(userId)
    try { return practiceJSON(await applySync(userId, parsed.data)) } finally { release() }
  } catch (error) { return practiceFailure(error) }
}
