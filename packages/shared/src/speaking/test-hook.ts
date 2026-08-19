/**
 * How a caller asks for a scoring failure or a slow response, and how the
 * server reads that ask.
 *
 * This lives beside the deterministic stub provider (`speech.ts`) because it is
 * the same seam: the stub always succeeds and always succeeds quickly, which is
 * exactly what makes AC-S3 assertable — and exactly why AC-S6 (评分失败) and
 * AC-S10 (慢但没报错) have no way to happen on their own. Those two acceptance
 * criteria need the failure injected.
 *
 * Per REQUEST, not per process. `SPEAKING_TEST_HOOK` as an environment variable
 * (IMPL §4.2) would make every spec sharing the one e2e web server slow or
 * broken at once; a header for API specs and a cookie for browser specs give
 * each test its own behaviour against a single server.
 *
 * Reading it is gated in the app by `testHooksEnabled()` — off by default and
 * refused outright on a production deployment — so on a real deployment none of
 * this is reachable whatever a client sends.
 */

export const TEST_HOOK_HEADER = 'x-speaking-test-hook'
export const TEST_HOOK_COOKIE = 'speaking-test-hook'

export const TEST_HOOKS = ['fail', 'slow'] as const
export type SpeakingTestHook = (typeof TEST_HOOKS)[number]

function isHook(value: string): value is SpeakingTestHook {
  return (TEST_HOOKS as readonly string[]).includes(value)
}

/**
 * The header wins over the cookie: an API spec that sends one is being explicit
 * about this single call, while the cookie is a whole browser context's mode.
 *
 * Anything unrecognised is `null` rather than an error — a stray cookie left
 * behind by an earlier spec must not turn into a 500 in a later one.
 */
export function parseTestHook(
  header: string | null,
  cookieHeader: string | null,
): SpeakingTestHook | null {
  const fromCookie = (cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TEST_HOOK_COOKIE}=`))
    ?.slice(TEST_HOOK_COOKIE.length + 1)

  const raw = (header ?? fromCookie ?? '').trim().toLowerCase()
  return isHook(raw) ? raw : null
}
