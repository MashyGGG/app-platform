import { prisma } from '@app/db'
import { API_ERROR, clientIp, setStatusSchema, zodDetails } from '@app/shared'
import { auditCreate } from '@/lib/audit'
import { internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'

/**
 * AC-8 — disable / enable an APP user.
 *
 * Once `status` flips to `disabled`, app-web's per-request status check rejects
 * that user's very next request, even though their JWT is still unexpired.
 */
export async function POST(request: Request) {
  const gate = await requireApiAdmin('appUser.setStatus')
  if (!gate.ok) return gate.response

  const parsed = setStatusSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
  }

  const { userId, status } = parsed.data

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, adminProfile: { select: { userId: true } } },
    })
    if (!target || target.adminProfile) return jsonError(API_ERROR.NOT_FOUND)
    if (target.status === status) return jsonOk({ ok: true, changed: false })

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { status },
        select: { id: true, email: true, status: true },
      }),
      prisma.auditLog.create(
        auditCreate({
          actorUserId: gate.admin.id,
          action: status === 'disabled' ? 'APP_USER_DISABLE' : 'APP_USER_ENABLE',
          targetId: userId,
          meta: { before: { status: target.status }, after: { status } },
          ip: clientIp(request.headers),
        }),
      ),
    ])

    return jsonOk({ ok: true, changed: true, user: updated })
  } catch (error) {
    return internalError(error)
  }
}
