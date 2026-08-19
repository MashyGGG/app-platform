import { API_ERROR } from '@app/shared'
import { internalError, jsonError, jsonOk } from '@/lib/api'
import { requireApiUser } from '@/lib/session'
import { findOwnSession } from '@/lib/speaking/complete'
import { markSessionDegraded } from '@/lib/speaking/score'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/speaking/sessions/{id}/degraded — 「第 20s 了，还没回来」 (AC-S10).
 *
 * The clock is the client's (IMPL §4.5): only the browser knows how long the
 * student has been watching a spinner, and the scoring request is deliberately
 * NOT cancelled when this fires — it keeps running, and its result is still
 * rendered if the student is still on the page.
 *
 * So this endpoint records, it does not decide. It moves nothing forward and
 * closes nothing; `degraded_flag=true` is the observability half of AC-S10, and
 * the student's own 跳过 is the half that ends the day.
 *
 * No rate limit and no body: a single idempotent boolean write on a session the
 * caller already owns is not worth a Redis round trip, and the client fires it
 * once per take.
 */
export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireApiUser()
  if (!gate.ok) return gate.response

  const { id } = await context.params
  const session = await findOwnSession(id, gate.user.id)
  if (!session) return jsonError(API_ERROR.NOT_FOUND)

  try {
    await markSessionDegraded(session.id)
    return jsonOk({ sessionId: session.id, degradedFlag: true })
  } catch (error) {
    return internalError(error)
  }
}
