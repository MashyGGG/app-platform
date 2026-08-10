# admin-web

The backoffice console. Port **3001**. `robots: noindex, nofollow`.

## Routes

| Path                    | Permission       | Roles                 |
| ----------------------- | ---------------- | --------------------- |
| `/[locale]/login`       | anonymous        | —                     |
| `/[locale]/dashboard`   | `dashboard.view` | super_admin, operator |
| `/[locale]/app-users`   | `appUser.view`   | super_admin, operator |
| `/[locale]/admin-users` | `adminUser.view` | **super_admin only**  |
| `/[locale]/audit-logs`  | `audit.view`     | super_admin, operator |

## Access control

Getting in at all requires **three** things, checked on every request: a valid `admin-web` session,
an `AdminProfile` row, and `User.status === 'active'`. An app-web user with a perfectly valid
app-web cookie cannot reach any of this — different cookie name, different `AUTH_SECRET`.

Permissions are declared **once** in `src/lib/rbac.ts` and enforced at three layers:

1. **Route gate (Edge)** — `src/middleware.ts` wraps `authEdge` and rejects on the JWT's `role`
   claim before the page is ever invoked. No database access (Prisma can't run on the Edge).
2. **Data gate (Node, authoritative)** — `src/lib/session.ts`. `getVerifiedAdmin()` re-reads both
   `User.status` **and** `AdminProfile.role` from PostgreSQL, so a demoted or disabled admin loses
   access on their very next request even though their JWT is still cryptographically valid.
   - `requireAdmin(locale, permission?)` for Server Components → redirect / `force-signout`.
   - `requireApiAdmin(permission?)` for Route Handlers → `401` when unauthenticated, **`403`** when
     authenticated but under-privileged.
3. **UI visibility** — `ConsoleShell` filters the navigation through the same `can()` helper, so an
   operator never sees a link they'd be refused. This layer is cosmetic; layers 1 and 2 are the
   security boundary.

Because the same matrix drives all three, a permission can't drift between what the menu shows and
what the API allows.

## Auditing

Every mutating endpoint writes an `AuditLog` row **inside the same `prisma.$transaction`** as the
business write (`src/lib/audit.ts` returns Prisma create-args for exactly this reason). If the audit
insert fails, the mutation rolls back with it.

Actions form a closed set shared with the database enum: `APP_USER_UPDATE`, `APP_USER_DISABLE`,
`APP_USER_ENABLE`, `ADMIN_USER_CREATE`, `ADMIN_USER_UPDATE_ROLE`, `ADMIN_USER_DISABLE`,
`ADMIN_USER_ENABLE`. `meta` records `{ fields, before, after }` for updates.

**The audit log is read-only by construction** — `GET /api/audit-logs` exists; no create, update or
delete handler is defined anywhere in the app.

## Guard rails on privileged mutations

- You cannot demote or disable **yourself**.
- You cannot demote or disable the **last active `super_admin`** — the console can never be locked
  out of its own administration.
- Creating an admin for an email that already exists **promotes that user** rather than creating a
  duplicate account.

## Dashboard cache

`GET /api/dashboard` caches its seven aggregate counts in Redis under `cache:dash:summary` for 60
seconds. If Redis is unreachable the handler degrades to querying PostgreSQL directly rather than
failing — a cache outage must not take the console down.

## Environment

```
DATABASE_URL, DIRECT_URL
AUTH_SECRET_ADMIN                     # must differ from AUTH_SECRET_APP
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
NEXT_PUBLIC_ADMIN_URL
```

Session lifetime is 8 hours here (vs 7 days in app-web).

## Working on this app

This app depends on `@app/db` but **must never run a migration**. There is deliberately no
`prisma` dependency and no `db:*` script in this `package.json`; `pnpm check:schema-owner` fails
the build if one appears. Schema changes go through `packages/db` and are applied from the repo
root with `pnpm db:migrate`.

## Vercel

Root Directory `apps/admin-web`, install `pnpm install --frozen-lockfile`, build
`cd ../.. && pnpm turbo run build --filter=admin-web` — the build must run from the repo root so
Turborepo generates the Prisma client first. Consider putting the deployment behind Vercel Authentication or an IP allow-list — nothing in the
application assumes the console is publicly reachable.
