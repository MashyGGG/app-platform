import { existsSync } from 'node:fs'
import { ADMIN_URL, STORAGE, TEMP_PREFIX } from '../src/env'
import { apiContext } from '../src/http'
import { listAppUsers, setAppUserStatus } from '../src/flows'

/**
 * Leaves the database in the state the product defines as "removed": there is no
 * hard-delete endpoint anywhere (a deliberate product decision), so the suite
 * cleans up the only way an operator could — by disabling its throwaway accounts.
 *
 * Their rows and the audit trail they generated stay, on purpose: `AuditLog` is
 * append-only, and a test suite that could erase audit rows would be proof the
 * invariant is breakable.
 *
 * Never fails the run: a cleanup problem is not a product defect, and masking a
 * real failure behind a teardown error would be worse than a few stale rows.
 */
export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STORAGE.superAdmin)) return

  const admin = await apiContext(ADMIN_URL, { storageState: STORAGE.superAdmin })
  try {
    const page = await listAppUsers(admin, { q: TEMP_PREFIX, status: 'active', pageSize: 100 })
    const stale = page.items.filter((user) => user.email.startsWith(TEMP_PREFIX))

    for (const user of stale) {
      await setAppUserStatus(admin, user.id, 'disabled')
    }

    if (stale.length > 0) {
      console.info(`[e2e] disabled ${stale.length} throwaway account(s)`)
    }
  } catch (error) {
    console.warn('[e2e] teardown could not disable throwaway accounts:', error)
  } finally {
    await admin.dispose()
  }
}
