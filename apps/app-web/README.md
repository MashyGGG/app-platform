# app-web

The user-facing application. Port **3000**.

## Routes

| Path                        | Access        | Notes                                        |
| --------------------------- | ------------- | -------------------------------------------- |
| `/[locale]`                 | public        | Landing                                      |
| `/[locale]/login`           | anonymous     | Signed-in users are bounced to `/home`       |
| `/[locale]/register`        | anonymous     | Auto-signs-in on success                     |
| `/[locale]/forgot-password` | public        | Always returns success (no user enumeration) |
| `/[locale]/reset-password`  | token         | Single-use token, revokes all sessions       |
| `/[locale]/home`            | **protected** | Renders `Hello World`                        |

API: `POST /api/auth/register`, `/api/auth/login`, `/api/auth/forgot-password`,
`/api/auth/reset-password`, `GET /api/auth/force-signout`, `GET /api/me`.

## Authentication

Auth.js v5 (NextAuth beta) with the Prisma adapter and a **JWT** session strategy.

- **Credentials (email + argon2id password) is the only provider.** There is deliberately no OAuth
  provider registered.
- Cookie: `app-web.session-token` (`__Secure-` prefixed in production), signed with
  `AUTH_SECRET_APP`. The console uses a different name **and** a different secret.
- Session lifetime: 7 days.

### How a disabled user is locked out immediately

JWT sessions are stateless, so a valid cookie alone must never be trusted. The gate has two layers:

1. **`src/middleware.ts` (Edge runtime)** — cheap: does a session cookie exist, and does this route
   require one? Prisma cannot run on the Edge, so this layer never touches the database.
2. **`src/lib/session.ts` (Node runtime)** — authoritative. `getVerifiedUser()` re-reads
   `User.status` from PostgreSQL on **every** protected page render and API call.
   - `requireUser(locale)` — for Server Components. Server Components cannot mutate cookies, so on
     failure it redirects to `/api/auth/force-signout`, a Route Handler that calls `signOut()` and
     writes an expired cookie before bouncing to the login page.
   - `requireApiUser()` — for Route Handlers. Returns a 401 `Response` with the expired session
     cookie attached.

Every protected page and route sets `export const dynamic = 'force-dynamic'` so this check can never
be cached away.

## Rate limiting

`@upstash/ratelimit` sliding window, keyed `rl:auth:{action}:{identifier}`:

| Action          | Budget     | Identifier |
| --------------- | ---------- | ---------- |
| `login`         | 5 / 15 min | IP + email |
| `register`      | 5 / hour   | IP         |
| `reset-req`     | 3 / hour   | email      |
| `reset-confirm` | 5 / 15 min | IP         |

The limiter runs **before** any password verification or database read, so it cannot be used as an
oracle. On rejection the response is `429` with `{"code":"RATE_LIMITED"}` and a `Retry-After` header.

`/api/auth/login` is a bespoke handler rather than Auth.js's own callback endpoint, because the
callback cannot return that error envelope.

## i18n

`next-intl` with `[locale]` segments — `zh` (default) and `en`. Messages live in `messages/*.json`.
API errors return a stable `code` plus a `messageKey`; the client translates, so the server never
ships user-facing prose.

## UI

Ant Design 5 via `@ant-design/nextjs-registry` (SSR style extraction, no flash of unstyled content)
plus `@ant-design/v5-patch-for-react-19`. Tailwind is present for layout only, with
`corePlugins.preflight: false` so its reset doesn't fight antd's.

## Environment

```
DATABASE_URL, DIRECT_URL
AUTH_SECRET_APP                       # must differ from AUTH_SECRET_ADMIN
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
RESEND_API_KEY, EMAIL_FROM            # optional; empty ⇒ reset links printed to the console
NEXT_PUBLIC_APP_URL                   # base of the password-reset link
```

`UPSTASH_REDIS_REST_*` may also arrive as `KV_REST_API_URL` / `KV_REST_API_TOKEN` — that is what the
Vercel Upstash integration injects, and `getRedis()` accepts either pair.

## Vercel

Root Directory `apps/app-web`, install `pnpm install --frozen-lockfile`, build
`cd ../.. && pnpm turbo run build --filter=app-web` — the build must run from the repo root so
Turborepo generates the Prisma client first. Do **not** add a `prisma migrate` step here — migrations run from `packages/db` in the
`migrate` job of `.github/workflows/ci.yml`, before the production deploy.

`next.config.ts` marks `@prisma/client` and `@node-rs/argon2` as `serverExternalPackages` and sets
`outputFileTracingRoot` to the monorepo root. Both packages are also direct dependencies of this
app: under pnpm's strict `node_modules` they are otherwise unresolvable from here, and webpack
silently falls back to bundling argon2's native `.node` binary.
