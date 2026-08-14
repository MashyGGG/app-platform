import createIntlMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing, isAppLocale } from '@/i18n/routing'
import { SESSION_COOKIE_NAME } from '@/lib/cookies'
import { POST_AUTH_LANDING } from '@/lib/routes'

const intlMiddleware = createIntlMiddleware(routing)

/** Routes that require a session. */
const PROTECTED = ['/home', '/today']
/** Routes that a signed-in user should not see. */
const AUTH_ONLY = ['/login', '/register', '/auth']

/**
 * Cheap FIRST gate only (Edge runtime — no DB access here).
 *
 * The authoritative check, including the `User.status` lookup demanded by
 * SPEC §1.4, lives in `requireUser()` / `requireApiUser()` which every
 * protected page and API goes through. Do not add authorisation logic here
 * that the server-side gate does not also enforce.
 */
export default function middleware(request: NextRequest) {
  const segments = request.nextUrl.pathname.split('/')
  const maybeLocale = segments[1]
  const locale = isAppLocale(maybeLocale) ? maybeLocale : routing.defaultLocale
  const rest = `/${segments.slice(isAppLocale(maybeLocale) ? 2 : 1).join('/')}`.replace(/\/$/, '')

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value)

  const isProtected = PROTECTED.some((p) => rest === p || rest.startsWith(`${p}/`))
  if (isProtected && !hasSessionCookie) {
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
  }

  if (hasSessionCookie && AUTH_ONLY.includes(rest)) {
    return NextResponse.redirect(new URL(`/${locale}${POST_AUTH_LANDING}`, request.url))
  }

  return intlMiddleware(request)
}

export const config = {
  // Everything except API routes, Next internals and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
