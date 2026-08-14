import { prisma } from '@app/db'
import { API_ERROR } from '@app/shared'
import { MAX_AUDIO_BYTES, checkAudio, type AudioRejection } from '@app/shared/speaking'
import { enforceRateLimit, internalError, jsonError, jsonOk } from '@/lib/api'
import { requireApiUser } from '@/lib/session'
import { audioLimits } from '@/lib/speaking/config'
import { markSessionFailed, scoreMainTake } from '@/lib/speaking/score'
import { toWinnerView } from '@/lib/speaking/today'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Which i18n key the client shows for each way a take can be rejected. */
function rejectionKey(reason: AudioRejection['reason']): string {
  switch (reason) {
    case 'not_wav':
      return 'errors.audioNotWav'
    case 'wrong_format':
      return 'errors.audioWrongFormat'
    case 'too_short':
      return 'errors.audioTooShort'
    case 'too_long':
      return 'errors.audioTooLong'
  }
}

/**
 * POST /api/speaking/sessions/{id}/audio — 上传 P2 音频，**同步**返回
 * `{winnerType, coachLine, retryItems[]}` (SPEC §5.3, AC-S3).
 *
 * The body is the raw WAV, not multipart: there is exactly one file and no
 * fields, so a form encoding would only add a parser between the browser and
 * three megabytes of PCM.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireApiUser()
  if (!gate.ok) return gate.response

  // Before the upload is read, let alone scored: a take costs real Azure quota
  // once M5 lands, and that quota is shared by every user (IMPL §4.4 红线 2).
  const throttled = await enforceRateLimit('speaking-submit', gate.user.id)
  if (throttled) return throttled

  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: { audio: ['errors.audioTooLong'] } })
  }

  const { id } = await context.params

  const session = await prisma.speakingSession.findUnique({
    where: { id },
    select: { id: true, userId: true, promptId: true },
  })
  // Same answer for "no such session" and "someone else's session": a 403 here
  // would confirm that an id exists.
  if (!session || session.userId !== gate.user.id) return jsonError(API_ERROR.NOT_FOUND)

  const audio = new Uint8Array(await request.arrayBuffer())
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: { audio: ['errors.audioTooLong'] } })
  }

  const check = checkAudio(audio, audioLimits())
  if (!check.ok) {
    return jsonError(API_ERROR.VALIDATION_FAILED, {
      details: { audio: [rejectionKey(check.rejection.reason)] },
    })
  }

  try {
    const result = await scoreMainTake({
      userId: gate.user.id,
      sessionId: session.id,
      promptId: session.promptId,
      audio,
      durationMs: check.info.durationMs,
    })

    // Exactly one winner, and the material to act on it — nothing else. A second
    // correction on screen is the failure mode AC-S3 exists to prevent (D16).
    return jsonOk({ sessionId: session.id, status: 'RETRY', ...toWinnerView(result.winner) })
  } catch (error) {
    // AC-S6: the day's prompt and the day's allowance both survive a failure.
    await markSessionFailed(session.id).catch(() => undefined)
    return internalError(error)
  }
}
