import { prisma } from '@app/db'
import { API_ERROR, auditListQuerySchema, zodDetails } from '@app/shared'
import { internalError, jsonError, jsonOk } from '@/lib/api'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SPEC §1.6 — READ ONLY. There is deliberately no POST/PATCH/DELETE handler in
 * this file: audit rows are append-only and nobody, not even super_admin, can
 * remove them.
 */
export async function GET(request: Request) {
  const gate = await requireApiAdmin('audit.view')
  if (!gate.ok) return gate.response

  const url = new URL(request.url)
  const parsed = auditListQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
  }

  const { page, pageSize, action } = parsed.data

  try {
    const where = action ? { action } : {}

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          meta: true,
          ip: true,
          createdAt: true,
          actor: { select: { id: true, email: true, name: true } },
        },
      }),
    ])

    return jsonOk({ total, page, pageSize, items })
  } catch (error) {
    return internalError(error)
  }
}
