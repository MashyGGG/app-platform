import { NextResponse } from 'next/server'
import { signOut } from '@/auth'
import { expiredSessionCookie } from '@/lib/session'
import { routing, isAppLocale } from '@/i18n/routing'

export const runtime = 'nodejs'

/**
 * SPEC §1.4.2 — where a rejected session actually gets destroyed.
 *
 * Server Components cannot mutate cookies, so `requireUser()` redirects here
 * when the DB says the session is no longer valid (user deleted or disabled).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const requested = url.searchParams.get('locale') ?? undefined
  const locale = isAppLocale(requested) ? requested : routing.defaultLocale

  try {
    await signOut({ redirect: false })
  } catch {
    // Already gone — clearing the cookie below is enough.
  }

  const response = NextResponse.redirect(new URL(`/${locale}/login?signedOut=1`, url.origin))
  response.headers.append('set-cookie', expiredSessionCookie())
  return response
}
