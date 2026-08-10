import { prisma } from '@app/db'
import { API_ERROR, appUserUpdateSchema, clientIp, zodDetails } from '@app/shared'
import { auditCreate } from '@/lib/audit'
import { internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'

/** Edit an APP user's basic info + `APP_USER_UPDATE` audit, in one transaction. */
export async function POST(request: Request) {
  const gate = await requireApiAdmin('appUser.update')
  if (!gate.ok) return gate.response

  const parsed = appUserUpdateSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
  }

  const { userId, ...patch } = parsed.data

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, locale: true, adminProfile: { select: { userId: true } } },
    })
    if (!target || target.adminProfile) return jsonError(API_ERROR.NOT_FOUND)

    const fields = (Object.keys(patch) as Array<keyof typeof patch>).filter(
      (key) => patch[key] !== undefined && patch[key] !== target[key],
    )
    if (fields.length === 0) return jsonOk({ ok: true, changed: false })

    const before = Object.fromEntries(fields.map((f) => [f, target[f]]))
    const after = Object.fromEntries(fields.map((f) => [f, patch[f]]))

    // SPEC §1.6 — write + audit share a transaction: no write without its audit.
    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: after,
        select: { id: true, email: true, name: true, locale: true, status: true },
      }),
      prisma.auditLog.create(
        auditCreate({
          actorUserId: gate.admin.id,
          action: 'APP_USER_UPDATE',
          targetId: userId,
          meta: { fields, before, after },
          ip: clientIp(request.headers),
        }),
      ),
    ])

    return jsonOk({ ok: true, changed: true, user: updated })
  } catch (error) {
    return internalError(error)
  }
}
