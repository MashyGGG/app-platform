import { describe, expect, it } from 'vitest'
import type { ZodTypeAny } from 'zod'
import { API_ERROR, type ApiErrorCode, errorBody } from '@app/shared/errors'
import { registerSchema, zodDetails } from '@app/shared/validation'
import { otpVerifySchema } from '@app/shared/speaking/otp'
import { AUDIO_REJECTION_KEYS, COACH_LINE_KEYS, PROGRESS_LINE_KEYS } from '@app/shared/speaking'
import en from './en.json'
import zh from './zh.json'

/**
 * The API never ships prose — it ships an i18n key (SPEC §1.5), and this app is
 * what turns that key into a sentence. TypeScript cannot check across that
 * boundary: `errors.ts` is typed, `en.json` is data. So adding an error code and
 * forgetting the translation compiles, passes every other check, and shows the
 * user the literal string `errors.somethingNew`.
 *
 * That is the gap this file closes, in both directions: every key the server can
 * emit must exist here, and the two locales must stay in step.
 */

/** All leaf keys of a messages object, dotted. */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

function lookup(messages: unknown, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      messages,
    )
}

const LOCALES = { en, zh }

/** Every messageKey the error envelope can put on the wire. */
const ENVELOPE_KEYS = (Object.values(API_ERROR) as ApiErrorCode[]).map(
  (code) => errorBody(code).messageKey,
)

/**
 * Every messageKey the zod schemas can emit, collected by actually failing them
 * rather than by keeping a hand-written list that would drift.
 */
function keysEmittedBy(schema: ZodTypeAny, inputs: unknown[]): string[] {
  return inputs.flatMap((input) => {
    const result = schema.safeParse(input)
    return result.success ? [] : Object.values(zodDetails(result.error)).flat()
  })
}

const VALIDATION_KEYS = [
  ...new Set([
    ...keysEmittedBy(registerSchema, [
      { email: 'not-an-email', password: 'abcd1234' },
      { email: 'user@example.com', password: 'abc1' },
      { email: 'user@example.com', password: `a1${'x'.repeat(200)}` },
      { email: 'user@example.com', password: 'abcdefghij' },
    ]),
    // The OTP sign-in channel (AC-S9) ships its own key, and it reaches the
    // user in exactly the same way.
    ...keysEmittedBy(otpVerifySchema, [
      { email: 'user@example.com', code: 'abcdef' },
      { email: 'not-an-email', code: '123456' },
    ]),
  ]),
].filter((key) => key.startsWith('errors.'))

/**
 * Keys that reach the client inside `details.<field>`, which no schema emits —
 * the upload gate's four rejection reasons (from the shared table the routes
 * actually use, so this cannot drift) plus the one the completion endpoints
 * return when a day is closed before it was ever scored.
 */
const DETAIL_KEYS = [...Object.values(AUDIO_REJECTION_KEYS), 'errors.sessionNotScored']

describe('app-web messages', () => {
  it('collected the keys it is supposed to be checking', () => {
    // Guards the guard: if `flatten` or the collectors silently returned nothing,
    // every assertion below would vacuously pass.
    expect(ENVELOPE_KEYS.length).toBeGreaterThanOrEqual(10)
    expect(VALIDATION_KEYS).toEqual(
      expect.arrayContaining([
        'errors.invalidEmail',
        'errors.passwordTooShort',
        'errors.passwordTooLong',
        'errors.passwordTooWeak',
        'errors.invalidOtpCode',
      ]),
    )
  })

  it.each(Object.keys(LOCALES))('translates every server error key in %s', (locale) => {
    const messages = LOCALES[locale as keyof typeof LOCALES]
    for (const key of [...ENVELOPE_KEYS, ...VALIDATION_KEYS, ...DETAIL_KEYS]) {
      const value = lookup(messages, key)
      expect(typeof value, `${locale} is missing ${key}`).toBe('string')
      expect(String(value).trim(), `${locale}.${key} is empty`).not.toBe('')
    }
  })

  it.each(Object.keys(LOCALES))(
    'translates every coach line the winner rule can pick in %s',
    (locale) => {
      // Same gap as the error keys, one layer up: `pickWinner` returns a key, the
      // route ships it, and nothing type-checks that a sentence exists behind it.
      // A missing one renders the literal `today.coach.B` as the coaching line —
      // the single sentence AC-S3 says the student gets.
      const messages = LOCALES[locale as keyof typeof LOCALES]
      expect(COACH_LINE_KEYS.length).toBeGreaterThanOrEqual(4)
      for (const key of COACH_LINE_KEYS) {
        expect(typeof lookup(messages, key), `${locale} is missing ${key}`).toBe('string')
      }
    },
  )

  it.each(Object.keys(LOCALES))('translates every 7-day progress line in %s', (locale) => {
    // AC-S8's sentence is a template, and a template with no translation behind
    // it renders as `me.progress.A` — the one line `/me` exists to show.
    const messages = LOCALES[locale as keyof typeof LOCALES]
    expect(PROGRESS_LINE_KEYS.length).toBe(3)
    for (const key of PROGRESS_LINE_KEYS) {
      const value = lookup(messages, key)
      expect(typeof value, `${locale} is missing ${key}`).toBe('string')
      // Both placeholders are supplied by `weeklyProgress`; a template that
      // dropped one would silently stop saying how many times.
      expect(String(value), `${locale}.${key} must interpolate {count}`).toContain('{count}')
      expect(String(value), `${locale}.${key} must interpolate {days}`).toContain('{days}')
    }
  })

  it('keeps en and zh at exactly the same set of keys', () => {
    // A key present in one locale only is a half-translated release: it renders
    // fine for the reviewer and shows a raw key to everyone else.
    const enKeys = flatten(en).sort()
    const zhKeys = flatten(zh).sort()
    expect(zhKeys).toEqual(enKeys)
    expect(enKeys.length).toBeGreaterThan(0)
  })

  it('has no empty or placeholder-only string anywhere', () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      for (const key of flatten(messages)) {
        const value = lookup(messages, key)
        expect(typeof value, `${locale}.${key} is not a string`).toBe('string')
        expect(String(value).trim(), `${locale}.${key} is empty`).not.toBe('')
      }
    }
  })
})
