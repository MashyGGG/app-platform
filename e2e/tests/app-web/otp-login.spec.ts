import { expect, test } from '@playwright/test'
import { APP_URL } from '../../src/env'
import { apiContext, expectApiError, jsonOf, tempEmail, uniqueIp } from '../../src/http'
import { sessionCookie } from '../../src/cookies'

/**
 * AC-S9 — "WHEN 新用户输入邮箱并校验一次性码，THE 系统 SHALL 直接创建账号并进入落地页，
 * 不要求密码或学校信息."
 *
 * The suite has no mailbox, so the request endpoint echoes the code back when
 * `OTP_DEV_ECHO=1` (set for these servers in playwright.config.ts). That is the
 * only affordance: everything else — account creation, the session cookie, code
 * single-use, the throttle — is the real production path.
 *
 * `/en` rather than the default `/zh` so the selectors read clearly.
 */

interface OtpRequestBody {
  ok: true
  expiresInSec: number
  devCode?: string
}

test('a brand-new address signs in with a code alone — no password, no profile', async ({
  page,
  context,
}) => {
  const email = tempEmail('otp')

  await page.goto('/en/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()

  // The code arrives; the form moves to step 2 without leaving the page.
  await expect(page.getByText(`We sent a code to ${email}`)).toBeVisible()
  const codeField = page.getByLabel('Code')
  await expect(codeField).toHaveValue(/^\d{6}$/)

  // There is no password field anywhere in this journey — that IS the criterion.
  await expect(page.getByLabel('Password')).toHaveCount(0)

  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  // AC-S9 names `/today` as the landing page, and the account exists for real:
  // `/home` renders it from the database on the next request.
  await expect(page).toHaveURL(/\/en\/today$/)
  expect(await sessionCookie(context, 'app')).toBeTruthy()

  await page.goto('/en/home')
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByText('Active')).toBeVisible()

  // The account is real and keeps working: sign out, come back with a new code.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/en\/login/)

  await page.goto('/en/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByLabel('Code')).toHaveValue(/^\d{6}$/)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/today$/)
})

test('a code is single-use and a wrong one is refused', async () => {
  const email = tempEmail('otp-once')
  const ctx = await apiContext(APP_URL)

  const issued = await jsonOf<OtpRequestBody>(
    await ctx.post('/api/auth/otp/request', { data: { email, locale: 'en' } }),
    200,
  )
  expect(issued.devCode).toMatch(/^\d{6}$/)
  expect(issued.expiresInSec).toBeGreaterThan(0)

  const code = issued.devCode as string
  const wrong = code === '000000' ? '111111' : '000000'

  // A wrong guess must NOT burn the live code — the user is still typing.
  await expectApiError(
    await ctx.post('/api/auth/otp/verify', { data: { email, code: wrong } }),
    400,
    'INVALID_TOKEN',
  )

  await jsonOf(await ctx.post('/api/auth/otp/verify', { data: { email, code } }), 200)

  // ...but a used one is dead, so an intercepted code cannot be replayed.
  const replay = await apiContext(APP_URL)
  await expectApiError(
    await replay.post('/api/auth/otp/verify', { data: { email, code } }),
    400,
    'INVALID_TOKEN',
  )

  await replay.dispose()
  await ctx.dispose()
})

test('the verify endpoint rejects a malformed code with the contracted envelope', async () => {
  const ctx = await apiContext(APP_URL)

  const body = await expectApiError(
    await ctx.post('/api/auth/otp/verify', { data: { email: 'ada@e2e.test', code: 'abcdef' } }),
    400,
    'VALIDATION_FAILED',
  )
  expect(Object.keys(body.details ?? {})).toContain('code')

  await ctx.dispose()
})

test('code requests are throttled at 3 per hour per address', async () => {
  const email = tempEmail('otp-throttle')

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // A DIFFERENT address each time proves the bucket is keyed on the email, not
    // on the caller: mail-bombing one inbox from a botnet is the abuse that the
    // 100-messages/day free tier actually cannot absorb.
    const ctx = await apiContext(APP_URL, { ip: uniqueIp() })
    const res = await ctx.post('/api/auth/otp/request', { data: { email } })
    expect(res.status(), `request ${attempt} should still be allowed`).toBe(200)
    await ctx.dispose()
  }

  const ctx = await apiContext(APP_URL, { ip: uniqueIp() })
  const body = await expectApiError(
    await ctx.post('/api/auth/otp/request', { data: { email } }),
    429,
    'RATE_LIMITED',
  )
  expect(body.retryAfterSec).toBeGreaterThan(0)
  await ctx.dispose()
})

test('a signed-in visitor is bounced off the sign-in page', async ({ page }) => {
  const email = tempEmail('otp-bounce')

  await page.goto('/en/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByLabel('Code')).toHaveValue(/^\d{6}$/)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/today$/)

  // Middleware's AUTH_ONLY list has to know about /auth too, or a signed-in user
  // could sit on a sign-in form and mint a second session for another account.
  await page.goto('/en/auth')
  await expect(page).toHaveURL(/\/en\/today$/)
})
