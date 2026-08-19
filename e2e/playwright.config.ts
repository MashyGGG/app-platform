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
    // The suite has no inbox, so the OTP request endpoint hands the code back in
    // its response instead of mailing it (AC-S9). The route refuses to do this
    // on a production deployment whatever this flag says — see
    // apps/app-web/src/app/api/auth/otp/request/route.ts.
    env: {
      OTP_DEV_ECHO: '1',
      // A browser spec that has to speak for a real 30 seconds turns a 20-second
      // suite into a five-minute one; the 30 s product boundary is a Vitest row
      // (`packages/shared/src/speaking/wav.test.ts`) instead. Specs that talk to
      // the upload endpoint directly still send a full-length take.
      SPEAKING_MIN_DURATION_MS: '2000',
      // The seeded prompts reference 示范音 keys whose files content ops has not
      // produced yet; serve silence for them so an <audio> in a test is a real
      // player rather than a dead src. Refused on a production deployment.
      SPEAKING_AUDIO_PLACEHOLDER: '1',
      // AC-S6 and AC-S10 need a 500 and a slow-but-successful response, and the
      // stub provider is deterministic and never fails — by design. This opens
      // the per-request injection those two specs ask for; it is off by default
      // and refused on a production deployment either way.
      SPEAKING_TEST_HOOKS: '1',
      // Production's numbers are 20 s and 25 s (`lib/speaking/config.ts`). The
      // suite verifies the MECHANISM, not the constant: waiting twenty real
      // seconds per assertion would cost more than the criterion is worth, and
      // the constants themselves are one `intFromEnv` call each. Kept well above
      // a healthy stub round trip (~200 ms) so no other spec trips the banner.
      SPEAKING_DEGRADE_AFTER_MS: '4000',
      SPEAKING_TEST_HOOK_DELAY_MS: '9000',
    },
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
  // Not `undefined` locally (which is half the cores, and on a big machine that
  // is ten). Every `/today` spec opens a fake capture device and records in real
  // time, and those audio threads starve each other long before the CPUs are
  // busy: past about four, takes stall mid-recording and specs fail for reasons
  // that have nothing to do with the product.
  workers: isCI ? 2 : 4,
  // Every assertion here crosses a real HTTP boundary and a real database.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: isCI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['html', { open: 'never' }], ['list']],

  use: {
    ...devices['Desktop Chrome'],
    // `/today` records for real. The fake device feeds Chrome a synthetic tone
    // instead of a microphone, and granting the permission up front stands in
    // for the OS dialog — which Playwright cannot drive, and which is therefore
    // the one part of AC-S2's ten seconds the suite does not measure.
    launchOptions: {
      args: [
        // Synthesise a microphone (a CI box has none) and auto-accept the
        // capture prompt. `permissions: ['microphone']` alone is not enough:
        // it satisfies the Permissions API, but `getUserMedia` still has to
        // find a device to open.
        //
        // `-stream`, not `-capture`. Chrome ignores an unknown switch in
        // silence, so the misspelling reads as working everywhere a real
        // microphone exists — a developer machine — and only fails on the one
        // box this flag is here for.
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
    permissions: ['microphone'],
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
