import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { PracticeAPIError, practiceFailure, practiceJSON } from '@/app/lib/server/iosPractice'
import { acquireTranscription, isAppRecording, MAX_AUDIO_BYTES, readBoundedBytes, transcribeSpeech } from '@/app/lib/server/iosSpeech'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Dictation for text mode: a short WAV recording in, its words out. Nothing is stored.
export async function POST(request) {
  try {
    const { userId } = await authorizeIOSRequest(request)
    if (!request.headers.get('content-type')?.startsWith('audio/wav')) throw new PracticeAPIError(415, 'WAV_REQUIRED', '录音格式不正确。')
    const wav = await readBoundedBytes(request, MAX_AUDIO_BYTES)
    if (!isAppRecording(wav)) throw new PracticeAPIError(400, 'INVALID_REQUEST', '录音格式不正确。')
    const release = acquireTranscription(userId)
    try { return practiceJSON({ text: await transcribeSpeech(wav, userId) }) } finally { release() }
  } catch (error) { return practiceFailure(error) }
}
