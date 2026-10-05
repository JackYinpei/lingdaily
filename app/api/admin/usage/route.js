import { checkAdmin } from '@/app/lib/adminAuth'
import { usageSummary } from '@/app/lib/server/aiUsage'
import { authUserEmail } from '@/app/lib/server/supabaseAuthUser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = 86_400_000

// Token usage of the iOS app across all users (ADMIN_EMAILS only).
export async function GET(request) {
  if (!await checkAdmin()) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30))
  try {
    const summary = await usageSummary({ since: new Date(Date.now() - days * DAY) })
    const emails = await Promise.all(summary.byUser.map(user => authUserEmail(user.key).catch(() => null)))
    summary.byUser = summary.byUser.map((user, index) => ({ ...user, email: emails[index] }))
    return Response.json({ days, ...summary }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin-usage] failed', error?.message)
    return Response.json({ error: 'Usage is unavailable' }, { status: 502 })
  }
}
