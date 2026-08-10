import createIntlMiddleware from 'next-intl/middleware'
import { NextResponse } from 'next/server'
import { authEdge } from '@/auth.edge'
import { isAppLocale, routing } from '@/i18n/routing'
import { ROUTE_PERMISSIONS, can } from '@/lib/rbac'

const intlMiddleware = createIntlMiddleware(routing)

/**
 * RBAC enforcement layer 1 — route gating (SPEC §1.7).
 *
 * Runs on the Edge runtime, so it can only read what is inside the signed JWT
 * (id + role); it cannot reach PostgreSQL. It stops obviously-wrong navigation
 * early. `requireAdmin()` / `requireApiAdmin()` (layer 2) re-verify everything
 * against the database and are what actually authorise a request.
 */
export default authEdge((request) => {
  const segments = request.nextUrl.pathname.split('/')
  const maybeLocale = segments[1]
  const hasLocale = isAppLocale(maybeLocale)
  const locale = hasLocale ? maybeLocale : routing.defaultLocale
  const rest = `/${segments.slice(hasLocale ? 2 : 1).join('/')}`.replace(/\/$/, '')

  const session = request.auth
  const role = session?.user?.role

  const routeRule = ROUTE_PERMISSIONS.find(
    (rule) => rest === rule.prefix || rest.startsWith(`${rule.prefix}/`),
  )

  if (routeRule) {
    if (!session?.user?.id) {
      return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
    }
    if (!role || !can(role, routeRule.permission)) {
      return NextResponse.redirect(new URL(`/${locale}/dashboard?denied=1`, request.url))
    }
  }

  if (session?.user?.id && rest === '/login') {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url))
  }

  return intlMiddleware(request)
})

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
