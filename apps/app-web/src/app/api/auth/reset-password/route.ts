import { prisma } from '@app/db'
import { API_ERROR, clientIp, hashPassword, resetPasswordSchema, zodDetails } from '@app/shared'
import { enforceRateLimit, internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { consumeResetToken } from '@/lib/reset-token'

export const runtime = 'nodejs'

/** AC-4 — a used token is dead, whether the reset succeeded or not. */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request.headers)

    const throttled = await enforceRateLimit('reset-confirm', ip)
    if (throttled) return throttled

    const parsed = resetPasswordSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
    }

    const { email, token, password } = parsed.data

    const valid = await consumeResetToken(email, token)
    if (!valid) return jsonError(API_ERROR.INVALID_TOKEN)

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    })
    if (!user) return jsonError(API_ERROR.INVALID_TOKEN)
    if (user.status !== 'active') return jsonError(API_ERROR.ACCOUNT_DISABLED)

    const passwordHash = await hashPassword(password)
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      // Any adapter-issued sessions for this user are invalidated too.
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ])

    return jsonOk({ ok: true })
  } catch (error) {
    return internalError(error)
  }
}
