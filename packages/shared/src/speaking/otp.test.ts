import { describe, expect, it } from 'vitest'
import { RATE_LIMITS } from '../rate-limit'
import { generateOtpCode, hashOtpCode } from './otp-hash'
import {
  OTP_CODE_LENGTH,
  OTP_IDENTIFIER_PREFIX,
  OTP_TTL_MS,
  isOtpExpired,
  otpExpiresAt,
  otpIdentifier,
  otpRequestSchema,
  otpVerifySchema,
} from './otp'

/**
 * AC-S9 — passwordless sign-in. Everything asserted here is either invisible to
 * the e2e suite (a hash, a TTL boundary) or unaffordable there (exhausting the
 * six-digit space, waiting ten minutes). The HTTP journey itself is covered by
 * `e2e/tests/app-web/otp-login.spec.ts`.
 */

describe('generateOtpCode', () => {
  it('always produces exactly six digits, leading zeros included', () => {
    // The single most likely bug in the whole feature: treating the code as a
    // number somewhere, so `042317` reaches the user as `42317` and can never
    // match the hash that was stored.
    expect(generateOtpCode(() => 42)).toBe('000042')
    expect(generateOtpCode(() => 0)).toBe('000000')
    expect(generateOtpCode(() => 999_999)).toBe('999999')
  })

  it('stays inside the six-digit space even for an out-of-range source', () => {
    expect(generateOtpCode(() => 1_000_000)).toBe('000000')
    expect(generateOtpCode(() => 1_234_567)).toBe('234567')
  })

  it('produces real, varied randomness from the default source', () => {
    const codes = Array.from({ length: 200 }, () => generateOtpCode())
    for (const code of codes) expect(code).toMatch(/^\d{6}$/)
    // A constant generator would still satisfy the shape assertion above.
    expect(new Set(codes).size).toBeGreaterThan(100)
  })
})

describe('otpIdentifier', () => {
  it('namespaces the row so it can never collide with a reset token', () => {
    // The same table holds `reset:<email>` rows and Auth.js adapter rows. A
    // shared identifier would let one flow consume the other's token.
    expect(otpIdentifier('Ada@Example.com')).toBe('otp:ada@example.com')
    expect(otpIdentifier('  ada@example.com  ')).toBe(`${OTP_IDENTIFIER_PREFIX}ada@example.com`)
    expect(otpIdentifier('a@b.com')).not.toBe('reset:a@b.com')
  })
})

describe('hashOtpCode', () => {
  const SECRET = 'unit-test-secret'

  it('is deterministic and case-insensitive in the email', () => {
    expect(hashOtpCode('ada@example.com', '123456', SECRET)).toBe(
      hashOtpCode('ADA@Example.com', ' 123456 ', SECRET),
    )
  })

  it('binds the hash to the address, so a code cannot be replayed elsewhere', () => {
    // `VerificationToken.token` is globally unique. Without the email in the
    // digest, two users issued the same six digits would collide on insert —
    // and worse, either could redeem the other's row.
    expect(hashOtpCode('ada@example.com', '123456', SECRET)).not.toBe(
      hashOtpCode('bob@example.com', '123456', SECRET),
    )
  })

  it('never stores anything resembling the code itself', () => {
    const digest = hashOtpCode('ada@example.com', '123456', SECRET)
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).not.toContain('123456')
    expect(digest).not.toContain('ada@example.com')
  })

  it('changes with the secret, so a leaked dump cannot be brute-forced', () => {
    // 10^6 SHA-256 digests is milliseconds of work; the HMAC key is the only
    // thing standing between a stolen backup and live sign-in codes.
    expect(hashOtpCode('ada@example.com', '123456', SECRET)).not.toBe(
      hashOtpCode('ada@example.com', '123456', 'another-secret'),
    )
    expect(hashOtpCode('ada@example.com', '123456', undefined)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('expiry', () => {
  const now = new Date('2026-08-14T10:00:00.000Z')

  it('expires ten minutes out', () => {
    expect(otpExpiresAt(now).getTime() - now.getTime()).toBe(OTP_TTL_MS)
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000)
  })

  it('treats the expiry instant itself as dead', () => {
    const expires = otpExpiresAt(now)
    expect(isOtpExpired(expires, new Date(expires.getTime() - 1))).toBe(false)
    // `<=`, not `<`: an off-by-one here is a code that is valid for one extra
    // millisecond forever, which no e2e would ever catch.
    expect(isOtpExpired(expires, expires)).toBe(true)
    expect(isOtpExpired(expires, new Date(expires.getTime() + 1))).toBe(true)
  })
})

describe('otpRequestSchema', () => {
  it('normalises the address the same way the rest of auth does', () => {
    const parsed = otpRequestSchema.parse({ email: '  Ada@Example.COM ' })
    expect(parsed.email).toBe('ada@example.com')
    expect(parsed.locale).toBeUndefined()
  })

  it.each([
    ['a malformed address', { email: 'not-an-email' }],
    ['a missing address', {}],
    ['an unsupported locale', { email: 'ada@example.com', locale: 'fr' }],
  ])('rejects %s', (_label, input) => {
    expect(otpRequestSchema.safeParse(input).success).toBe(false)
  })
})

describe('otpVerifySchema', () => {
  it('accepts a six-digit code, trimmed', () => {
    const parsed = otpVerifySchema.parse({ email: 'ada@example.com', code: ' 042317 ' })
    expect(parsed.code).toBe('042317')
  })

  it.each([
    ['five digits', '12345'],
    ['seven digits', '1234567'],
    ['letters', 'abcdef'],
    ['a mixed code', '12a456'],
    ['an empty code', ''],
    ['a signed number', '+12345'],
    ['a code with an inner space', '123 456'],
  ])('rejects %s', (_label, code) => {
    const result = otpVerifySchema.safeParse({ email: 'ada@example.com', code })
    expect(result.success).toBe(false)
  })

  it('reports the failure as an i18n key, never as prose', () => {
    // SPEC §1.5: the server ships keys. This one is asserted to exist in both
    // locales by apps/app-web/src/messages/messages.test.ts.
    const result = otpVerifySchema.safeParse({ email: 'ada@example.com', code: 'abcdef' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.message).toBe('errors.invalidOtpCode')
  })

  it('agrees with the declared code length', () => {
    expect(OTP_CODE_LENGTH).toBe(6)
    expect(otpVerifySchema.safeParse({ email: 'a@b.com', code: '1'.repeat(6) }).success).toBe(true)
  })
})

describe('rate-limit budgets', () => {
  it('throttles code requests at 3 per hour (IMPL §4.5)', () => {
    // The number is a contract, not a tuning knob: it is what keeps the free
    // Resend tier's 100 messages/day out of reach of a single address.
    expect(RATE_LIMITS['otp-req']).toEqual({ limit: 3, window: '1 h', windowSec: 3600 })
  })

  it('caps guessing so six digits cannot be searched', () => {
    const budget = RATE_LIMITS['otp-verify']
    expect(budget.limit).toBe(5)
    // 5 guesses per 15 minutes against 10^6 codes that die after 10 minutes.
    const guessesPerCodeLifetime = budget.limit * (OTP_TTL_MS / (budget.windowSec * 1000))
    expect(guessesPerCodeLifetime).toBeLessThan(10)
  })
})
