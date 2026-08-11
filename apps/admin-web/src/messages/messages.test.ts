import { describe, expect, it } from 'vitest'
import { API_ERROR, type ApiErrorCode, errorBody } from '@app/shared/errors'
import { adminUserCreateSchema, zodDetails } from '@app/shared/validation'
import en from './en.json'
import zh from './zh.json'

/**
 * Same contract as app-web's copy of this file, asserted separately because the
 * obligation belongs to each app: both consume `@app/shared`'s error codes, and
 * each owns its own translations. Deliberately duplicated rather than factored
 * into a helper — a shared test helper living in one app and imported by the
 * other is the kind of coupling this monorepo's layering rules exist to prevent.
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

const ENVELOPE_KEYS = (Object.values(API_ERROR) as ApiErrorCode[]).map(
  (code) => errorBody(code).messageKey,
)

/**
 * The console creates admin users, so its validation surface is
 * `adminUserCreateSchema`; the keys it can emit are collected by failing it.
 */
const VALIDATION_KEYS = [
  ...new Set(
    [
      { email: 'not-an-email', password: 'abcd1234', role: 'operator' },
      { email: 'user@example.com', password: 'abc1', role: 'operator' },
      { email: 'user@example.com', password: `a1${'x'.repeat(200)}`, role: 'operator' },
      { email: 'user@example.com', password: 'abcdefghij', role: 'operator' },
    ].flatMap((input) => {
      const result = adminUserCreateSchema.safeParse(input)
      return result.success ? [] : Object.values(zodDetails(result.error)).flat()
    }),
  ),
].filter((key) => key.startsWith('errors.'))

describe('admin-web messages', () => {
  it('collected the keys it is supposed to be checking', () => {
    expect(ENVELOPE_KEYS.length).toBeGreaterThanOrEqual(10)
    expect(VALIDATION_KEYS).toEqual(
      expect.arrayContaining([
        'errors.invalidEmail',
        'errors.passwordTooShort',
        'errors.passwordTooLong',
        'errors.passwordTooWeak',
      ]),
    )
  })

  it.each(Object.keys(LOCALES))('translates every server error key in %s', (locale) => {
    const messages = LOCALES[locale as keyof typeof LOCALES]
    for (const key of [...ENVELOPE_KEYS, ...VALIDATION_KEYS]) {
      const value = lookup(messages, key)
      expect(typeof value, `${locale} is missing ${key}`).toBe('string')
      expect(String(value).trim(), `${locale}.${key} is empty`).not.toBe('')
    }
  })

  it('keeps en and zh at exactly the same set of keys', () => {
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
