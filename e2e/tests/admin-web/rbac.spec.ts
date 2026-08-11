import { expect, test } from '@playwright/test'
import { ADMIN_URL, FIXTURE_PASSWORD, STORAGE } from '../../src/env'
import { apiContext, expectApiError, jsonOf, tempEmail } from '../../src/http'
import { listAppUsers } from '../../src/flows'

/**
 * SPEC §1.7 — the three RBAC layers must agree. `rbac.ts` is a single matrix, but
 * "the menu can never advertise something the API rejects" is a claim about three
 * separate code paths (middleware on the Edge, `requireApiAdmin` in Node, and the
 * rendered sidebar), and only an end-to-end run exercises all three.
 */

test.describe('anonymous', () => {
  test('every console API answers 401, with the envelope', async () => {
    const ctx = await apiContext(ADMIN_URL)

    for (const path of [
      '/api/dashboard',
      '/api/app-users',
      '/api/admin-users',
      '/api/audit-logs',
    ]) {
      await expectApiError(await ctx.get(path), 401, 'UNAUTHORIZED')
    }

    await ctx.dispose()
  })

  test('a console page redirects to login instead of rendering', async ({ page }) => {
    await page.goto('/en/app-users')
    await expect(page).toHaveURL(/\/en\/login/)
  })
})

test.describe('operator', () => {
  test.use({ storageState: STORAGE.operator })

  test('may manage APP users', async ({ request }) => {
    const email = tempEmail('by-operator')

    await jsonOf(
      await request.post('/api/app-users/create', { data: { email, password: FIXTURE_PASSWORD } }),
      200,
    )
    expect((await listAppUsers(request, { q: email })).items).toHaveLength(1)

    // Audit is readable by an operator — it is the accountability trail, and
    // hiding it from the people being audited would defeat the purpose.
    await jsonOf(await request.get('/api/audit-logs'), 200)
  })

  test('is refused every backoffice-user endpoint with a real 403', async ({ request }) => {
    await expectApiError(await request.get('/api/admin-users'), 403, 'FORBIDDEN')

    await expectApiError(
      await request.post('/api/admin-users/create', {
        data: { email: tempEmail('escalate'), password: FIXTURE_PASSWORD, role: 'super_admin' },
      }),
      403,
      'FORBIDDEN',
    )

    await expectApiError(
      await request.post('/api/admin-users/role', {
        data: { userId: 'whatever', role: 'super_admin' },
      }),
      403,
      'FORBIDDEN',
    )

    await expectApiError(
      await request.post('/api/admin-users/status', {
        data: { userId: 'whatever', status: 'disabled' },
      }),
      403,
      'FORBIDDEN',
    )
  })

  test('cannot navigate to /admin-users, and the sidebar does not offer it', async ({ page }) => {
    await page.goto('/en/dashboard')
    await expect(page.getByRole('link', { name: 'APP users' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Admin users' })).toHaveCount(0)

    await page.goto('/en/admin-users')
    await expect(page).toHaveURL(/\/en\/dashboard\?denied=1$/)
  })
})

test.describe('super admin', () => {
  test.use({ storageState: STORAGE.superAdmin })

  test('reaches every endpoint the sidebar offers', async ({ request }) => {
    for (const path of [
      '/api/dashboard',
      '/api/app-users',
      '/api/admin-users',
      '/api/audit-logs',
    ]) {
      await jsonOf(await request.get(path), 200)
    }
  })

  test('sees the full sidebar', async ({ page }) => {
    await page.goto('/en/dashboard')
    for (const item of ['Dashboard', 'APP users', 'Admin users', 'Audit log']) {
      await expect(page.getByRole('link', { name: item })).toBeVisible()
    }
  })
})
