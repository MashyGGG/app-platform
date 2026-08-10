import type { NextAuthConfig } from 'next-auth'
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '@/lib/cookies'

/**
 * Edge-safe Auth.js config: no Prisma, no argon2, no adapter.
 *
 * Used by middleware to DECODE the JWT (route gating layer 1). The role carried
 * here is a convenience for routing only — every API and page re-checks the
 * role and the user's status against PostgreSQL (SPEC §1.4, §1.7).
 */
export const authEdgeConfig = {
  secret: process.env.AUTH_SECRET_ADMIN,
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
  cookies: {
    sessionToken: { name: SESSION_COOKIE_NAME, options: { ...SESSION_COOKIE_OPTIONS } },
  },
  providers: [],
  callbacks: {
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      if (typeof token.role === 'string') {
        session.user.role = token.role as 'super_admin' | 'operator'
      }
      return session
    },
  },
} satisfies NextAuthConfig
