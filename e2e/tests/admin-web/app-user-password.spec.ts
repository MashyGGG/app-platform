import { expect, test } from '@playwright/test'
import { APP_URL, FIXTURE_PASSWORD, OPERATOR, STORAGE } from '../../src/env'
import { apiContext, expectApiError, tempEmail } from '../../src/http'
import { createAppUser, expectAudited, findAdminUser, resetAppUserPassword } from '../../src/flows'

/**
 * SPEC §1.7 — the console's password reset, the one `appUser.*` capability an
 * operator does not hold.
 *
 * The claim worth an end-to-end run is not "the route answers 200": it is that
 * the write reaches the *other* app's login path — a different process, a
 * different cookie, a different secret — and that the audit trail records it
 * without ever recording the password itself.
 */

const NEW_PASSWORD = 'E2eReset!9876'

test.describe('super admin', () => {
  test.use({ storageState: STORAGE.superAdmin })

  test('a reset replaces the password app-web accepts, and is audited', async ({ request }) => {
    const email = tempEmail('pwd')
    const user = await createAppUser(request, { email, password: FIXTURE_PASSWORD })

    // Baseline: the original password works before we touch anything, so a
    // failure after the reset cannot be blamed on the fixture.
    const before = await apiContext(APP_URL)
    expect(
      (
        await before.post('/api/auth/login', { data: { email, password: FIXTURE_PASSWORD } })
      ).status(),
    ).toBe(200)
    await before.dispose()

    await resetAppUserPassword(request, user.id, NEW_PASSWORD)

    // A fresh context each time: each carries its own cookie jar and its own
    // rate-limit IP, so the two attempts below cannot influence each other.
    const stale = await apiContext(APP_URL)
    await expectApiError(
      await stale.post('/api/auth/login', { data: { email, password: FIXTURE_PASSWORD } }),
      401,
      'INVALID_CREDENTIALS',
    )
    await stale.dispose()

    const fresh = await apiContext(APP_URL)
    expect(
      (await fresh.post('/api/auth/login', { data: { email, password: NEW_PASSWORD } })).status(),
    ).toBe(200)
    await fresh.dispose()

    const audit = await expectAudited(request, 'APP_USER_PASSWORD_RESET', user.id)
    expect(audit.actor.email).toBeTruthy()
    // The audit table is append-only and readable by every operator, so a
    // password landing in `meta` could never be taken back out.
    expect(JSON.stringify(audit.meta)).not.toContain(NEW_PASSWORD)
    expect(JSON.stringify(audit.meta)).not.toContain(FIXTURE_PASSWORD)
  })

  test('a weak password is rejected and the old one still works', async ({ request }) => {
    const email = tempEmail('pwd-weak')
    const user = await createAppUser(request, { email, password: FIXTURE_PASSWORD })

    const body = await expectApiError(
      await request.post('/api/app-users/password', {
        data: { userId: user.id, password: 'nodigitshere' },
      }),
      400,
      'VALIDATION_FAILED',
    )
    expect(Object.keys(body.details ?? {})).toContain('password')

    const ctx = await apiContext(APP_URL)
    expect(
      (await ctx.post('/api/auth/login', { data: { email, password: FIXTURE_PASSWORD } })).status(),
    ).toBe(200)
    await ctx.dispose()
  })

  test('refuses to reset a backoffice account through the APP-user route', async ({ request }) => {
    // "APP user = User WITHOUT AdminProfile" (SPEC §7). Otherwise this route
    // would be a way to take over an admin without touching /api/admin-users.
    const admin = await findAdminUser(request, OPERATOR.email)
    if (!admin) throw new Error('setup should have created the operator fixture')

    await expectApiError(
      await request.post('/api/app-users/password', {
        data: { userId: admin.id, password: NEW_PASSWORD },
      }),
      404,
      'NOT_FOUND',
    )
  })
})

test.describe('operator', () => {
  test.use({ storageState: STORAGE.operator })

  test('is refused the password route with a real 403', async ({ request }) => {
    // Not 404: the gate runs before the target is looked up, so an operator
    // cannot use this endpoint to probe which user ids exist.
    await expectApiError(
      await request.post('/api/app-users/password', {
        data: { userId: 'whatever', password: NEW_PASSWORD },
      }),
      403,
      'FORBIDDEN',
    )
  })

  test('the APP-user table does not offer the action', async ({ page }) => {
    await page.goto('/en/app-users')
    await expect(page.getByRole('button', { name: 'Edit' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0)
  })
})
