/**
 * Edge-safe module (imported by middleware).
 *
 * Deliberately a DIFFERENT cookie name from app-web, and admin-web signs with a
 * DIFFERENT AUTH_SECRET — an app-web session token is unusable here even if it
 * were copied across (SPEC §1.4 / §7).
 */
const isProd = process.env.NODE_ENV === 'production'

export const SESSION_COOKIE_NAME = `${isProd ? '__Secure-' : ''}admin-web.session-token`

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: isProd,
} as const

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
