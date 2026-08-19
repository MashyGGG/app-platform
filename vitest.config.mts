import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))
const at = (...segments: string[]) => path.resolve(root, ...segments)

/**
 * One config for the whole repo — see `docs/UNIT-TESTING.md` for the reasoning.
 *
 * Projects exist because each Next.js app maps `@/*` to its *own* `src`, so a
 * single resolver cannot serve both. Everything runs in the `node` environment:
 * there is deliberately no jsdom and no component test here (antd + SSR +
 * next-intl are covered for real by the Playwright suite instead).
 */
function appProject(name: 'app-web' | 'admin-web' | 'blog-web') {
  return {
    test: {
      name,
      root: at('apps', name),
      include: ['src/**/*.test.ts'],
      environment: 'node' as const,
    },
    resolve: { alias: { '@': at('apps', name, 'src') } },
  }
}

function packageProject(name: 'shared' | 'db') {
  return {
    test: {
      name: `@app/${name}`,
      root: at('packages', name),
      include: ['src/**/*.test.ts'],
      environment: 'node' as const,
    },
  }
}

export default defineConfig({
  test: {
    projects: [
      packageProject('shared'),
      packageProject('db'),
      appProject('admin-web'),
      appProject('app-web'),
      appProject('blog-web'),
    ],
    // `globals: false` (the default) is kept on purpose: tests import
    // `describe`/`it`/`expect` explicitly, so neither tsconfig `types` nor the
    // ESLint config needs to learn about a new set of globals.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: at('coverage'),
      include: ['packages/*/src/**/*.ts', 'apps/*/src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      // No thresholds, on purpose. Most of this repo is thin adapters over
      // Prisma and Auth.js; a percentage gate would reward tests that assert a
      // mock instead of a behaviour. The report is for reading, not for gating.
    },
  },
})
