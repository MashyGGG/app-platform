import { PrismaClient } from '../generated/client'
import { applySchemaToEnv } from './schema-url'

export * from '../generated/client'
export { applySchemaToEnv, withSchema } from './schema-url'

declare global {
  var __appPrisma: PrismaClient | undefined
}

// Must run before the client reads DATABASE_URL. No-op unless DATABASE_SCHEMA
// is set — see ./schema-url.ts for why that variable exists.
applySchemaToEnv()

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

/**
 * Single shared Prisma client. Both apps import THIS instance — never construct
 * their own, and never talk to PostgreSQL any other way (SPEC §1.2).
 */
export const prisma: PrismaClient = globalThis.__appPrisma ?? createClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__appPrisma = prisma
}
