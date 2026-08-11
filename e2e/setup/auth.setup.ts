import { test as setup, expect } from '@playwright/test'
import { ADMIN_URL, APP_ACTOR, APP_URL, OPERATOR, STORAGE, SUPER_ADMIN } from '../src/env'
import { apiContext, jsonOf } from '../src/http'
import { createAppUser, findAdminUser, findAppUser, setAppUserStatus, signIn } from '../src/flows'

/**
 * Signs in the three actors once per run and parks their cookie jars on disk, so
 * ~20 specs don't pay for ~20 argon2id verifications (deliberately slow) and
 * don't spend the login rate-limit budget.
 *
 * The two fixture accounts are created through the console's OWN endpoints — no
 * direct database writes anywhere in this suite. That costs a few requests here
 * and buys the guarantee that the suite can only ever assert things a real
 * operator could do.
 *
 * Strictly ordered: the two fixture accounts are created *through the console*,
 * so they need the super admin's cookie jar to exist on disk first.
 */
setup.describe.configure({ mode: 'serial' })

/**
 * Identity probe. `E2E_REUSE=1` (and any port mix-up) can point the suite at
 * something that merely answers on :3000 — another project's dev server will
 * happily serve a 404 page for `/en/login`, and every later failure then reads
 * as a product bug. Two requests here make that impossible to misread.
 */
setup('the apps under test are the right apps', async () => {
  for (const [name, base, path] of [
    ['app-web', APP_URL, '/api/me'],
    ['admin-web', ADMIN_URL, '/api/dashboard'],
  ] as const) {
    const ctx = await apiContext(base)
    const res = await ctx.get(path)
    const body = await res.text()
    expect(
      { status: res.status(), body },
      `${base} does not look like ${name}: an unauthenticated GET ${path} must be ` +
        `a 401 carrying this platform's error envelope. Something else is serving ` +
        `that port — set E2E_APP_URL / E2E_ADMIN_URL, or stop the other server.`,
    ).toEqual({ status: 401, body: expect.stringContaining('errors.unauthorized') })
    await ctx.dispose()
  }
})

setup('super admin signs in', async () => {
  const ctx = await apiContext(ADMIN_URL)
  await signIn(ctx, SUPER_ADMIN)
  await ctx.storageState({ path: STORAGE.superAdmin })
  await ctx.dispose()
})

setup('operator exists and signs in', async () => {
  const admin = await apiContext(ADMIN_URL, { storageState: STORAGE.superAdmin })

  const existing = await findAdminUser(admin, OPERATOR.email)

  if (!existing) {
    await jsonOf(
      await admin.post('/api/admin-users/create', {
        data: { ...OPERATOR, name: 'E2E Operator', role: 'operator' },
      }),
      200,
    )
  } else {
    // Repair whatever a previous run left behind: a spec may legitimately have
    // demoted or disabled this account.
    if (existing.role !== 'operator') {
      await jsonOf(
        await admin.post('/api/admin-users/role', {
          data: { userId: existing.id, role: 'operator' },
        }),
        200,
      )
    }
    if (existing.status !== 'active') {
      await jsonOf(
        await admin.post('/api/admin-users/status', {
          data: { userId: existing.id, status: 'active' },
        }),
        200,
      )
    }
  }

  await admin.dispose()

  const ctx = await apiContext(ADMIN_URL)
  const res = await ctx.post('/api/auth/login', { data: OPERATOR })
  expect(
    res.status(),
    `${OPERATOR.email} exists but its password is not the fixture one. There is no ` +
      `password-reset endpoint by design — delete that row from your local database ` +
      `and re-run. (server said: ${await res.text()})`,
  ).toBe(200)
  await ctx.storageState({ path: STORAGE.operator })
  await ctx.dispose()
})

setup('app actor exists and signs in', async () => {
  const admin = await apiContext(ADMIN_URL, { storageState: STORAGE.superAdmin })

  const existing = await findAppUser(admin, APP_ACTOR.email)
  if (!existing) {
    await createAppUser(admin, { ...APP_ACTOR, name: 'E2E App User', locale: 'en' })
  } else if (existing.status !== 'active') {
    await setAppUserStatus(admin, existing.id, 'active')
  }

  await admin.dispose()

  const ctx = await apiContext(APP_URL)
  const res = await ctx.post('/api/auth/login', { data: APP_ACTOR })
  expect(
    res.status(),
    `${APP_ACTOR.email} exists but its password is not the fixture one — delete ` +
      `that row from your local database and re-run. (server said: ${await res.text()})`,
  ).toBe(200)
  await ctx.storageState({ path: STORAGE.appActor })
  await ctx.dispose()
})
