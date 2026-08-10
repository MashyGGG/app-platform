import { prisma } from '@app/db'
import { API_ERROR, adminUserCreateSchema, clientIp, hashPassword, zodDetails } from '@app/shared'
import { auditCreate } from '@/lib/audit'
import { internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'

/**
 * AC-7 — super_admin only; an operator gets a real 403 here, regardless of what
 * the UI shows.
 *
 * If the email already belongs to an APP user, that user is PROMOTED (an
 * AdminProfile is attached) rather than duplicated — SPEC §7 explicitly allows
 * one person to be both.
 */
export async function POST(request: Request) {
  const gate = await requireApiAdmin('adminUser.create')
  if (!gate.ok) return gate.response

  const parsed = adminUserCreateSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
  }

  const { email, password, name, role } = parsed.data

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, adminProfile: { select: { userId: true } } },
    })

    if (existing?.adminProfile) return jsonError(API_ERROR.EMAIL_TAKEN)

    const passwordHash = await hashPassword(password)

    const created = await prisma.$transaction(async (tx) => {
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { name: name ?? undefined, status: 'active' },
            select: { id: true, email: true, name: true, status: true },
          })
        : await tx.user.create({
            data: {
              email,
              name: name ?? null,
              passwordHash,
              status: 'active',
              emailVerified: new Date(),
            },
            select: { id: true, email: true, name: true, status: true },
          })

      await tx.adminProfile.create({ data: { userId: user.id, role } })

      await tx.auditLog.create(
        auditCreate({
          actorUserId: gate.admin.id,
          action: 'ADMIN_USER_CREATE',
          targetId: user.id,
          meta: { role, promotedExistingUser: Boolean(existing) },
          ip: clientIp(request.headers),
        }),
      )

      return user
    })

    return jsonOk({ ok: true, user: { ...created, role } })
  } catch (error) {
    return internalError(error)
  }
}
