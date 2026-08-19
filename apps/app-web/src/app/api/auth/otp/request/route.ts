import { API_ERROR, sendOtpEmail, zodDetails } from '@app/shared'
import { OTP_TTL_MS, generateOtpCode, otpRequestSchema } from '@app/shared/speaking'
import { enforceRateLimit, internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { issueOtpCode } from '@/lib/otp-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Test/dev escape hatch: return the code in the response so the e2e suite can
 * complete AC-S9 without an inbox. Off unless explicitly switched on, and hard
 * off on a production deployment whatever the flag says.
 */
function echoesCode(): boolean {
  return process.env.OTP_DEV_ECHO === '1' && process.env.VERCEL_ENV !== 'production'
}

/** AC-S9 step 1 — mail a one-time sign-in code. */
export async function POST(request: Request) {
  try {
    const parsed = otpRequestSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
    }

    const { email, locale } = parsed.data

    // IMPL §4.5 — `otp-req` 3/h, before any DB work. Keyed by email: it is the
    // address, not the caller, that gets mail-bombed, and the free Resend tier
    // is a hard 100/day.
    const throttled = await enforceRateLimit('otp-req', email)
    if (throttled) return throttled

    const code = generateOtpCode()
    await issueOtpCode(email, code)
    await sendOtpEmail({ to: email, code, locale: locale ?? 'zh', ttlMs: OTP_TTL_MS })

    // Identical response whether or not the address has an account — with OTP
    // there is nothing to enumerate, since an unknown address simply becomes
    // one at verify time (AC-S9).
    return jsonOk({
      ok: true,
      expiresInSec: Math.floor(OTP_TTL_MS / 1000),
      ...(echoesCode() ? { devCode: code } : {}),
    })
  } catch (error) {
    return internalError(error)
  }
}
