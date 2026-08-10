/**
 * Copies the Prisma query-engine binaries next to the app that is being built.
 *
 * Why this is needed: packages/db generates its client to a custom `output`
 * directory (packages/db/generated/client), which makes it a plain relative
 * import rather than a resolvable package. `serverExternalPackages` therefore
 * cannot match it, `transpilePackages: ['@app/db']` bundles it into
 * .next/server/chunks, and Next's file tracing never sees the `.node` binary
 * the bundled client loads at runtime — so the deployed function dies with
 * "Prisma Client could not locate the Query Engine for runtime ...".
 *
 * At runtime Prisma searches `<cwd>/generated/client` first, and on Vercel the
 * function's cwd is the app directory. Copying there — plus the matching
 * `outputFileTracingIncludes` entry in next.config.ts — puts the engine exactly
 * where the client already looks.
 *
 * Run from an app directory, before `next build`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.resolve(here, '../packages/db/generated/client')
const target = path.resolve(process.cwd(), 'generated/client')

if (!fs.existsSync(source)) {
  console.error(`[copy-prisma-engine] ${source} does not exist — run \`pnpm db:generate\` first.`)
  process.exit(1)
}

// `.node` only. Prisma leaves `query_engine-*.dll.node.tmp<pid>` files behind on
// Windows when a generate is interrupted; those are not loadable engines.
const engines = fs.readdirSync(source).filter((name) => name.endsWith('.node'))

if (engines.length === 0) {
  console.error(`[copy-prisma-engine] no query engine found in ${source}.`)
  process.exit(1)
}

fs.mkdirSync(target, { recursive: true })
for (const name of engines) {
  fs.copyFileSync(path.join(source, name), path.join(target, name))
}

console.info(
  `[copy-prisma-engine] ${engines.join(', ')} -> ${path.relative(process.cwd(), target)}`,
)
