/**
 * Seed — SPEC §5: exactly one local `super_admin` so the backoffice can be
 * entered for the first time. Credentials come from env (documented in
 * .env.example / README) and are NEVER committed.
 *
 * Idempotent: safe to re-run.
 */
import { hashPassword } from '@app/shared'
import { loadDbEnv } from '../src/load-env'

loadDbEnv()

// Imported after loadDbEnv(): constructing the Prisma client reads DATABASE_URL
// at module-evaluation time, so a static import would run before the .env file
// has been read and fail with "Environment variable not found: DATABASE_URL".
const { prisma } = await import('../src/index')

const DEFAULT_EMAIL = 'super@local.dev'
const DEFAULT_PASSWORD = 'LocalDev!2345'

async function main() {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL || DEFAULT_EMAIL).toLowerCase()
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD || DEFAULT_PASSWORD

  // Compares the value, not merely whether the variable is set: .env is loaded
  // now, and a developer's .env carries the default password. "It was set" is
  // therefore no longer evidence that it is safe.
  if (process.env.NODE_ENV === 'production' && password === DEFAULT_PASSWORD) {
    throw new Error(
      'Refusing to seed production with the default password. ' +
        'Set SEED_SUPER_ADMIN_PASSWORD to something else.',
    )
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
