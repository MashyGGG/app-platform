import { prisma } from '@app/db'
import { API_ERROR, clientIp, setStatusSchema, zodDetails } from '@app/shared'
import { auditCreate } from '@/lib/audit'
import { internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'

/** Disable / enable a backoffice user. super_admin only (SPEC §1.7). */
export async function POST(request: Request) {
  const gate = await requireApiAdmin('adminUser.setStatus')
  if (!gate.ok) return gate.response

  const parsed = setStatusSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
  }

  const { userId, status } = parsed.data

  // Locking yourself out is never an accident worth honouring.
  if (userId === gate.admin.id) return jsonError(API_ERROR.FORBIDDEN)

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, adminProfile: { select: { role: true } } },
    })
    if (!target?.adminProfile) return jsonError(API_ERROR.NOT_FOUND)
    if (target.status === status) return jsonOk({ ok: true, changed: false })

    if (status === 'disabled' && target.adminProfile.role === 'super_admin') {
      const activeSupers = await prisma.user.count({
        where: { status: 'active', adminProfile: { role: 'super_admin' } },
      })
      if (activeSupers <= 1) return jsonError(API_ERROR.FORBIDDEN)
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { status } }),
      prisma.auditLog.create(
        auditCreate({
          actorUserId: gate.admin.id,
          action: status === 'disabled' ? 'ADMIN_USER_DISABLE' : 'ADMIN_USER_ENABLE',
          targetId: userId,
          meta: { before: { status: target.status }, after: { status } },
          ip: clientIp(request.headers),
        }),
      ),
    ])

    return jsonOk({ ok: true, changed: true })
  } catch (error) {
    return internalError(error)
  }
}
