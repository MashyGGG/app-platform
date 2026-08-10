import { prisma } from '@app/db'
import { API_ERROR, clientIp, loginSchema, zodDetails } from '@app/shared'
import { signIn } from '@/auth'
import { enforceRateLimit, internalError, jsonError, jsonOk, readJson } from '@/lib/api'

export const runtime = 'nodejs'

/** Backoffice login. Same 429 contract as app-web (SPEC §1.5 / AC-2). */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request.headers)
    const parsed = loginSchema.safeParse(await readJson(request))

    if (!parsed.success) {
      const throttled = await enforceRateLimit('login', `${ip}:unknown`)
      if (throttled) return throttled
      return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
    }

    const { email, password } = parsed.data

    const throttled = await enforceRateLimit('login', `${ip}:${email}`)
    if (throttled) return throttled

    const user = await prisma.user.findUnique({
      where: { email },
      select: { status: true, adminProfile: { select: { role: true } } },
    })

    if (user && user.status !== 'active') return jsonError(API_ERROR.ACCOUNT_DISABLED)
    // AC-6 — an APP user with valid credentials still cannot enter. Reported as
    // FORBIDDEN rather than "no such account" so it is not an oracle for which
    // emails are admins... the message is generic in both cases.
    if (user && !user.adminProfile) return jsonError(API_ERROR.FORBIDDEN)

    try {
      await signIn('credentials', { redirect: false, email, password })
    } catch {
      return jsonError(API_ERROR.INVALID_CREDENTIALS)
    }

    return jsonOk({ ok: true })
  } catch (error) {
    return internalError(error)
  }
}
