import { authorizeIOSRequest } from '@/app/lib/server/iosAuth'
import { liveModel } from '@/app/lib/server/iosLive'
import {
  practiceFailure, practiceJSON, practiceModel, suggestionModel, translationModel,
} from '@/app/lib/server/iosPractice'
import { modelCatalog } from '@/app/lib/ios/models'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Models the app may offer per feature; the server default comes first in effect when nothing is chosen.
export async function GET(request) {
  try {
    await authorizeIOSRequest(request)
    return practiceJSON(modelCatalog({
      practice: practiceModel(), suggest: suggestionModel(), translate: translationModel(), live: liveModel(),
    }))
  } catch (error) { return practiceFailure(error) }
}
