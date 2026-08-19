import { API_ERROR } from '@app/shared'
import { enforceRateLimit, internalError, jsonError, jsonOk } from '@/lib/api'
import { requireApiUser } from '@/lib/session'
import { findOwnSession } from '@/lib/speaking/complete'
import { warmupAudioLimits } from '@/lib/speaking/config'
import { readTake } from '@/lib/speaking/upload'
import { assessWarmupTake } from '@/lib/speaking/warmup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/speaking/sessions/{id}/warmup — 跟读一句 (P1, AC-S7).
 *
 * Optional by construction: nothing downstream requires this call to have
 * happened, `/audio` never looks at the session's status, and the response
 * carries no next step. 「跳过热身不影响进入主开口」 is therefore true because
 * there is nothing here to skip past, not because a flag says so.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireApiUser()
  if (!gate.ok) return gate.response

  // The same budget as a scored take: this reaches the provider too, and once M5
  // wires Azure it spends the shared F0 quota (IMPL §4.4 红线 2).
  const throttled = await enforceRateLimit('speaking-submit', gate.user.id)
  if (throttled) return throttled

  const { id } = await context.params

  const session = await findOwnSession(id, gate.user.id)
  if (!session) return jsonError(API_ERROR.NOT_FOUND)

  const take = await readTake(request, warmupAudioLimits())
  if (!take.ok) return take.response

  try {
    const result = await assessWarmupTake({
      sessionId: session.id,
      promptId: session.promptId,
      audio: take.audio,
    })

    return jsonOk({ sessionId: session.id, status: 'WARMUP', accuracy: result.accuracy })
  } catch (error) {
    // No FAILED branch here, unlike `/audio`: a warm-up that did not work
    // consumed no completion allowance and left nothing half-done — the student
    // simply carries on to the main take, which is where the day actually is.
    return internalError(error)
  }
}
