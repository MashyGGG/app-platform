import 'server-only'
import { API_ERROR } from '@app/shared'
import {
  AUDIO_REJECTION_KEYS,
  MAX_AUDIO_BYTES,
  audioRejectionKey,
  checkAudio,
  type AudioLimits,
} from '@app/shared/speaking'
import { jsonError } from '@/lib/api'

/**
 * The upload gate both take endpoints share — `POST …/audio` (the main 开口) and
 * `POST …/retry` (AC-S4), which differ only in the length window they enforce
 * (see `retryAudioLimits`).
 *
 * One implementation because the failure vocabulary has to be one vocabulary:
 * the four rejection reasons reach the client inside `details.audio` as i18n
 * keys, and a second copy of that mapping is a second thing to drift.
 */

function tooLong(): Response {
  return jsonError(API_ERROR.VALIDATION_FAILED, {
    details: { audio: [AUDIO_REJECTION_KEYS.too_long] },
  })
}

export type TakeUpload =
  { ok: true; audio: Uint8Array; durationMs: number } | { ok: false; response: Response }

/**
 * Reads the raw WAV body and validates it, or hands back the 400 to return.
 *
 * The body is the file itself, not multipart: there is exactly one file and no
 * fields, so a form encoding would only add a parser between the browser and
 * three megabytes of PCM. The declared `content-length` is checked first so an
 * oversized take is refused before it is buffered.
 */
export async function readTake(request: Request, limits: AudioLimits): Promise<TakeUpload> {
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    return { ok: false, response: tooLong() }
  }

  const audio = new Uint8Array(await request.arrayBuffer())
  if (audio.byteLength > MAX_AUDIO_BYTES) return { ok: false, response: tooLong() }

  const check = checkAudio(audio, limits)
  if (!check.ok) {
    return {
      ok: false,
      response: jsonError(API_ERROR.VALIDATION_FAILED, {
        details: { audio: [audioRejectionKey(check.rejection.reason)] },
      }),
    }
  }

  return { ok: true, audio, durationMs: check.info.durationMs }
}
