import { prisma } from '@app/db'
import { API_ERROR, forgotPasswordSchema, sendResetPasswordEmail, zodDetails } from '@app/shared'
import { enforceRateLimit, internalError, jsonError, jsonOk, readJson } from '@/lib/api'
import { issueResetToken } from '@/lib/reset-token'

export const runtime = 'nodejs'

/** AC-4 — issue a one-time reset token and email it. */
export async function POST(request: Request) {
  try {
    const parsed = forgotPasswordSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
    }

    const { email, locale } = parsed.data

    // SPEC §1.5 — keyed by email, before any DB work.
    const throttled = await enforceRateLimit('reset-req', email)
    if (throttled) return throttled

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true, locale: true },
    })

    // Only real, active accounts get a token — but the response is identical
    // either way so the endpoint cannot be used to enumerate accounts.
    if (user && user.status === 'active') {
      const token = await issueResetToken(email)
      const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const lang = locale ?? (user.locale === 'en' ? 'en' : 'zh')
      const resetUrl =
        `${base}/${lang}/reset-password` +
        `?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`

      await sendResetPasswordEmail({ to: email, resetUrl, locale: lang })
    }

    return jsonOk({ ok: true })
  } catch (error) {
    return internalError(error)
  }
}
