import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { PracticeAPIError, practiceFailure, readBoundedJSON } from '@/app/lib/server/iosPractice'
import { performSpeechRequest, speechRequestSchema } from '@/app/lib/server/iosSpeech'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Read-aloud for text mode: one line as MP3, in the partner's voice. Same session boundary as practice.
export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    const parsed = speechRequestSchema.safeParse(await readBoundedJSON(request))
    if (!parsed.success) throw new PracticeAPIError(400, 'INVALID_REQUEST', '这句话无法朗读。')
    const audio = await performSpeechRequest(parsed.data, userId)
    return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.length), 'Cache-Control': 'no-store' } })
  } catch (error) { return practiceFailure(error) }
}
