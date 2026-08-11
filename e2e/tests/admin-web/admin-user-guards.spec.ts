import { expect, test, type APIRequestContext } from '@playwright/test'
import { FIXTURE_PASSWORD, STORAGE } from '../../src/env'
import { expectApiError, jsonOf, tempEmail } from '../../src/http'
import {
  createAppUser,
  expectAudited,
  findAdminUser,
  listAdminUsers,
  type AdminUser,
} from '../../src/flows'

/**
 * The guard rails on privileged mutations. Each of these is one `if` in a route
 * handler, and each of them is the difference between "a mistake" and "nobody can
 * administer this system any more".
 */
test.use({ storageState: STORAGE.superAdmin })

async function self(request: APIRequestContext): Promise<AdminUser> {
  const page = await listAdminUsers(request, { pageSize: 100 })
  const me = page.items.find((item) => item.isSelf)
  if (!me) throw new Error('the signed-in super admin should appear in its own list')
  return me
}

test('a super admin cannot lock itself out', async ({ request }) => {
  const me = await self(request)

  await expectApiError(
    await request.post('/api/admin-users/status', {
      data: { userId: me.id, status: 'disabled' },
    }),
    403,
    'FORBIDDEN',
  )

  await expectApiError(
    await request.post('/api/admin-users/role', { data: { userId: me.id, role: 'operator' } }),
    403,
    'FORBIDDEN',
  )

  // Still standing afterwards — the refusal must not be a partial write.
  expect((await self(request)).role).toBe('super_admin')
  expect((await self(request)).status).toBe('active')
})

test('creating, re-roling and disabling a backoffice user is audited at every step', async ({
  request,
}) => {
  const email = tempEmail('adm')

  const created = await jsonOf<{ user: AdminUser }>(
    await request.post('/api/admin-users/create', {
      data: { email, password: FIXTURE_PASSWORD, name: 'E2E Temp Admin', role: 'operator' },
    }),
    200,
  )
  const audit = await expectAudited(request, 'ADMIN_USER_CREATE', created.user.id)
  expect(audit.meta).toMatchObject({ role: 'operator', promotedExistingUser: false })

  const promoted = await jsonOf<{ changed: boolean }>(
    await request.post('/api/admin-users/role', {
      data: { userId: created.user.id, role: 'super_admin' },
    }),
    200,
  )
  expect(promoted.changed).toBe(true)
  expect(
    (await expectAudited(request, 'ADMIN_USER_UPDATE_ROLE', created.user.id)).meta,
  ).toMatchObject({ before: { role: 'operator' }, after: { role: 'super_admin' } })

  // There is no hard delete: park the account disabled, the way an operator would.
  await jsonOf(
    await request.post('/api/admin-users/status', {
      data: { userId: created.user.id, status: 'disabled' },
    }),
    200,
  )
  await expectAudited(request, 'ADMIN_USER_DISABLE', created.user.id)

  const after = await findAdminUser(request, email)
  expect(after?.status).toBe('disabled')
})

test('an existing APP user is promoted, not duplicated', async ({ request }) => {
  // SPEC §7 — the same person may be both an APP user and an admin, so this path
  // attaches an AdminProfile to the row that already exists.
  const email = tempEmail('promote')
  const appUser = await createAppUser(request, { email, password: FIXTURE_PASSWORD })

  const promoted = await jsonOf<{ user: AdminUser }>(
    await request.post('/api/admin-users/create', {
      data: { email, password: FIXTURE_PASSWORD, role: 'operator' },
    }),
    200,
  )

  // Same row, now wearing an AdminProfile.
  expect(promoted.user.id).toBe(appUser.id)
  const audit = await expectAudited(request, 'ADMIN_USER_CREATE', appUser.id)
  expect(audit.meta).toMatchObject({ promotedExistingUser: true })

  // …and it has left the APP-user list, because that list is "User without AdminProfile".
  const admins = await findAdminUser(request, email)
  expect(admins?.role).toBe('operator')

  await jsonOf(
    await request.post('/api/admin-users/status', {
      data: { userId: appUser.id, status: 'disabled' },
    }),
    200,
  )
})

test('a second attempt to make the same person an admin is refused', async ({ request }) => {
  const existing = await self(request)

  await expectApiError(
    await request.post('/api/admin-users/create', {
      data: { email: existing.email, password: FIXTURE_PASSWORD, role: 'operator' },
    }),
    409,
    'EMAIL_TAKEN',
  )
})
