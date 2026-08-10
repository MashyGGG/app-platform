#!/usr/bin/env node
/**
 * Schema-ownership hard constraint (SPEC §1.2 / AC-13).
 *
 * `packages/db` is the ONLY Prisma Schema Owner. This check fails CI when:
 *   1. any `prisma/schema.prisma` (or *.prisma) exists outside `packages/db`
 *   2. any `prisma/migrations` directory exists outside `packages/db`
 *   3. any app declares a `prisma migrate` script or depends on `prisma`/`@prisma/client` CLI usage
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const OWNER = join('packages', 'db')
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.git',
  'dist',
  'generated',
  '.vercel',
])

const violations = []

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      const rel = relative(repoRoot, full)
      if (entry.name === 'migrations' && !rel.startsWith(OWNER + sep)) {
        // only flag prisma migration dirs
        if (dir.endsWith(join('', 'prisma'))) {
          violations.push(`prisma migrations directory outside ${OWNER}: ${rel}`)
        }
      }
      walk(full)
    } else if (entry.name.endsWith('.prisma')) {
      const rel = relative(repoRoot, full)
      if (!rel.startsWith(OWNER + sep)) {
        violations.push(`prisma schema outside ${OWNER}: ${rel}`)
      }
    }
  }
}

walk(join(repoRoot, 'apps'))
walk(join(repoRoot, 'packages'))

// No app may run prisma migrate itself.
const appsDir = join(repoRoot, 'apps')
if (existsSync(appsDir)) {
  for (const app of readdirSync(appsDir)) {
    const pkgPath = join(appsDir, app, 'package.json')
    if (!existsSync(pkgPath) || !statSync(pkgPath).isFile()) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      if (/prisma\s+(migrate|db\s+push)/.test(script)) {
        violations.push(`apps/${app} package.json script "${name}" runs prisma migrate: ${script}`)
      }
    }
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (dep === 'prisma') {
        violations.push(`apps/${app} depends on the "prisma" CLI; only ${OWNER} may.`)
      }
    }
  }
}

// The owner must actually exist and hold exactly one schema.
const ownerSchema = join(repoRoot, OWNER, 'prisma', 'schema.prisma')
if (!existsSync(ownerSchema)) {
  violations.push(`missing schema owner file: ${relative(repoRoot, ownerSchema)}`)
}

if (violations.length > 0) {
  console.error('❌ Schema-ownership check FAILED (SPEC §1.2 / AC-13):')
  for (const v of violations) console.error(`   - ${v}`)
  process.exit(1)
}

console.info(`✅ Schema-ownership check passed: ${OWNER} is the sole Prisma Schema Owner.`)
