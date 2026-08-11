import { expect, test } from '@playwright/test'
import { APP_URL, FIXTURE_PASSWORD } from '../../src/env'
import { apiContext, expectApiError, jsonOf, tempEmail, uniqueIp } from '../../src/http'
import { registerAppUser } from '../../src/flows'

/**
 * The `/api/auth/login` and `/api/auth/register` contracts, asserted at the HTTP
 * boundary — status code AND the `{ error, messageKey }` envelope, because a
 * client that only checks `res.ok` would pass either way.
 *
 * Each test opens its own request context with its own `x-forwarded-for`, so the
 * rate-limit buckets (`rl:auth:login:<ip>:<email>`) never overlap.
 */

test('an unauthenticated caller gets the contracted 401 from /api/me', async () => {
  const ctx = await apiContext(APP_URL)
  await expectApiError(await ctx.get('/api/me'), 401, 'UNAUTHORIZED')
  await ctx.dispose()
})

test('a malformed body is a 400 with per-field details, not a 500', async () => {
  const ctx = await apiContext(APP_URL)

  const body = await expectApiError(
    await ctx.post('/api/auth/login', { data: { email: 'not-an-email', password: '' } }),
    400,
    'VALIDATION_FAILED',
  )
  expect(Object.keys(body.details ?? {})).toContain('email')

  await ctx.dispose()
})

test('a wrong password is 401 INVALID_CREDENTIALS', async () => {
  const email = tempEmail('creds')
  const ctx = await apiContext(APP_URL)

  await registerAppUser(ctx, { email, password: FIXTURE_PASSWORD })
  const other = await apiContext(APP_URL)
  await expectApiError(
    await other.post('/api/auth/login', { data: { email, password: 'WrongPassword1' } }),
    401,
    'INVALID_CREDENTIALS',
  )

  await other.dispose()
  await ctx.dispose()
})

test('the same address cannot register twice', async () => {
  const email = tempEmail('dupe')
  const ctx = await apiContext(APP_URL)

  await registerAppUser(ctx, { email, password: FIXTURE_PASSWORD })
  await expectApiError(
    await ctx.post('/api/auth/register', { data: { email, password: FIXTURE_PASSWORD } }),
    409,
    'EMAIL_TAKEN',
  )

  await ctx.dispose()
})

test('login is throttled at 5 per 15 minutes, before the password is ever checked', async () => {
  const email = tempEmail('throttle')
  const ip = uniqueIp()

  // Registering from a DIFFERENT address keeps this test's login bucket pristine:
  // the bucket key is `<ip>:<email>`, and register does not touch it.
  const setup = await apiContext(APP_URL)
  await registerAppUser(setup, { email, password: FIXTURE_PASSWORD })
  await setup.dispose()

  const ctx = await apiContext(APP_URL, { ip })

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await ctx.post('/api/auth/login', { data: { email, password: 'WrongPassword1' } })
    expect(res.status(), `attempt ${attempt} should still be allowed through`).toBe(401)
  }

  const throttled = await ctx.post('/api/auth/login', {
    data: { email, password: 'WrongPassword1' },
  })
  const body = await expectApiError(throttled, 429, 'RATE_LIMITED')
  // The client needs to know how long to wait, and must never be told "0".
  expect(body.retryAfterSec).toBeGreaterThan(0)
  expect(Number(throttled.headers()['retry-after'])).toBeGreaterThan(0)

  // The decisive assertion: the CORRECT password is refused too. If the limiter
  // ran after verification it would be usable as an oracle — a 429 for bad
  // passwords and a 200 for good ones would confirm the password.
  await expectApiError(
    await ctx.post('/api/auth/login', { data: { email, password: FIXTURE_PASSWORD } }),
    429,
    'RATE_LIMITED',
  )

  // A different address is unaffected — the limit is per client, not global.
  const elsewhere = await apiContext(APP_URL)
  await jsonOf(
    await elsewhere.post('/api/auth/login', { data: { email, password: FIXTURE_PASSWORD } }),
    200,
  )

  await elsewhere.dispose()
  await ctx.dispose()
})
