import { expect, test } from '@playwright/test'
import { FIXTURE_PASSWORD } from '../../src/env'
import { tempEmail, uniqueIp } from '../../src/http'
import { sessionCookie } from '../../src/cookies'

/**
 * AC-1 / AC-5 — the one journey a user cannot avoid, driven through the real UI
 * (antd form → route handler → Auth.js → argon2 → Prisma → server-rendered
 * /home). Contract-level edge cases live in `login-contract.spec.ts`; this file
 * only proves the wiring, including that a `messageKey` reaches the user as
 * translated prose.
 *
 * `/en` rather than the default `/zh` so the selectors read clearly and a change
 * to the Chinese copy cannot break the test.
 *
 * One IP for the whole file, claimed at load time: registration is throttled at
 * 5/hour per address, and this file spends exactly one of those.
 */
test.use({ extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() } })

test('register signs you straight in, and survives a sign-out / sign-in round trip', async ({
  page,
  context,
}) => {
  const email = tempEmail('reg')

  await page.goto('/en/register')
  await page.getByLabel('Display name').fill('E2E Newcomer')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()

  // Registration must sign the user in itself — no second trip through /login.
  await expect(page).toHaveURL(/\/en\/home$/)
  await expect(page.getByText('Hello World')).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByText('Active')).toBeVisible()
  expect(await sessionCookie(context, 'app')).toBeTruthy()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/en\/login/)
  expect(await sessionCookie(context, 'app')).toBeUndefined()

  // With no cookie at all, layer 1 (middleware) is enough to bounce /home.
  await page.goto('/en/home')
  await expect(page).toHaveURL(/\/en\/login/)

  // A wrong password must surface as translated copy, never as a raw code.
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('WrongPassword1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Incorrect email or password.')).toBeVisible()

  await page.getByLabel('Password', { exact: true }).fill(FIXTURE_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/en\/home$/)
  await expect(page.getByText(email)).toBeVisible()
})
