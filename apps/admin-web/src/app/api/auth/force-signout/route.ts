import { NextResponse } from 'next/server'
import { signOut } from '@/auth'
import { expiredSessionCookie } from '@/lib/cookies'
import { isAppLocale, routing } from '@/i18n/routing'

export const runtime = 'nodejs'

/** Destroys a session that the DB has invalidated (disabled / demoted / deleted). */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const requested = url.searchParams.get('locale') ?? undefined
  const locale = isAppLocale(requested) ? requested : routing.defaultLocale

  try {
    await signOut({ redirect: false })
  } catch {
    // Nothing to sign out from — the cookie clear below is what matters.
  }

  const response = NextResponse.redirect(new URL(`/${locale}/login?signedOut=1`, url.origin))
  response.headers.append('set-cookie', expiredSessionCookie())
  return response
}
