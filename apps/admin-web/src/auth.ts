import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@app/db'
import { fakeVerify, loginSchema, verifyPassword } from '@app/shared'
import { authEdgeConfig } from '@/auth.config'

/** Email + password is the only way in — there is no OAuth provider. */
const providers = [
  Credentials({
    id: 'credentials',
    name: 'Email and password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
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
          adminProfile: { select: { role: true } },
        },
      })

      if (!user?.passwordHash) {
        await fakeVerify()
        return null
      }

      // AC-6 — no AdminProfile means no backoffice, full stop.
      if (!user.adminProfile) return null
      if (user.status !== 'active') return null

      const ok = await verifyPassword(user.passwordHash, password)
      if (!ok) return null

      return { id: user.id, email: user.email, name: user.name, image: user.image }
    },
  }),
]

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authEdgeConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: PrismaAdapter(prisma as any),
  providers,
  callbacks: {
    ...authEdgeConfig.callbacks,
    /** Backoffice entry gate: AdminProfile required AND user must be active. */
    async signIn({ user }) {
      if (!user?.id) return false
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { status: true, adminProfile: { select: { role: true } } },
      })
      return Boolean(row && row.status === 'active' && row.adminProfile)
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id
      if (token.sub) {
        // Refreshed on every token rotation so a demoted admin loses menu access
        // quickly; the authoritative check still happens per-request in the DB.
        const profile = await prisma.adminProfile.findUnique({
          where: { userId: token.sub },
          select: { role: true },
        })
        token.role = profile?.role
      }
      return token
    },
  },
})
