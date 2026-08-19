import { API_ERROR } from '@app/shared'
import { enforceRateLimit, internalError, jsonError, jsonOk } from '@/lib/api'
import { requireApiUser } from '@/lib/session'
import { findOwnSession } from '@/lib/speaking/complete'
import { audioLimits } from '@/lib/speaking/config'
import { markSessionFailed, scoreMainTake } from '@/lib/speaking/score'
import { applyTestHook, readTestHook } from '@/lib/speaking/test-hook'
import { toWinnerView } from '@/lib/speaking/today'
import { readTake } from '@/lib/speaking/upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/speaking/sessions/{id}/audio — 上传 P2 音频，**同步**返回
 * `{winnerType, coachLine, retryItems[]}` (SPEC §5.3, AC-S3).
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

  const { id } = await context.params

  // Same answer for "no such session" and "someone else's session": a 403 here
  // would confirm that an id exists.
  const session = await findOwnSession(id, gate.user.id)
  if (!session) return jsonError(API_ERROR.NOT_FOUND)

  const take = await readTake(request, audioLimits())
  if (!take.ok) return take.response

  // Inert unless SPEAKING_TEST_HOOKS=1, and never on a production deployment.
  const hook = readTestHook(request)

  try {
    // Inside the try, and before the work: `fail` must travel the same path a
    // real provider error would (AC-S6), and `slow` must stall a request that
    // still succeeds — the case AC-S10 exists for and AC-S6 does not cover.
    await applyTestHook(hook)

    const result = await scoreMainTake({
      userId: gate.user.id,
      sessionId: session.id,
      promptId: session.promptId,
      audio: take.audio,
      durationMs: take.durationMs,
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
