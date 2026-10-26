import { SCENARIO_CATALOG, SCENARIO_CATALOG_VERSION } from '@/app/lib/ios/scenarioCatalog'

export const dynamic = 'force-dynamic'

// Built-in rehearsals for the app. Public like the web's system scenarios: fixed
// editorial content, no account data and no model call.
export function GET() {
  return Response.json({ version: SCENARIO_CATALOG_VERSION, scenarios: SCENARIO_CATALOG },
    { headers: { 'Cache-Control': 'public, max-age=600' } })
}
