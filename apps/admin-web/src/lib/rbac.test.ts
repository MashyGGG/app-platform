import { describe, expect, it } from 'vitest'
import type { AdminRoleName } from '@app/shared'
import {
  CONSOLE_PREFIXES,
  PERMISSIONS,
  type Permission,
  ROUTE_PERMISSIONS,
  can,
  resolveConsoleRoute,
} from './rbac'

const LOCALES = ['zh', 'en'] as const
const DEFAULT_LOCALE = 'zh'
const route = (pathname: string) => resolveConsoleRoute(pathname, LOCALES, DEFAULT_LOCALE)

const ROLES: AdminRoleName[] = ['super_admin', 'operator']
const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

describe('can', () => {
  it('gives super_admin everything', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(can('super_admin', permission), permission).toBe(true)
    }
  })

  it('withholds every adminUser.* capability from an operator', () => {
    // SPEC §1.7. The E2E suite proves the four HTTP endpoints answer 403; this
    // pins the matrix those endpoints read, so a fifth admin-user capability
    // added later cannot default to open without failing here.
    const adminOnly = ALL_PERMISSIONS.filter((p) => p.startsWith('adminUser.'))
    expect(adminOnly).toHaveLength(4)
    for (const permission of adminOnly) {
      expect(can('operator', permission), permission).toBe(false)
    }
  })

  it('lets an operator run the APP-user console and read the audit log', () => {
    for (const permission of [
      'dashboard.view',
      'appUser.view',
      'appUser.create',
      'appUser.update',
      'appUser.setStatus',
      'audit.view',
    ] as const) {
      expect(can('operator', permission), permission).toBe(true)
    }
  })

  it('withholds password reset from an operator, alone among appUser.*', () => {
    // The one asymmetric capability in the `appUser.*` family: an operator runs
    // the whole APP-user console but cannot mint credentials for someone else's
    // account. If a future edit widens this to `operator`, the failure should be
    // here rather than in production.
    expect(can('operator', 'appUser.resetPassword')).toBe(false)
    expect(can('super_admin', 'appUser.resetPassword')).toBe(true)

    const appUserOnly = ALL_PERMISSIONS.filter((p) => p.startsWith('appUser.'))
    expect(appUserOnly.filter((p) => !can('operator', p))).toEqual(['appUser.resetPassword'])
  })

  it('grants nothing to a role that is not in the matrix', () => {
    // Defensive: a JWT minted before a role was renamed still decodes, and the
    // claim reaches `can()` as a plain string.
    expect(can('viewer' as AdminRoleName, 'dashboard.view')).toBe(false)
  })

  it('has no permission that nobody holds and none that is spelled oddly', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(
        ROLES.some((role) => can(role, permission)),
        permission,
      ).toBe(true)
      expect(permission).toMatch(/^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/)
    }
  })
})

describe('ROUTE_PERMISSIONS', () => {
  it('only references permissions that exist', () => {
    // A typo here is the dangerous case: `PERMISSIONS[undefined]` makes `can()`
    // throw on every request to that route, or — with a loose lookup — waves it
    // through. TypeScript covers a literal typo; this also covers a permission
    // that gets *removed* from the matrix while a route still asks for it.
    for (const rule of ROUTE_PERMISSIONS) {
      expect(ALL_PERMISSIONS, rule.prefix).toContain(rule.permission)
    }
  })

  it('lists every console prefix exactly once, each rooted at /', () => {
    expect(new Set(CONSOLE_PREFIXES).size).toBe(CONSOLE_PREFIXES.length)
    for (const prefix of CONSOLE_PREFIXES) {
      expect(prefix).toMatch(/^\/[a-z-]+$/)
    }
  })

  it('has no prefix that is a prefix of another', () => {
    // `/app-users` and `/app-users-archive` would both match the first rule
    // under a naive check; keeping the list free of nesting means the order of
    // `find()` can never matter.
    for (const a of CONSOLE_PREFIXES) {
      for (const b of CONSOLE_PREFIXES) {
        if (a !== b) expect(b.startsWith(`${a}/`), `${b} nests under ${a}`).toBe(false)
      }
    }
  })
})

describe('resolveConsoleRoute', () => {
  it('strips a locale prefix and finds the rule', () => {
    expect(route('/en/admin-users')).toEqual({
      locale: 'en',
      rest: '/admin-users',
      rule: { prefix: '/admin-users', permission: 'adminUser.view' },
    })
  })

  it('gates a path that carries no locale, defaulting the locale for the redirect', () => {
    // The redirect target is built from this locale, so getting it wrong sends a
    // denied user to a 404 instead of the dashboard.
    const resolved = route('/admin-users')
    expect(resolved.locale).toBe(DEFAULT_LOCALE)
    expect(resolved.rest).toBe('/admin-users')
    expect(resolved.rule?.permission).toBe('adminUser.view')
  })

  it('gates nested paths under a guarded prefix', () => {
    expect(route('/zh/app-users/clx123/edit').rule?.permission).toBe('appUser.view')
    expect(route('/en/audit-logs/page/2').rule?.permission).toBe('audit.view')
  })

  it('does NOT gate a sibling path that merely starts with the same characters', () => {
    // This is what `startsWith(`${prefix}/`)` buys, and the reason it must not be
    // relaxed to `startsWith(prefix)`: the looser form silently puts any future
    // `/app-users-export` or `/dashboard-public` route behind an unintended
    // permission — a redirect nobody can explain.
    for (const pathname of [
      '/en/app-users-export',
      '/en/admin-usersx',
      '/en/dashboard-public',
      '/en/audit-logs-archive',
    ]) {
      expect(route(pathname).rule, pathname).toBeUndefined()
    }
  })

  it('treats a trailing slash as the same route', () => {
    expect(route('/en/dashboard/').rest).toBe('/dashboard')
    expect(route('/en/dashboard/').rule?.permission).toBe('dashboard.view')
  })

  it('leaves the public paths ungated', () => {
    for (const pathname of ['/', '/en', '/en/', '/en/login', '/login', '/favicon.ico']) {
      expect(route(pathname).rule, pathname).toBeUndefined()
    }
    expect(route('/').rest).toBe('')
    expect(route('/en').rest).toBe('')
    expect(route('/en/login').rest).toBe('/login')
    expect(route('/login').rest).toBe('/login')
  })

  it('keeps a non-locale first segment in `rest`', () => {
    // Documenting the current behaviour rather than endorsing it: an
    // unrecognised first segment is *not* a locale, so the path is not gated
    // here — `/EN/admin-users` reaches next-intl's middleware, which redirects
    // it. Safe today because the console has no route the intl layer would
    // serve under an unknown prefix; if that ever changes, this test is the one
    // that has to change with it.
    expect(route('/EN/admin-users')).toEqual({
      locale: DEFAULT_LOCALE,
      rest: '/EN/admin-users',
      rule: undefined,
    })
    expect(route('/fr/admin-users').rule).toBeUndefined()
  })

  it('resolves every guarded prefix under both locales', () => {
    for (const locale of LOCALES) {
      for (const rule of ROUTE_PERMISSIONS) {
        const resolved = route(`/${locale}${rule.prefix}`)
        expect(resolved.locale, rule.prefix).toBe(locale)
        expect(resolved.rule, rule.prefix).toEqual(rule)
      }
    }
  })
})
