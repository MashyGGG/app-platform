import type { AdminRoleName } from '@app/shared'

/**
 * Role/permission matrix — SPEC §1.7. Single source of truth for all three
 * enforcement layers (middleware route gate, API gate, UI visibility), so the
 * UI can never advertise something the API would reject and vice versa.
 */
export const PERMISSIONS = {
  'dashboard.view': ['super_admin', 'operator'],
  'appUser.view': ['super_admin', 'operator'],
  'appUser.create': ['super_admin', 'operator'],
  'appUser.update': ['super_admin', 'operator'],
  'appUser.setStatus': ['super_admin', 'operator'],
  'adminUser.view': ['super_admin'],
  'adminUser.create': ['super_admin'],
  'adminUser.updateRole': ['super_admin'],
  'adminUser.setStatus': ['super_admin'],
  'audit.view': ['super_admin', 'operator'],
  // Nobody may delete audit rows — the capability simply does not exist.
} as const satisfies Record<string, readonly AdminRoleName[]>

export type Permission = keyof typeof PERMISSIONS

export function can(role: AdminRoleName, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly AdminRoleName[]).includes(role)
}

/** Route prefixes (locale-stripped) that require a specific permission. */
export const ROUTE_PERMISSIONS: ReadonlyArray<{ prefix: string; permission: Permission }> = [
  { prefix: '/admin-users', permission: 'adminUser.view' },
  { prefix: '/app-users', permission: 'appUser.view' },
  { prefix: '/audit-logs', permission: 'audit.view' },
  { prefix: '/dashboard', permission: 'dashboard.view' },
]

export const CONSOLE_PREFIXES = ROUTE_PERMISSIONS.map((r) => r.prefix)
