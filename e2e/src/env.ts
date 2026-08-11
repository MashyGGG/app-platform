import path from 'node:path'
import { config as loadEnv } from 'dotenv'

/**
 * The suite is deliberately BLACK BOX: it never imports `@app/db`, never opens a
 * database connection and never reaches into Redis. Everything it knows about
 * the system it learns through the two apps' own HTTP surfaces — which is the
 * only way a test can prove that the *deployed* behaviour is right rather than
 * that our understanding of Prisma is.
 *
 * The one thing it does need from the environment is where the apps are and the
 * seeded super-admin credentials, so it reads the same root `.env` the apps do.
 * On CI the variables are already in the environment and dotenv no-ops.
 */
loadEnv({ path: path.resolve(__dirname, '../../.env'), quiet: true })

function url(name: string, fallback: string): string {
  return (process.env[name] || fallback).replace(/\/$/, '')
}

export const APP_URL = url('E2E_APP_URL', 'http://localhost:3000')
export const ADMIN_URL = url('E2E_ADMIN_URL', 'http://localhost:3001')

/** Seeded by `pnpm db:seed`; the only account the suite does not create itself. */
export const SUPER_ADMIN = {
  email: (process.env.SEED_SUPER_ADMIN_EMAIL || 'super@local.dev').toLowerCase(),
  password: process.env.SEED_SUPER_ADMIN_PASSWORD || 'LocalDev!2345',
}

/**
 * Long-lived accounts the suite owns. Stable addresses (rather than a fresh one
 * per run) on purpose: there is no hard-delete endpoint by product decision, so
 * unique-per-run actors would pile up forever in a developer's local database.
 * Setup makes them idempotently — create, or repair an existing one.
 */
export const FIXTURE_PASSWORD = 'E2eLocal!2345'
export const OPERATOR = { email: 'e2e-operator@e2e.test', password: FIXTURE_PASSWORD }
export const APP_ACTOR = { email: 'e2e-app-user@e2e.test', password: FIXTURE_PASSWORD }

/** Prefix for throwaway accounts a single test creates. Teardown disables these. */
export const TEMP_PREFIX = 'e2e-tmp-'

/** Where `setup/auth.setup.ts` parks the reusable signed-in cookie jars. */
export const STORAGE = {
  superAdmin: path.resolve(__dirname, '../.auth/super-admin.json'),
  operator: path.resolve(__dirname, '../.auth/operator.json'),
  appActor: path.resolve(__dirname, '../.auth/app-actor.json'),
}

/**
 * `next start` runs with NODE_ENV=production, which prefixes both session
 * cookies with `__Secure-`. Tests therefore match on the suffix and never on the
 * full name, so the same spec passes against `next dev` and `next start`.
 */
export const SESSION_COOKIE_SUFFIX = {
  app: 'app-web.session-token',
  admin: 'admin-web.session-token',
} as const
