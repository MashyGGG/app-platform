import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@app/db'
import { fakeVerify, loginSchema, verifyPassword } from '@app/shared'
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from '@/lib/cookies'

/** Email + password is the only way in — there is no OAuth provider. */
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
