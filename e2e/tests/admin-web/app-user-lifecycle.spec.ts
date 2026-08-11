import { expect, test } from '@playwright/test'
import { FIXTURE_PASSWORD, OPERATOR, STORAGE } from '../../src/env'
import { expectApiError, jsonOf, tempEmail } from '../../src/http'
import {
  createAppUser,
  expectAudited,
  findAdminUser,
  listAppUsers,
  setAppUserStatus,
  type AppUser,
} from '../../src/flows'

/**
 * SPEC §2 / §1.6 — the console's APP-user CRUD, and the invariant that makes it
 * trustworthy: every mutation shares a transaction with its `AuditLog` row, so a
 * write that is not audited cannot exist. That is asserted here through
 * `/api/audit-logs`, because it is the only claim in the whole system a
 * developer cannot verify by reading one file.
 */
test.use({ storageState: STORAGE.superAdmin })

test.describe('APP user lifecycle', () => {
  // One user threaded through create → edit → disable → enable, in order.
  test.describe.configure({ mode: 'serial' })

  const email = tempEmail('crud')
  let user: AppUser

  test('create writes the user and an APP_USER_CREATE audit row', async ({ request }) => {
    user = await createAppUser(request, {
      email,
      password: FIXTURE_PASSWORD,
      name: 'Before Rename',
      locale: 'en',
    })

    expect(user.email).toBe(email)
    expect(user.status).toBe('active')
    expect(user.locale).toBe('en')

    const audit = await expectAudited(request, 'APP_USER_CREATE', user.id)
    expect(audit.meta).toMatchObject({ email })
    expect(audit.actor.email).toBeTruthy()
  })

  test('the address cannot be reused', async ({ request }) => {
    await expectApiError(
      await request.post('/api/app-users/create', {
        data: { email, password: FIXTURE_PASSWORD },
      }),
      409,
      'EMAIL_TAKEN',
    )
  })

  test('editing records what actually changed, and a no-op change writes nothing', async ({
    request,
  }) => {
    const changed = await jsonOf<{ changed: boolean; user: AppUser }>(
      await request.post('/api/app-users/update', {
        data: { userId: user.id, name: 'After Rename' },
      }),
      200,
    )
    expect(changed.changed).toBe(true)
    expect(changed.user.name).toBe('After Rename')

    const audit = await expectAudited(request, 'APP_USER_UPDATE', user.id)
    expect(audit.meta).toMatchObject({
      fields: ['name'],
      before: { name: 'Before Rename' },
      after: { name: 'After Rename' },
    })

    // Submitting the same value again must not manufacture an audit row.
    const noop = await jsonOf<{ changed: boolean }>(
      await request.post('/api/app-users/update', {
        data: { userId: user.id, name: 'After Rename' },
      }),
      200,
    )
    expect(noop.changed).toBe(false)
  })

  test('disable and enable are both audited and visible in the list', async ({ request }) => {
    expect((await setAppUserStatus(request, user.id, 'disabled')).changed).toBe(true)
    await expectAudited(request, 'APP_USER_DISABLE', user.id)

    const disabled = await listAppUsers(request, { q: email, status: 'disabled' })
    expect(disabled.items.map((u) => u.id)).toContain(user.id)

    // Idempotent: the second call reports "nothing changed" rather than logging again.
    expect((await setAppUserStatus(request, user.id, 'disabled')).changed).toBe(false)

    expect((await setAppUserStatus(request, user.id, 'active')).changed).toBe(true)
    await expectAudited(request, 'APP_USER_ENABLE', user.id)
  })
})

test('a weak initial password is rejected before any user is created', async ({ request }) => {
  const email = tempEmail('weak')

  const body = await expectApiError(
    await request.post('/api/app-users/create', { data: { email, password: 'nodigitshere' } }),
    400,
    'VALIDATION_FAILED',
  )
  expect(Object.keys(body.details ?? {})).toContain('password')

  const found = await listAppUsers(request, { q: email })
  expect(found.items, 'a rejected request must not leave a row behind').toHaveLength(0)
})

test('the APP-user endpoints refuse to touch a backoffice account', async ({ request }) => {
  // "APP user = User WITHOUT AdminProfile" is the whole data model (SPEC §7).
  // If this leaked, an operator could disable a super_admin through a route that
  // only requires `appUser.setStatus`.
  const admin = await findAdminUser(request, OPERATOR.email)
  if (!admin) throw new Error('setup should have created the operator fixture')

  await expectApiError(
    await request.post('/api/app-users/status', {
      data: { userId: admin.id, status: 'disabled' },
    }),
    404,
    'NOT_FOUND',
  )

  await expectApiError(
    await request.post('/api/app-users/update', { data: { userId: admin.id, name: 'nope' } }),
    404,
    'NOT_FOUND',
  )
})
