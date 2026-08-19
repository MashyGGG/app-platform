import { createHash, createHmac, randomInt } from 'node:crypto'
import { OTP_CODE_LENGTH, otpIdentifier } from './otp'

/**
 * The `node:crypto` half of the OTP contract — kept out of `otp.ts` so the
 * browser bundle can import the constants and schemas without pulling a Node
 * built-in in with them.
 */

/**
 * A uniformly random `OTP_CODE_LENGTH`-digit string, leading zeros kept — the
 * code is text, not a number, and `042317` must stay six characters long.
 *
 * @param random injectable only so tests can pin the value; production always
 *               uses `crypto.randomInt`, never `Math.random`.
 */
export function generateOtpCode(
  random: (maxExclusive: number) => number = (max) => randomInt(0, max),
): string {
  const max = 10 ** OTP_CODE_LENGTH
  return String(((random(max) % max) + max) % max).padStart(OTP_CODE_LENGTH, '0')
}

/**
 * What actually goes into the database. Storing the plaintext code would put a
 * live credential in every backup and query log; the HMAC keeps a leaked dump
 * from yielding usable codes, because brute-forcing 10^6 hashes is instant
 * without the key and impossible with it.
 *
 * Bound to the email as well as the code, so a row can only ever validate the
 * address it was issued for — `VerificationToken.token` is globally unique, and
 * without that binding two people could race for the same six digits.
 */
export function hashOtpCode(
  email: string,
  code: string,
  secret: string | undefined = process.env.AUTH_SECRET_APP,
): string {
  const material = `${otpIdentifier(email)}:${code.trim()}`
  return secret
    ? createHmac('sha256', secret).update(material).digest('hex')
    : createHash('sha256').update(material).digest('hex')
}
