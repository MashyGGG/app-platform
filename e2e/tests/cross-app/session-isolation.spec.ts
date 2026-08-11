import { expect, request, test } from '@playwright/test'
import { ADMIN_URL, APP_ACTOR, APP_URL, STORAGE, SUPER_ADMIN } from '../../src/env'
import { apiContext, expectApiError, uniqueIp } from '../../src/http'
import { signIn } from '../../src/flows'
import { replayedAs, sessionCookie, type StoredCookie } from '../../src/cookies'

/**
 * ===========================================================================
 * README invariant 4 — an app-web session can never be replayed against the
 * console, and vice versa.
 * ===========================================================================
 * Two things enforce it: different cookie NAMES and different `AUTH_SECRET`s.
 * The names alone would be security theatre, because both apps are served from
 * the same host in development and cookies ignore the port — so the browser
 * hands admin-web every app-web cookie it holds anyway.
 *
 * These tests strip the naming away and replay the token bytes under the other
 * app's cookie name. What must stop it then is the secret: the JWT is encrypted,
 * and admin-web cannot decrypt what app-web sealed. If somebody ever "simplifies"
 * the two secrets into one shared `AUTH_SECRET`, this file is what fails.
 */

async function contextWithCookie(baseURL: string, cookie: StoredCookie) {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() },
    storageState: { cookies: [cookie], origins: [] },
  })
}

test('an app-web session cannot be replayed against the console', async () => {
  const app = await apiContext(APP_URL)
  await signIn(app, APP_ACTOR)

  const cookie = await sessionCookie(app, 'app')
  if (!cookie) throw new Error('signing in to app-web should have produced a session cookie')

  const impostor = await contextWithCookie(ADMIN_URL, replayedAs(cookie, 'admin'))
  await expectApiError(await impostor.get('/api/dashboard'), 401, 'UNAUTHORIZED')
  await expectApiError(await impostor.get('/api/app-users'), 401, 'UNAUTHORIZED')

  await impostor.dispose()
  await app.dispose()
})

test('a console session cannot be replayed against app-web', async () => {
  const admin = await apiContext(ADMIN_URL)
  await signIn(admin, SUPER_ADMIN)

  const cookie = await sessionCookie(admin, 'admin')
  if (!cookie) throw new Error('signing in to admin-web should have produced a session cookie')

  const impostor = await contextWithCookie(APP_URL, replayedAs(cookie, 'app'))
  await expectApiError(await impostor.get('/api/me'), 401, 'UNAUTHORIZED')

  await impostor.dispose()
  await admin.dispose()
})

test('the console refuses an APP user who has valid credentials', async () => {
  // AC-6 — the fixture APP user's password is correct; what it lacks is an
  // AdminProfile. Credentials are not the authorisation.
  const ctx = await apiContext(ADMIN_URL)
  await expectApiError(await ctx.post('/api/auth/login', { data: APP_ACTOR }), 403, 'FORBIDDEN')

  const cookies = (await ctx.storageState()).cookies
  expect(cookies, 'a refused sign-in must not leave any cookie behind').toHaveLength(0)

  await ctx.dispose()
})

test('the two apps hold independent sessions in one browser', async ({ browser }) => {
  // Both apps live on `localhost` in development, so the browser sends every
  // cookie it holds to both. Signing in to one must not affect the other.
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': uniqueIp() },
    storageState: STORAGE.appActor,
  })

  const page = await context.newPage()
  await page.goto(`${APP_URL}/en/home`)
  await expect(page.getByText(APP_ACTOR.email)).toBeVisible()

  // Same browser, same host, different port — and still not signed in.
  await page.goto(`${ADMIN_URL}/en/dashboard`)
  await expect(page).toHaveURL(/\/en\/login/)

  await context.close()
})
