import { jsonOk, internalError } from '@/lib/api'
import { requireApiUser } from '@/lib/session'
import { getOrCreateTodaySession } from '@/lib/speaking/today'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/speaking/sessions — 当日幂等取回/创建 (AC-I2).
 *
 * Same handler body as `GET /api/speaking/today` on purpose: "create" and "read
 * today" are the same operation, because a user has exactly one session per
 * calendar day and the constraint enforces it. The two routes exist because the
 * spec names both verbs, not because they do different things.
 */
export async function POST(): Promise<Response> {
  const gate = await requireApiUser()
  if (!gate.ok) return gate.response

  try {
    return jsonOk(await getOrCreateTodaySession(gate.user.id))
  } catch (error) {
    return internalError(error)
  }
}
