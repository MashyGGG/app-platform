import 'server-only'
import { redirect } from 'next/navigation'
import { prisma } from '@app/db'
import { API_ERROR, errorBody, errorStatus } from '@app/shared'
import { auth } from '@/auth'
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '@/lib/cookies'

export interface VerifiedUser {
  id: string
  email: string
  name: string | null
  image: string | null
  locale: string
  status: 'active' | 'disabled'
  createdAt: Date
}

/**
 * ============================================================================
 * SPEC §1.4 — the disabled-user hard constraint.
 * ============================================================================
 * A valid, unexpired JWT is NOT sufficient authorisation. Every protected page
 * and every protected API re-reads `User.status` from PostgreSQL on EVERY
 * request. Disabling a user in the backoffice therefore takes effect on their
 * very next request (AC-8) instead of whenever their token happens to expire.
 *
 * Why here and not in middleware: Next.js middleware runs on the Edge runtime,
 * where Prisma cannot open a PostgreSQL connection. Middleware is a cheap first
 * gate (cookie present? route protected?); THIS function is the real gate, and
 * nothing protected may bypass it.
 */
export async function getVerifiedUser(): Promise<VerifiedUser | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      locale: true,
      status: true,
      createdAt: true,
    },
  })

  if (!user || user.status !== 'active') return null
  return user
}

/**
 * For Server Components. On failure the browser is sent through a route handler
 * that actually clears the session cookie — a Server Component render cannot
 * mutate cookies itself.
 */
export async function requireUser(locale: string): Promise<VerifiedUser> {
  const user = await getVerifiedUser()
  if (user) return user
  redirect(`/api/auth/force-signout?locale=${encodeURIComponent(locale)}`)
}

/** For Route Handlers: returns the user, or a ready-to-return 401 Response. */
export async function requireApiUser(): Promise<
  { ok: true; user: VerifiedUser } | { ok: false; response: Response }
> {
  const user = await getVerifiedUser()
  if (user) return { ok: true, user }

  const response = new Response(JSON.stringify(errorBody(API_ERROR.UNAUTHORIZED)), {
    status: errorStatus(API_ERROR.UNAUTHORIZED),
    headers: { 'content-type': 'application/json' },
  })
  // Kill the stale token so the client stops replaying it.
  response.headers.append('set-cookie', expiredSessionCookie())
  return { ok: false, response }
}

export function expiredSessionCookie(): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=${SESSION_COOKIE_OPTIONS.path}`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    `SameSite=${SESSION_COOKIE_OPTIONS.sameSite}`,
  ]
  if (SESSION_COOKIE_OPTIONS.secure) parts.push('Secure')
  return parts.join('; ')
}
