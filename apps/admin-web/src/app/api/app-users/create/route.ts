import { prisma } from '@app/db'
import { API_ERROR, appUserCreateSchema, clientIp, hashPassword, zodDetails } from '@app/shared'
import { auditCreate } from '@/lib/audit'
import { internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'

/**
 * Create an APP user from the console + `APP_USER_CREATE` audit, in one
 * transaction.
 *
 * Unlike `/api/admin-users/create`, an existing email is NEVER reused here. That
 * route promotes an existing APP user because a person may legitimately be both
 * (SPEC §7); the reverse has no meaning — the User row already exists, so
 * "creating" it again would either duplicate an account or silently overwrite
 * someone's password. Both cases are `EMAIL_TAKEN`.
 *
 * `emailVerified` is deliberately left null, matching app-web's self-service
 * registration: an admin typing an address is not proof that it was verified.
 */
export async function POST(request: Request) {
  const gate = await requireApiAdmin('appUser.create')
  if (!gate.ok) return gate.response

  const parsed = appUserCreateSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
  }

  const { email, password, name, locale } = parsed.data

  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) return jsonError(API_ERROR.EMAIL_TAKEN)

    // Hash before opening the transaction: argon2id is deliberately slow, and
    // holding a database transaction open across it would pin a pool connection
    // for no reason.
    const passwordHash = await hashPassword(password)

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: name ?? null,
          passwordHash,
          locale: locale ?? 'zh',
          status: 'active',
        },
        select: { id: true, email: true, name: true, locale: true, status: true, createdAt: true },
      })

      // SPEC §1.6 — write + audit share a transaction: no write without its
      // audit. The row is self-describing because there is no "before" state to
      // diff against, unlike APP_USER_UPDATE.
      await tx.auditLog.create(
        auditCreate({
          actorUserId: gate.admin.id,
          action: 'APP_USER_CREATE',
          targetId: user.id,
          meta: { email: user.email, name: user.name, locale: user.locale },
          ip: clientIp(request.headers),
        }),
      )

      return user
    })

    return jsonOk({ ok: true, user: created })
  } catch (error) {
    return internalError(error)
  }
}
