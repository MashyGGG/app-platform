import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@app/db'
import { fakeVerify, loginSchema, verifyPassword } from '@app/shared'
import { otpVerifySchema } from '@app/shared/speaking'
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '@/lib/cookies'
import { consumeOtpCode } from '@/lib/otp-token'

/**
 * Two credentials providers, no OAuth: email + password (the original app), and
 * email + one-time code (the daily-speaking channel, IMPL §3-C2). Both mint the
 * SAME `app-web.session-token` cookie from the same secret, so `requireUser()` /
 * `requireApiUser()` — and the AUTH_SECRET isolation from admin-web — apply
 * unchanged no matter which door the user came through.
 */
const providers = [
  Credentials({
    id: 'credentials',
    name: 'Email and password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    /**
     * NOTE: rate limiting happens in the /api/auth/login route handler BEFORE
     * this runs, so we never touch the DB for a throttled request (SPEC §1.5).
     */
    async authorize(raw) {
      const parsed = loginSchema.safeParse(raw)
      if (!parsed.success) return null

      const { email, password } = parsed.data
      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          status: true,
          passwordHash: true,
        },
      })

      if (!user?.passwordHash) {
        await fakeVerify()
        return null
      }

      // Disabled accounts can never mint a token in the first place.
      if (user.status !== 'active') return null

      const ok = await verifyPassword(user.passwordHash, password)
      if (!ok) return null

      return { id: user.id, email: user.email, name: user.name, image: user.image }
    },
  }),

  Credentials({
    id: 'otp',
    name: 'Email one-time code',
    credentials: {
      email: { label: 'Email', type: 'email' },
      code: { label: 'Code', type: 'text' },
    },
    /**
     * AC-S9: a brand-new address is an account. There is no password step and no
     * school/profile step — verifying the code IS the sign-up.
     *
     * Rate limiting (`otp-verify`) and the disabled-account check both happen in
     * /api/auth/otp/verify BEFORE this runs, so a throttled or blocked request
     * never reaches the code here and never burns the user's live code.
     */
    async authorize(raw) {
      const parsed = otpVerifySchema.safeParse(raw)
      if (!parsed.success) return null

      const { email, code, locale } = parsed.data

      // Consume first: a wrong code must not reveal whether the address exists.
      const valid = await consumeOtpCode(email, code)
      if (!valid) return null

      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true, image: true, status: true },
      })

      if (existing) {
        if (existing.status !== 'active') return null
        return {
          id: existing.id,
          email: existing.email,
          name: existing.name,
          image: existing.image,
        }
      }

      // First sign-in creates the account. `passwordHash` stays null on purpose:
      // an OTP-only account cannot be logged into with a password, ever.
      const created = await prisma.user.create({
        data: {
          email,
          locale: locale ?? 'zh',
          status: 'active',
          // The code was delivered to this address and came back, which is
          // exactly what verification means.
          emailVerified: new Date(),
        },
        select: { id: true, email: true, name: true, image: true },
      })

      return { id: created.id, email: created.email, name: created.name, image: created.image }
    },
  }),
]

export const { handlers, auth, signIn, signOut } = NextAuth({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  secret: process.env.AUTH_SECRET_APP,
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
  cookies: {
    sessionToken: { name: SESSION_COOKIE_NAME, options: { ...SESSION_COOKIE_OPTIONS } },
  },
  providers,
  callbacks: {
    /** Gate #1 of the disabled-user contract: cannot obtain a token. */
    async signIn({ user }) {
      if (!user?.id) return false
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { status: true },
      })
      return Boolean(row && row.status === 'active')
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id
      return token
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      return session
    },
  },
})
