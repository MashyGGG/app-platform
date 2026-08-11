import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test'
import { TEMP_PREFIX } from './env'

/**
 * Rate limits are keyed on the client IP (`clientIp()` reads `x-forwarded-for`,
 * which the platform sets in production). Every context therefore claims its own
 * random address: `register` is throttled per-IP at 5/hour, so without this a
 * developer's fifth local run of the day would start failing — and the throttled
 * requests would be indistinguishable from a real regression.
 *
 * A /8 gives 16.7M addresses; collisions across a run are not worth guarding.
 */
export function uniqueIp(): string {
  const n = Math.floor(Math.random() * 0xffffff)
  return `10.${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${n & 0xff}`
}

/** Address for a throwaway account. `e2e.test` is a reserved TLD — never routable. */
export function tempEmail(label: string): string {
  const stamp = Date.now().toString(36)
  const rand = Math.floor(Math.random() * 1e6).toString(36)
  return `${TEMP_PREFIX}${label}-${stamp}${rand}@e2e.test`
}

export interface ContextOptions {
  /** Reuse a cookie jar saved by `auth.setup.ts`, i.e. start already signed in. */
  storageState?: string
  /** Pin the rate-limit bucket, e.g. to prove the 6th attempt is the one rejected. */
  ip?: string
}

export async function apiContext(
  baseURL: string,
  options: ContextOptions = {},
): Promise<APIRequestContext> {
  return request.newContext({
    baseURL,
    storageState: options.storageState,
    extraHTTPHeaders: { 'x-forwarded-for': options.ip ?? uniqueIp() },
  })
}

/**
 * Reads the JSON body and asserts the status in one step, putting the *response
 * body* in the failure message. A bare `expect(res.status()).toBe(200)` reports
 * "expected 200, received 403" and leaves you guessing which gate said no.
 */
export async function jsonOf<T>(res: APIResponse, expectedStatus?: number): Promise<T> {
  const text = await res.text()
  if (expectedStatus !== undefined) {
    expect(res.status(), `${res.url()} → ${res.status()} ${text}`).toBe(expectedStatus)
  }
  return JSON.parse(text) as T
}

export interface ApiError {
  error: string
  messageKey: string
  retryAfterSec?: number
  details?: Record<string, string[]>
}

/** Asserts the contracted `{ error, messageKey }` envelope, not just the status. */
export async function expectApiError(
  res: APIResponse,
  status: number,
  code: string,
): Promise<ApiError> {
  const body = await jsonOf<ApiError>(res, status)
  expect(body.error).toBe(code)
  // The server must never ship prose: `messageKey` is an i18n key the client
  // translates (packages/shared/src/errors.ts).
  expect(body.messageKey).toMatch(/^errors\./)
  return body
}
