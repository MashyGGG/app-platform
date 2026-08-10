import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { applySchemaToEnv } from './schema-url'

const here = path.dirname(fileURLToPath(import.meta.url)) // packages/db/src

/**
 * Loads the monorepo's env for anything that runs outside Next.js — the Prisma
 * CLI (via prisma.config.ts) and the seed script.
 *
 * Deliberately NOT called from src/index.ts: the apps get their environment
 * from Next.js and Vercel, and pulling dotenv into their bundles would be both
 * useless and misleading. Paths are resolved from this file rather than
 * process.cwd(), so it does not matter whether you invoke a command from the
 * repo root or from packages/db.
 *
 * dotenv silently no-ops on a missing file, so this is safe in CI and on Vercel
 * where the variables are already in the environment.
 */
export function loadDbEnv(): void {
  loadEnv({ path: path.resolve(here, '../../../.env'), quiet: true })
  loadEnv({ path: path.resolve(here, '../.env'), quiet: true, override: true })
  applySchemaToEnv()
}
