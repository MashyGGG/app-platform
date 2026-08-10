import { PrismaClient } from '../generated/client'

export * from '../generated/client'

declare global {
  var __appPrisma: PrismaClient | undefined
}

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
