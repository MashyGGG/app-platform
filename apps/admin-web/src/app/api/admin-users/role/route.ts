import { prisma } from '@app/db'
import { API_ERROR, adminUserRoleSchema, clientIp, zodDetails } from '@app/shared'
import { auditCreate } from '@/lib/audit'
import { internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'

/** Promote / demote a backoffice user. super_admin only (SPEC §1.7). */
export async function POST(request: Request) {
  const gate = await requireApiAdmin('adminUser.updateRole')
  if (!gate.ok) return gate.response

  const parsed = adminUserRoleSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
  }

  const { userId, role } = parsed.data

  // Self-demotion would let the last super_admin lock everyone out of the
  // console; refuse it rather than leave the system unrecoverable.
  if (userId === gate.admin.id) return jsonError(API_ERROR.FORBIDDEN)

  try {
    const profile = await prisma.adminProfile.findUnique({
      where: { userId },
      select: { role: true },
    })
    if (!profile) return jsonError(API_ERROR.NOT_FOUND)
    if (profile.role === role) return jsonOk({ ok: true, changed: false })

    if (profile.role === 'super_admin') {
      const superAdmins = await prisma.adminProfile.count({ where: { role: 'super_admin' } })
      if (superAdmins <= 1) return jsonError(API_ERROR.FORBIDDEN)
    }

    await prisma.$transaction([
      prisma.adminProfile.update({ where: { userId }, data: { role } }),
      prisma.auditLog.create(
        auditCreate({
          actorUserId: gate.admin.id,
          action: 'ADMIN_USER_UPDATE_ROLE',
          targetId: userId,
          meta: { before: { role: profile.role }, after: { role } },
          ip: clientIp(request.headers),
        }),
      ),
    ])

    return jsonOk({ ok: true, changed: true })
  } catch (error) {
    return internalError(error)
  }
}
