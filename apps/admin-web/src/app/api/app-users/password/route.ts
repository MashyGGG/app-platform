import { prisma } from '@app/db'
import { API_ERROR, appUserPasswordSchema, clientIp, hashPassword, zodDetails } from '@app/shared'
import { auditCreate } from '@/lib/audit'
import { internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'

/**
 * Overwrite an APP user's password + `APP_USER_PASSWORD_RESET` audit, in one
 * transaction. `appUser.resetPassword` is super_admin-only (SPEC §1.7): unlike
 * the rest of `appUser.*`, this hands the actor working credentials for someone
 * else's account, so it is audited as its own action rather than folded into
 * `APP_USER_UPDATE`.
 *
 * Two things this endpoint deliberately does NOT do:
 *
 * - It never echoes the new password back, and the audit `meta` records only
 *   that a reset happened. An `AuditLog` row is readable by every operator, and
 *   the table is append-only — a password written there could never be redacted.
 * - It cannot revoke the target's existing app-web session. The session strategy
 *   is JWT, so an unexpired cookie stays valid until it expires; `Session` rows
 *   are not the source of truth. Disabling the account (`/api/app-users/status`)
 *   is the kill switch, and it is checked on every request.
 */
export async function POST(request: Request) {
  const gate = await requireApiAdmin('appUser.resetPassword')
  if (!gate.ok) return gate.response

  const parsed = appUserPasswordSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
  }

  const { userId, password } = parsed.data

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, adminProfile: { select: { userId: true } } },
    })
    // "APP user = User WITHOUT AdminProfile" (SPEC §7). A backoffice account's
    // password is changed through the admin-user routes, which have their own
    // guard rails; letting it be reset here would route around them.
    if (!target || target.adminProfile) return jsonError(API_ERROR.NOT_FOUND)

    // Hash before opening the transaction: argon2id is deliberately slow, and
    // holding a transaction open across it would pin a pool connection for no
    // reason — same reasoning as `/api/app-users/create`.
    const passwordHash = await hashPassword(password)

    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
        select: { id: true, email: true },
      }),
      // SPEC §1.6 — write + audit share a transaction: no write without its audit.
      prisma.auditLog.create(
        auditCreate({
          actorUserId: gate.admin.id,
          action: 'APP_USER_PASSWORD_RESET',
          targetId: userId,
          meta: { reset: true },
          ip: clientIp(request.headers),
        }),
      ),
    ])

    return jsonOk({ ok: true, user: updated })
  } catch (error) {
    return internalError(error)
  }
}
