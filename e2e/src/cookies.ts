import { SESSION_COOKIE_SUFFIX } from './env'

export interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

/**
 * `BrowserContext` and `APIRequestContext` both expose `storageState()`, so one
 * structural type covers "anything holding a cookie jar".
 */
export interface CookieJar {
  storageState(): Promise<{ cookies: StoredCookie[] }>
}

export async function cookiesOf(jar: CookieJar): Promise<StoredCookie[]> {
  return (await jar.storageState()).cookies
}

/**
 * Matches on the SUFFIX: `next start` runs in production mode, where both apps
 * prefix the cookie with `__Secure-` (see each app's `src/lib/cookies.ts`).
 * Hard-coding the full name would make every session assertion dev-only.
 */
export async function sessionCookie(
  jar: CookieJar,
  app: keyof typeof SESSION_COOKIE_SUFFIX,
): Promise<StoredCookie | undefined> {
  const cookies = await cookiesOf(jar)
  return cookies.find((c) => c.name.endsWith(SESSION_COOKIE_SUFFIX[app]))
}

/**
 * Re-labels a session cookie as if it belonged to the other app, keeping the
 * token bytes intact — the exact replay attack that different `AUTH_SECRET`s per
 * app exist to defeat (README invariant 4).
 */
export function replayedAs(
  cookie: StoredCookie,
  target: keyof typeof SESSION_COOKIE_SUFFIX,
): StoredCookie {
  const source: keyof typeof SESSION_COOKIE_SUFFIX = target === 'admin' ? 'app' : 'admin'
  return {
    ...cookie,
    name: cookie.name.replace(SESSION_COOKIE_SUFFIX[source], SESSION_COOKIE_SUFFIX[target]),
    // The apps mark the cookie `secure` in production. Chromium treats
    // http://localhost as a trustworthy origin, but dropping the flag keeps the
    // replay identical whether the suite runs against `next dev` or `next start`.
    secure: false,
    sameSite: 'Lax',
  }
}
