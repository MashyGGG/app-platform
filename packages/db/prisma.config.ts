import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { loadDbEnv } from './src/load-env'

// Env lives at the repo root (one file for the whole monorepo). Shared with the
// seed script so the CLI and the seed can never disagree about which database —
// or which schema — they are pointed at.
loadDbEnv()

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
})
