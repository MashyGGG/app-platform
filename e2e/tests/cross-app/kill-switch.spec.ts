import { expect, test } from '@playwright/test'
import { ADMIN_URL, APP_URL, FIXTURE_PASSWORD, STORAGE } from '../../src/env'
import { apiContext, expectApiError, tempEmail, uniqueIp } from '../../src/http'
import { createAppUser, setAppUserStatus, signIn } from '../../src/flows'
import { sessionCookie } from '../../src/cookies'

/**
 * ===========================================================================
 * AC-8 — the flagship end-to-end test: the kill switch actually kills.
 * ===========================================================================
 * Sessions are JWTs, so nothing on the app-web side *expires* when an admin
 * disables an account. What makes disabling take effect immediately is that
 * every protected render and every protected API re-reads `User.status` from
 * PostgreSQL (`getVerifiedUser()`), and that the redirect target destroys the
 * cookie on the way out.
 *
 * This spans two applications, two cookie names, two `AUTH_SECRET`s, the Edge
 * middleware and the Node session layer. No unit or integration test can make
 * this claim — mock any one of those pieces and the test proves nothing.
 */

test('disabling an APP user invalidates their live session on the very next request', async ({
  browser,
}) => {
  const email = tempEmail('kill')
  const admin = await apiContext(ADMIN_URL, { storageState: STORAGE.superAdmin })
  const user = await createAppUser(admin, { email, password: FIXTURE_PASSWORD, locale: 'en' })

  const session = await browser.newContext({
    baseURL: APP_URL,
    extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() },
  })
  await signIn(session.request, { email, password: FIXTURE_PASSWORD })

  const page = await session.newPage()
  await page.goto('/en/home')
  await expect(page.getByText(email)).toBeVisible()

  const before = await sessionCookie(session, 'app')
  expect(before, 'the user should be holding a session cookie at this point').toBeTruthy()

  // --- the backoffice pulls the plug -------------------------------------
  expect((await setAppUserStatus(admin, user.id, 'disabled')).changed).toBe(true)

  // The JWT in the cookie is still perfectly valid and unexpired. It no longer
  // buys anything, because the database is the authority.
  await expectApiError(await session.request.get('/api/me'), 401, 'UNAUTHORIZED')

  await page.reload()
  await expect(page).toHaveURL(/\/en\/login/)
  expect(
    await sessionCookie(session, 'app'),
    'the rejected session must be destroyed, not merely refused',
  ).toBeUndefined()

  // --- and they cannot mint a new one ------------------------------------
  const retry = await apiContext(APP_URL)
  await expectApiError(
    await retry.post('/api/auth/login', { data: { email, password: FIXTURE_PASSWORD } }),
    403,
    'ACCOUNT_DISABLED',
  )

  // --- re-enabling restores access, no support ticket required -----------
  expect((await setAppUserStatus(admin, user.id, 'active')).changed).toBe(true)
  const again = await apiContext(APP_URL)
  await signIn(again, { email, password: FIXTURE_PASSWORD })

  await retry.dispose()
  await again.dispose()
  await session.close()
  await admin.dispose()
})
