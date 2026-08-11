import { describe, expect, it } from 'vitest'
import { API_ERROR, type ApiErrorCode, errorBody, errorStatus, jsonError } from './errors'

const ALL_CODES = Object.values(API_ERROR) as ApiErrorCode[]

describe('the error envelope', () => {
  it('gives every code a status and an i18n key', () => {
    // TypeScript already enforces the two Records are exhaustive, so this is
    // nearly free — its job is to catch a code whose *value* went wrong, e.g. a
    // copy-pasted messageKey pointing at the wrong string.
    for (const code of ALL_CODES) {
      const body = errorBody(code)
      expect(body.error, code).toBe(code)
      expect(body.messageKey, code).toMatch(/^errors\.[a-z][A-Za-z]+$/)
      expect(errorStatus(code), code).toBeGreaterThanOrEqual(400)
    }
    expect(new Set(ALL_CODES.map((c) => errorBody(c).messageKey)).size).toBe(ALL_CODES.length)
  })

  it('never ships user-facing prose — only a key the client translates', () => {
    // SPEC §1.5. A regression here is invisible in a green E2E run but ships an
    // untranslatable English sentence to every non-English user.
    for (const code of ALL_CODES) {
      expect(JSON.stringify(errorBody(code))).not.toMatch(/[ ]/)
    }
  })

  it('maps the statuses the API contract promises', () => {
    expect(errorStatus(API_ERROR.VALIDATION_FAILED)).toBe(400)
    expect(errorStatus(API_ERROR.INVALID_CREDENTIALS)).toBe(401)
    expect(errorStatus(API_ERROR.UNAUTHORIZED)).toBe(401)
    // 403, not 401: the credentials were right and the account is real.
    expect(errorStatus(API_ERROR.ACCOUNT_DISABLED)).toBe(403)
    expect(errorStatus(API_ERROR.FORBIDDEN)).toBe(403)
    expect(errorStatus(API_ERROR.NOT_FOUND)).toBe(404)
    expect(errorStatus(API_ERROR.EMAIL_TAKEN)).toBe(409)
    expect(errorStatus(API_ERROR.RATE_LIMITED)).toBe(429)
    expect(errorStatus(API_ERROR.INTERNAL)).toBe(500)
  })

  it('merges extra fields without letting them overwrite the code', () => {
    const body = errorBody(API_ERROR.VALIDATION_FAILED, { details: { email: ['errors.invalid'] } })
    expect(body.error).toBe('VALIDATION_FAILED')
    expect(body.details).toEqual({ email: ['errors.invalid'] })
  })
})

describe('jsonError', () => {
  it('sets the status and a JSON content type', async () => {
    const response = jsonError(API_ERROR.FORBIDDEN)
    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ error: 'FORBIDDEN', messageKey: 'errors.forbidden' })
  })

  it('adds retry-after only for a rate limit that carries a delay', async () => {
    // The header is what a client (or a load balancer) actually honours; the body
    // field alone is easy to ship and easy to forget.
    const limited = jsonError(API_ERROR.RATE_LIMITED, { retryAfterSec: 42 })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('42')
    expect((await limited.json()).retryAfterSec).toBe(42)

    expect(jsonError(API_ERROR.RATE_LIMITED).headers.get('retry-after')).toBeNull()
    expect(
      jsonError(API_ERROR.FORBIDDEN, { retryAfterSec: 42 }).headers.get('retry-after'),
    ).toBeNull()
  })

  it('emits retry-after: 0 rather than dropping the header', () => {
    // `!= null` and not a truthiness check: a zero-second retry is a real answer.
    expect(jsonError(API_ERROR.RATE_LIMITED, { retryAfterSec: 0 }).headers.get('retry-after')).toBe(
      '0',
    )
  })
})
