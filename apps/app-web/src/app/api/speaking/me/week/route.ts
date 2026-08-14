import { internalError, jsonOk } from '@/lib/api'
import { requireApiUser } from '@/lib/session'
import { getWeekView } from '@/lib/speaking/week'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/speaking/me/week — 7 天模板句 + 完成日历 (SPEC §5.3, AC-S8).
 *
 * Read-only, and that is a product decision: `/me` is where a student sees they
 * are getting somewhere, not a second place to practise from (SPEC §4.3 —
 * 一条路的信息架构).
 */
export async function GET(): Promise<Response> {
  const gate = await requireApiUser()
  if (!gate.ok) return gate.response

  try {
    return jsonOk(await getWeekView(gate.user.id))
  } catch (error) {
    return internalError(error)
  }
}
