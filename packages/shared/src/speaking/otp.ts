import { z } from 'zod'
import { emailSchema, localeSchema } from '../validation'

/**
 * Email one-time codes — the passwordless login channel (IMPL §3-C2, AC-S9).
 *
 * This half is the CONTRACT: constants, the identifier namespace, the expiry
 * rule and the request/verify schemas. It is free of `node:crypto` on purpose,
 * so the sign-in form can import it in the browser without webpack trying to
 * bundle a Node built-in. The hashing lives next door in `otp-hash.ts`.
 *
 * Everything here is pure — no Prisma, no `server-only`, no Request — which is
 * what lets Vitest assert the rules directly. An e2e can neither wait out a TTL
 * nor exhaust a six-digit space.
 */

export const OTP_CODE_LENGTH = 6

/**
 * Short on purpose: the code is six digits, so its security budget is
 * (attempts × time), and the `otp-verify` rate limit caps the attempts. Ten
 * minutes is long enough to switch to a mail client on a phone and back.
 */
export const OTP_TTL_MS = 10 * 60 * 1000

/** How long the UI makes the user wait before asking for another code. */
export const OTP_RESEND_COOLDOWN_SEC = 60

/**
 * `VerificationToken.identifier` is shared with the Auth.js adapter and with
 * password reset (`reset:<email>`), so OTP rows get their own namespace and can
 * never be consumed by, or collide with, either.
 */
export const OTP_IDENTIFIER_PREFIX = 'otp:'

export function otpIdentifier(email: string): string {
  return `${OTP_IDENTIFIER_PREFIX}${email.trim().toLowerCase()}`
}

export function otpExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_MS)
}

/** Expiry is inclusive: a code is dead *at* its expiry instant, not after it. */
export function isOtpExpired(expires: Date, now: Date = new Date()): boolean {
  return expires.getTime() <= now.getTime()
}

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`), { message: 'errors.invalidOtpCode' })

export const otpRequestSchema = z.object({
  email: emailSchema,
  locale: localeSchema.optional(),
})
export type OtpRequestInput = z.infer<typeof otpRequestSchema>

export const otpVerifySchema = z.object({
  email: emailSchema,
  code: otpCodeSchema,
  locale: localeSchema.optional(),
})
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>
