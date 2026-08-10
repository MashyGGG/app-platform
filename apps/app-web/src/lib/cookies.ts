/**
 * Edge-safe module: imported by middleware, so it must stay free of Node APIs,
 * Prisma and Auth.js internals.
 *
 * The two apps deliberately use DIFFERENT cookie names (and different
 * AUTH_SECRETs) so an app-web session can never be replayed against admin-web
 * (SPEC §1.4 / §7).
 */
const isProd = process.env.NODE_ENV === 'production'

export const SESSION_COOKIE_NAME = `${isProd ? '__Secure-' : ''}app-web.session-token`

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: isProd,
} as const
