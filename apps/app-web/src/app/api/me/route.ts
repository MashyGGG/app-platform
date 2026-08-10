import { jsonOk } from '@/lib/api'
import { requireApiUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * AC-8 probe: a protected API. Disable the user in the backoffice and call this
 * again WITHOUT re-logging-in — it must return 401 even though the JWT in the
 * cookie is still perfectly valid and unexpired.
 */
export async function GET() {
  const result = await requireApiUser()
  if (!result.ok) return result.response

  const { id, email, name, locale, status, createdAt } = result.user
  return jsonOk({ id, email, name, locale, status, createdAt })
}
