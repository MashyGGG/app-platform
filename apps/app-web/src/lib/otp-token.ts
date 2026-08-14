import 'server-only'
import { prisma } from '@app/db'
import { hashOtpCode, isOtpExpired, otpExpiresAt, otpIdentifier } from '@app/shared/speaking'

/**
 * Storage for the passwordless sign-in codes (AC-S9). Reuses the Auth.js
 * `VerificationToken` table under the `otp:<email>` namespace, exactly as
 * password reset reuses it under `reset:<email>` — no new table, no migration.
 *
 * All the rules (code shape, TTL, hashing) live in `@app/shared/speaking`; this
 * file is only the Prisma half so it can stay out of the unit suite.
 */

/**
 * Issues a fresh code and kills any previous one for that address, so a second
 * "send me a code" click cannot leave two live codes outstanding.
 *
 * Returns the PLAINTEXT code — only the hash is stored, so this is the single
 * moment it exists, and it must go straight into the email and nowhere else.
 */
export async function issueOtpCode(email: string, code: string): Promise<void> {
  const identifier = otpIdentifier(email)

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({
      data: { identifier, token: hashOtpCode(email, code), expires: otpExpiresAt() },
    }),
  ])
}

/**
 * Single use. A CORRECT code is deleted whether or not it had expired; a WRONG
 * one leaves the row alone, otherwise one bad guess would invalidate the code
 * the user is still typing. The guessing budget is the `otp-verify` rate limit,
 * not the row.
 */
export async function consumeOtpCode(email: string, code: string): Promise<boolean> {
  const identifier = otpIdentifier(email)

  const row = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier, token: hashOtpCode(email, code) } },
  })
  if (!row) return false

  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier, token: row.token } },
  })

  return !isOtpExpired(row.expires)
}
