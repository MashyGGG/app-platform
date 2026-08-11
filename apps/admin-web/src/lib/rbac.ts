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

export interface ConsoleRoute {
  /** Locale from the first path segment, or `defaultLocale` when there isn't one. */
  locale: string
  /** The path with the locale segment and one trailing slash removed; `''` at the root. */
  rest: string
  /** The rule guarding `rest`, or `undefined` for an ungated path. */
  rule: (typeof ROUTE_PERMISSIONS)[number] | undefined
}

/**
 * Splits a request path into `{ locale, rest, rule }` for the middleware gate.
 *
 * Extracted from `middleware.ts` so it can be unit-tested: inside the
 * `authEdge()` callback none of this was reachable without booting Next, and it
 * is the one piece of branching logic in the RBAC layer. The locale list is a
 * parameter rather than an import so the function stays free of `next-intl`.
 *
 * `rest.startsWith(`${prefix}/`)` — not `startsWith(prefix)` — is deliberate:
 * the looser form would gate `/app-users-export` under `/app-users`, and, worse,
 * a future unrelated `/dashboard-public` route would silently require a login.
 */
export function resolveConsoleRoute(
  pathname: string,
  locales: readonly string[],
  defaultLocale: string,
): ConsoleRoute {
  const segments = pathname.split('/')
  const maybeLocale = segments[1]
  const hasLocale = !!maybeLocale && locales.includes(maybeLocale)
  const rest = `/${segments.slice(hasLocale ? 2 : 1).join('/')}`.replace(/\/$/, '')

  return {
    locale: hasLocale ? maybeLocale : defaultLocale,
    rest,
    rule: ROUTE_PERMISSIONS.find(
      (rule) => rest === rule.prefix || rest.startsWith(`${rule.prefix}/`),
    ),
  }
}
