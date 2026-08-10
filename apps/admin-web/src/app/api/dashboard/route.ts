import { internalError, jsonOk } from '@/lib/api'
import { getDashboardSummary } from '@/lib/dashboard'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireApiAdmin('dashboard.view')
  if (!gate.ok) return gate.response

  try {
    const { data, cached } = await getDashboardSummary()
    return jsonOk({ ...data, cached })
  } catch (error) {
    return internalError(error)
  }
}
