import { API_ERROR } from '@app/shared'
import { internalError, jsonError, jsonOk } from '@/lib/api'
import { requireApiUser } from '@/lib/session'
import { completeSession, findOwnSession, isScored } from '@/lib/speaking/complete'
import { getWeekView } from '@/lib/speaking/week'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/speaking/sessions/{id}/skip-retry — 跳过再试 → COMPLETED,
 * `retry_state=SKIPPED` (SPEC §5.3, AC-S5).
 *
 * 「允许跳过，跳过也算今天练完」 is 已确认决策 5, and this endpoint is where that
 * is true or not: a day the student chose to end must be as complete as one they
 * re-recorded. D3 — 允许停 — is the whole reason the app can be finished in
 * eight minutes, and a skip that silently did not count would make the promise
 * false at the one moment the student is checking it.
 *
 * No rate limit and no body: it costs nothing, touches no provider quota, and
 * the only thing it can be spammed into is the same idempotent write.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await requireApiUser()
  if (!gate.ok) return gate.response

  const { id } = await context.params
  const session = await findOwnSession(id, gate.user.id)
  if (!session) return jsonError(API_ERROR.NOT_FOUND)

  if (!isScored(session)) {
    return jsonError(API_ERROR.VALIDATION_FAILED, {
      details: { session: ['errors.sessionNotScored'] },
    })
  }

  try {
    await completeSession(session, 'SKIPPED')

    return jsonOk({
      sessionId: session.id,
      status: 'COMPLETED',
      // Not `'SKIPPED'`: a student who spoke the retry and then pressed skip has
      // a day completed by DONE, and `completeSession` keeps it that way.
      retryState: session.retryState === 'DONE' ? 'DONE' : 'SKIPPED',
      week: await getWeekView(gate.user.id),
    })
  } catch (error) {
    return internalError(error)
  }
}
