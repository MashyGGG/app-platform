import { prisma } from '@app/db'
import { API_ERROR, clientIp, zodDetails } from '@app/shared'
import { otpVerifySchema } from '@app/shared/speaking'
import { signIn } from '@/auth'
import { enforceRateLimit, internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { POST_AUTH_LANDING } from '@/lib/routes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * AC-S9 step 2 — check the code, create the account if this address is new, and
 * issue the ordinary app-web session cookie. No password, no profile form.
 *
 * The credential check itself is the `otp` provider in `src/auth.ts`; this
 * handler exists for the same reason `/api/auth/login` does — Auth.js' own
 * callback endpoint cannot return the contracted `{ error, messageKey }`
 * envelope, and the rate limit has to run before any of it.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request.headers)
    const body = await readJson(request)

    const parsed = otpVerifySchema.safeParse(body)
    if (!parsed.success) {
      // A malformed body still spends an attempt: otherwise the 5/15min cap on
      // guessing a six-digit code could be sidestepped by sending junk.
      const throttled = await enforceRateLimit('otp-verify', `${ip}:unknown`)
      if (throttled) return throttled
      return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
    }

    const { email, code } = parsed.data
    // Never pass `undefined` through `signIn`: it serialises into the credentials
    // body as the literal string "undefined", which the provider's own schema
    // would then reject as an unknown locale.
    const locale = parsed.data.locale ?? 'zh'

    const throttled = await enforceRateLimit('otp-verify', `${ip}:${email}`)
    if (throttled) return throttled

    // Checked here rather than in the provider so a disabled account gets the
    // contracted 403 without its live code being consumed.
    const user = await prisma.user.findUnique({ where: { email }, select: { status: true } })
    if (user && user.status !== 'active') {
      return jsonError(API_ERROR.ACCOUNT_DISABLED)
    }

    try {
      await signIn('otp', { redirect: false, email, code, locale })
    } catch {
      return jsonError(API_ERROR.INVALID_TOKEN)
    }

    return jsonOk({ ok: true, redirectTo: `/${locale}${POST_AUTH_LANDING}` })
  } catch (error) {
    return internalError(error)
  }
}
