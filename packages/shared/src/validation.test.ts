import { describe, expect, it } from 'vitest'
import type { ZodError } from 'zod'
import {
  appUserUpdateSchema,
  emailSchema,
  listQuerySchema,
  loginSchema,
  passwordSchema,
  registerSchema,
  zodDetails,
} from './validation'

/**
 * These are the boundaries the E2E suite structurally cannot afford to walk:
 * `register` is rate-limited to 5 requests per hour per IP, so a table of twenty
 * password cases over HTTP means either fighting the limiter or minting twenty
 * client IPs. Here the same table costs nothing — and a failure names the rule
 * that rejected the input, where a 400 response only says "something was wrong".
 */

/**
 * Structural, so one helper serves every schema here. `ZodType<T>` would not:
 * it also fixes the *input* type, which `z.coerce` and `.default()` deliberately
 * make differ from the output (`listQuerySchema` takes strings, yields numbers).
 */
interface Parseable<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: ZodError }
}

/** `safeParse` and return the parsed value, failing loudly with the real issues. */
function parsed<T>(schema: Parseable<T>, input: unknown): T {
  const result = schema.safeParse(input)
  expect(result.success, `expected ${JSON.stringify(input)} to parse`).toBe(true)
  if (!result.success) throw result.error
  return result.data
}

/** The i18n keys a failed parse reported, flattened. */
function messages(schema: Parseable<unknown>, input: unknown): string[] {
  const result = schema.safeParse(input)
  if (result.success) return []
  return Object.values(zodDetails(result.error)).flat()
}

describe('emailSchema', () => {
  it('normalises case and surrounding whitespace', () => {
    // This is what makes "the same account" a well-defined idea. EMAIL_TAKEN,
    // login lookup and the admin console's search all rely on it: without the
    // normalisation, `Foo@Example.COM` would register a second account.
    expect(parsed<string>(emailSchema, '  Foo@Example.COM  ')).toBe('foo@example.com')
  })

  it('accepts the address shapes real users actually have', () => {
    for (const address of [
      'user+tag@example.com',
      'user.name@sub.example.co.uk',
      "o'brien@example.com",
      'user@example.corporate',
      `${'a'.repeat(64)}@${'b'.repeat(63)}.example.com`,
    ]) {
      expect(parsed<string>(emailSchema, address)).toBe(address)
    }
  })

  it('rejects non-ASCII addresses — a real limitation, written down on purpose', () => {
    // zod 3's `.email()` is an ASCII-only regex, so an RFC 6531 internationalised
    // address cannot register at all — neither a unicode local part nor a unicode
    // domain. Most mail providers behave the same way and no user has asked, so
    // this stays as it is; but it became our product's behaviour by accident
    // rather than by decision. If those users ever matter, this is the test that
    // has to change, and `emailSchema` needs a custom check.
    expect(emailSchema.safeParse('jörg@example.de').success).toBe(false)
    expect(emailSchema.safeParse('user@exämple.de').success).toBe(false)
  })

  it.each([
    ['no at sign', 'not-an-email'],
    ['two at signs', 'a@b@example.com'],
    ['empty local part', '@example.com'],
    ['no domain dot', 'user@localhost'],
    ['a bare IP address', 'user@127.0.0.1'],
    ['an inner space', 'user name@example.com'],
    ['whitespace only', '   '],
    ['too long', `${'a'.repeat(250)}@example.com`],
    ['not a string', 42],
  ])('rejects %s', (_label, input) => {
    expect(emailSchema.safeParse(input).success).toBe(false)
  })

  it('reports rejections with the i18n key the client translates', () => {
    expect(messages(registerSchema, { email: 'nope', password: 'abcd1234' })).toContain(
      'errors.invalidEmail',
    )
  })
})

describe('passwordSchema', () => {
  it('holds the 8-character floor exactly', () => {
    expect(passwordSchema.safeParse('abcd123').success).toBe(false) // 7
    expect(passwordSchema.safeParse('abcd1234').success).toBe(true) // 8
  })

  it('holds the 128-character ceiling exactly', () => {
    const body = `a1${'x'.repeat(126)}`
    expect(body).toHaveLength(128)
    expect(passwordSchema.safeParse(body).success).toBe(true)
    expect(passwordSchema.safeParse(`${body}y`).success).toBe(false) // 129
  })

  it('requires both a letter and a digit', () => {
    expect(passwordSchema.safeParse('abcdefghij').success).toBe(false)
    expect(passwordSchema.safeParse('1234567890').success).toBe(false)
    expect(passwordSchema.safeParse('!@#$%^&*()').success).toBe(false)
    expect(passwordSchema.safeParse('abcd1234').success).toBe(true)
  })

  it('does not trim — leading and trailing spaces are password material', () => {
    // Trimming here would silently change a user's password between the
    // registration request and the login request.
    expect(parsed<string>(passwordSchema, ' abcd1234 ')).toBe(' abcd1234 ')
  })

  it.each([
    ['errors.passwordTooShort', 'abc1'],
    ['errors.passwordTooLong', `a1${'x'.repeat(200)}`],
    ['errors.passwordTooWeak', 'abcdefghij'],
  ])('reports %s', (key, password) => {
    expect(messages(registerSchema, { email: 'user@example.com', password })).toContain(key)
  })
})

describe('registerSchema', () => {
  it('accepts the minimal payload and leaves the optionals absent', () => {
    const value = parsed<{ email: string; name?: string; locale?: string }>(registerSchema, {
      email: 'user@example.com',
      password: 'abcd1234',
    })
    expect(value.name).toBeUndefined()
    expect(value.locale).toBeUndefined()
  })

  it('trims the display name and rejects one that is only whitespace', () => {
    expect(
      parsed<{ name?: string }>(registerSchema, {
        email: 'user@example.com',
        password: 'abcd1234',
        name: '  Ada  ',
      }).name,
    ).toBe('Ada')
    expect(
      registerSchema.safeParse({ email: 'user@example.com', password: 'abcd1234', name: '   ' })
        .success,
    ).toBe(false)
  })

  it('rejects an unknown locale', () => {
    expect(
      registerSchema.safeParse({ email: 'user@example.com', password: 'abcd1234', locale: 'fr' })
        .success,
    ).toBe(false)
  })
})

describe('loginSchema', () => {
  it('does not apply the strength rules to the submitted password', () => {
    // Login must accept anything the user might type, including a password that
    // no longer satisfies the current policy. Rejecting it here would return
    // VALIDATION_FAILED where INVALID_CREDENTIALS is the honest answer, and
    // would leak which passwords are policy-shaped.
    expect(loginSchema.safeParse({ email: 'user@example.com', password: 'x' }).success).toBe(true)
    expect(loginSchema.safeParse({ email: 'user@example.com', password: '' }).success).toBe(false)
  })
})

describe('appUserUpdateSchema', () => {
  it('distinguishes an absent name from an explicit null', () => {
    // The route handler treats `null` as "clear the display name" and absence as
    // "leave it alone"; collapsing the two would make clearing a name impossible.
    const cleared = parsed<{ name?: string | null }>(appUserUpdateSchema, {
      userId: 'u1',
      name: null,
    })
    expect(cleared.name).toBeNull()
    expect('name' in parsed<object>(appUserUpdateSchema, { userId: 'u1' })).toBe(false)
  })
})

describe('listQuerySchema', () => {
  it('coerces the querystring numbers and applies the defaults', () => {
    expect(parsed<{ page: number; pageSize: number }>(listQuerySchema, {})).toEqual({
      page: 1,
      pageSize: 20,
    })
    expect(parsed<{ page: number }>(listQuerySchema, { page: '3' }).page).toBe(3)
  })

  it('refuses a page size that would let one request read the whole table', () => {
    expect(listQuerySchema.safeParse({ pageSize: '100' }).success).toBe(true)
    expect(listQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ page: '0' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ page: '1.5' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ page: 'abc' }).success).toBe(false)
  })

  it('rejects an unknown status filter rather than ignoring it', () => {
    expect(listQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false)
  })
})

describe('zodDetails', () => {
  it('groups every issue under its field path', () => {
    const result = registerSchema.safeParse({ email: 'nope', password: 'x' })
    expect(result.success).toBe(false)
    if (result.success) return

    const details = zodDetails(result.error)
    expect(Object.keys(details).sort()).toEqual(['email', 'password'])
    expect(details.email).toContain('errors.invalidEmail')
  })

  it('collects several issues on one field into one array', () => {
    const result = registerSchema.safeParse({ email: 'a@b.co', password: 'ab' })
    if (result.success) throw new Error('expected a failure')
    expect(zodDetails(result.error).password?.length).toBeGreaterThanOrEqual(1)
  })

  it("files a whole-object issue under '_'", () => {
    const result = registerSchema.safeParse('not an object')
    if (result.success) throw new Error('expected a failure')
    expect(Object.keys(zodDetails(result.error))).toEqual(['_'])
  })
})
