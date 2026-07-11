import { createRealtimeTokenResponse } from "@/app/lib/server/realtimeToken";

export async function POST() {
  return createRealtimeTokenResponse({ deprecated: true });
}
