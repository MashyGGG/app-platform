import { API_ERROR } from '@app/shared'
import { enforceRateLimit, internalError, jsonError, jsonOk } from '@/lib/api'
import { requireApiUser } from '@/lib/session'
import { getAudioStore, takeKey } from '@/lib/speaking/audio-store'
import { completeSession, findOwnSession, isScored } from '@/lib/speaking/complete'
import { retryAudioLimits } from '@/lib/speaking/config'
import { readTake } from '@/lib/speaking/upload'
import { getWeekView } from '@/lib/speaking/week'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/speaking/sessions/{id}/retry — 上传再试音频 → COMPLETED
 * (SPEC §5.3, AC-S4 / AC-S5).
 *
 * The retry take is **stored, not re-scored**. That is the product rule, not a
 * shortcut: P3 shows 恰好一个 next step (AC-S3), so scoring the retry would put a
 * second correction on screen at the exact moment the student was supposed to be
 * finishing — and "再试成功" in AC-S5 means the attempt was made, not that a
 * machine graded it. The audio is kept because the 7-day retention window is
 * what makes a retry reviewable at all (IMPL §4.3).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireApiUser()
  if (!gate.ok) return gate.response

  const throttled = await enforceRateLimit('speaking-submit', gate.user.id)
  if (throttled) return throttled

  const { id } = await context.params
  const session = await findOwnSession(id, gate.user.id)
  if (!session) return jsonError(API_ERROR.NOT_FOUND)

  // Completing a day that was never scored would write a `winner_type: null`
  // row into the very history the 7-day sentence counts (AC-S8).
  if (!isScored(session)) {
    return jsonError(API_ERROR.VALIDATION_FAILED, {
      details: { session: ['errors.sessionNotScored'] },
    })
  }

  const take = await readTake(request, retryAudioLimits())
  if (!take.ok) return take.response

  try {
    const key = takeKey(gate.user.id, session.id, 'retry')
    await getAudioStore().put(key, take.audio, 'audio/wav')
    await completeSession(session, 'DONE', key)

    return jsonOk({
      sessionId: session.id,
      status: 'COMPLETED',
      retryState: 'DONE',
      week: await getWeekView(gate.user.id),
    })
  } catch (error) {
    // No FAILED here: unlike scoring, nothing about this path consumed quota or
    // left the session unusable — the student can simply press again.
    return internalError(error)
  }
}
