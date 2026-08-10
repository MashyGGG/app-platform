import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'prisma/config'
import { applySchemaToEnv } from './src/schema-url'

const here = path.dirname(fileURLToPath(import.meta.url))

// Env lives at the repo root (one file for the whole monorepo). Vercel/CI
// inject real env vars instead, and dotenv silently no-ops when the file is
// absent — so this is safe everywhere.
loadEnv({ path: path.resolve(here, '../../.env'), quiet: true })
loadEnv({ path: path.resolve(here, '.env'), quiet: true, override: true })

// The CLI must target the same schema as the runtime client, or `migrate` would
// happily create tables somewhere the app never looks.
applySchemaToEnv()

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
})
