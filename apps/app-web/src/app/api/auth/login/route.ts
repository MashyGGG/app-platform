import { prisma } from '@app/db'
import { API_ERROR, clientIp, loginSchema, zodDetails } from '@app/shared'
import { signIn } from '@/auth'
import { enforceRateLimit, internalError, jsonError, jsonOk, readJson } from '@/lib/api'

export const runtime = 'nodejs'

/**
 * Credentials login.
 *
 * Auth.js' own /api/auth/callback/credentials cannot return the contracted
 * 429 envelope, so login goes through this handler: rate limit first (AC-2),
 * then delegate the actual credential check to Auth.js.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request.headers)
    const body = await readJson(request)

    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      // Still burn a rate-limit slot: malformed bodies are a brute-force vector.
      const throttled = await enforceRateLimit('login', `${ip}:unknown`)
      if (throttled) return throttled
      return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
    }

    const { email, password } = parsed.data

    // SPEC §1.5 — key is `rl:auth:login:{ip}:{email}`, checked before any DB read.
    const throttled = await enforceRateLimit('login', `${ip}:${email}`)
    if (throttled) return throttled

    const user = await prisma.user.findUnique({
      where: { email },
      select: { status: true },
    })
    if (user && user.status !== 'active') {
      return jsonError(API_ERROR.ACCOUNT_DISABLED)
    }

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
