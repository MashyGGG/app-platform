import { jsonOk, internalError } from '@/lib/api'
import { requireApiUser } from '@/lib/session'
import { getOrCreateTodaySession } from '@/lib/speaking/today'

// The disabled-user check must run on every request; nothing here may be cached.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/speaking/today — 今日 prompt + 当日 session (AC-I2). */
export async function GET(): Promise<Response> {
  const gate = await requireApiUser()
  if (!gate.ok) return gate.response

  try {
    return jsonOk(await getOrCreateTodaySession(gate.user.id))
  } catch (error) {
    return internalError(error)
  }
}
