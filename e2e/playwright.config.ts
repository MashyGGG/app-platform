import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { ADMIN_URL, APP_URL } from './src/env'

const repoRoot = path.resolve(__dirname, '..')
const isCI = Boolean(process.env.CI)

/**
 * `next start` serves the real production build, which is what a release ships —
 * so that is the default. `E2E_DEV=1` swaps in `next dev` for the tight loop
 * where you don't want to rebuild between edits.
 */
const useDevServers = process.env.E2E_DEV === '1'
const serverScript = useDevServers ? 'dev' : 'start'

function webServer(app: 'app-web' | 'admin-web', url: string) {
  return {
    // `next` directly rather than the app's own `start`/`dev` script, because the
    // port has to come from the URL above: E2E_APP_URL / E2E_ADMIN_URL then move
    // the whole suite off the development ports when those are occupied.
    command: `pnpm --filter ${app} exec next ${serverScript} --port ${new URL(url).port}`,
    // A locale route, not `/`: `/` only redirects, so it would go green before the
    // app can actually render or reach the database.
    url: `${url}/en/login`,
    cwd: repoRoot,
    // Deliberately NOT `!isCI`. Reusing whatever already answers on :3000 is how
    // you end up running the suite against an unrelated project's dev server and
    // reading its 404s as product failures. Opt in with E2E_REUSE=1 when you know
    // the servers on those ports are these two apps.
    reuseExistingServer: process.env.E2E_REUSE === '1',
    timeout: 180_000,
    // Next's request log would bury the reporter. Keep stderr: that is where the
    // apps' own `console.error` and Auth.js failures surface, and reading those
    // next to a red test is usually what explains it.
    stdout: 'ignore' as const,
    stderr: 'pipe' as const,
  }
}

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalTeardown: './setup/global-teardown.ts',

  // Every spec creates its own accounts and claims its own rate-limit bucket, so
  // files are safe to run concurrently. The shared fixture actors are read-only.
  fullyParallel: true,
  // A `.only` left in a spec would silently shrink the release gate.
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  // Every assertion here crosses a real HTTP boundary and a real database.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: isCI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],

  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Rate limits key on this header; a fixed value would make the whole suite
    // share one bucket. Specs that care override it per context.
    extraHTTPHeaders: { 'x-forwarded-for': '10.0.0.1' },
  },

  projects: [
    {
      name: 'setup',
      testDir: './setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'app-web',
      testDir: './tests/app-web',
      use: { baseURL: APP_URL },
      dependencies: ['setup'],
    },
    {
      name: 'admin-web',
      testDir: './tests/admin-web',
      use: { baseURL: ADMIN_URL },
      dependencies: ['setup'],
    },
    {
      // Spans both origins, so it deliberately has no baseURL — these specs name
      // the app they are talking to on every call.
      name: 'cross-app',
      testDir: './tests/cross-app',
      dependencies: ['setup'],
    },
  ],

  webServer: [webServer('app-web', APP_URL), webServer('admin-web', ADMIN_URL)],
})
