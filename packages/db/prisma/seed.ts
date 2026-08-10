/**
 * Seed — SPEC §5: exactly one local `super_admin` so the backoffice can be
 * entered for the first time. Credentials come from env (documented in
 * .env.example / README) and are NEVER committed.
 *
 * Idempotent: safe to re-run.
 */
import { hashPassword } from '@app/shared'
import { prisma } from '../src/index'

async function main() {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL || 'super@local.dev').toLowerCase()
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD || 'LocalDev!2345'

  if (process.env.NODE_ENV === 'production' && !process.env.SEED_SUPER_ADMIN_PASSWORD) {
    throw new Error('Refusing to seed production with the default password.')
  }

  const passwordHash = await hashPassword(password)

  const user = await prisma.user.upsert({
    where: { email },
    update: { status: 'active' },
    create: {
      email,
      name: 'Super Admin',
      locale: 'zh',
      status: 'active',
      emailVerified: new Date(),
      passwordHash,
    },
  })

  await prisma.adminProfile.upsert({
    where: { userId: user.id },
    update: { role: 'super_admin' },
    create: { userId: user.id, role: 'super_admin' },
  })

  console.info(`✅ seeded super_admin: ${email}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
