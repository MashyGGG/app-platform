# app-platform

A pnpm + Turborepo monorepo holding two Next.js 15 applications that share **one** PostgreSQL database and **one** Prisma schema.

| Workspace         | What it is                                    | Local port |
| ----------------- | --------------------------------------------- | ---------- |
| `apps/app-web`    | User-facing web app (register / login / Home) | 3000       |
| `apps/admin-web`  | Backoffice console (RBAC, audit)              | 3001       |
| `packages/db`     | **Sole Prisma Schema Owner** + shared client  | —          |
| `packages/shared` | Password hashing, rate limit, errors, zod     | —          |

## Non-negotiable rules

1. **`packages/db` owns the schema.** No `.prisma` file, no `prisma/migrations/` directory, and no
   `prisma migrate` / `prisma db push` script may exist inside `apps/*`. This is enforced by
   `pnpm check:schema-owner`, which runs in CI before anything else.
2. **Never migrate from inside an app.** All migration commands run at the repo root
   (`pnpm db:migrate`, `pnpm db:deploy`) and target `packages/db`.
3. **Never commit secrets.** `.env` is git-ignored; `.env.example` is the documented contract.
4. Both apps talk to PostgreSQL **only** through the `prisma` singleton exported by `@app/db`.

## Prerequisites

- Node 20+
- pnpm 11 (`corepack enable`)
- Docker (for the local Postgres + Redis stack)

## First run

```bash
cp .env.example .env          # local Docker defaults already filled in
docker compose up -d          # postgres:5432, redis (internal), upstash-REST shim:8079
pnpm install
pnpm db:migrate               # creates the schema
pnpm db:seed                  # creates the first super_admin
pnpm dev                      # app-web :3000 + admin-web :3001
```

Seeded super admin: `super@local.dev` / `LocalDev!2345` (override via `SEED_SUPER_ADMIN_*`).

### What the Docker stack replaces

| Production      | Local equivalent                                                      |
| --------------- | --------------------------------------------------------------------- |
| Neon PostgreSQL | `postgres:16-alpine` on 5432                                          |
| Upstash Redis   | `hiett/serverless-redis-http` on 8079 (same REST API + token)         |
| Resend          | If `RESEND_API_KEY` is empty, reset links print to the server console |

Because the REST shim speaks the Upstash wire protocol, `@upstash/ratelimit` runs unmodified
locally and in production.

## Scripts

| Command                   | What it does                                           |
| ------------------------- | ------------------------------------------------------ |
| `pnpm dev`                | Both apps in parallel                                  |
| `pnpm build`              | Turborepo build (generates the Prisma client first)    |
| `pnpm typecheck`          | `tsc --noEmit` in every workspace                      |
| `pnpm lint` / `lint:fix`  | ESLint 9 flat config, run once at the root             |
| `pnpm format` / `:check`  | Prettier                                               |
| `pnpm check:schema-owner` | AC-13 guard — fails if any app tries to own the schema |
| `pnpm db:migrate`         | `prisma migrate dev` in `packages/db`                  |
| `pnpm db:deploy`          | `prisma migrate deploy` (what CI/production runs)      |
| `pnpm db:seed`            | Idempotent super_admin seed                            |
| `pnpm db:validate`        | `prisma validate`                                      |

## Environment variables

See [.env.example](.env.example). Two things that are easy to get wrong:

- **`AUTH_SECRET_APP` and `AUTH_SECRET_ADMIN` must differ.** Together with per-app cookie names
  (`app-web.session-token` / `admin-web.session-token`) this is what stops an app-web session from
  ever being replayed against the console.
- **`DATABASE_URL` is pooled, `DIRECT_URL` is not.** Prisma migrations use `DIRECT_URL`; runtime
  queries use `DATABASE_URL`.
- **`DATABASE_SCHEMA` isolates us inside a shared database.** Point it at a PostgreSQL schema name
  (e.g. `app_platform`) and both URLs are rewritten to target it, so our six tables can coexist with
  another project's — even one that already has a `User` table. Needed because `migrate deploy`
  refuses to run against a non-empty schema (`P3005`), and because a platform-injected
  `DATABASE_URL` is read-only, so `?schema=` cannot be appended by hand. Prisma creates the schema
  on first migrate. Unset ⇒ `public`, as before.

## Deployment (Vercel)

Two Vercel projects, one repository:

| Project     | Root Directory   | Build command                                         |
| ----------- | ---------------- | ----------------------------------------------------- |
| `app-web`   | `apps/app-web`   | `cd ../.. && pnpm turbo run build --filter=app-web`   |
| `admin-web` | `apps/admin-web` | `cd ../.. && pnpm turbo run build --filter=admin-web` |

Install command for both: `pnpm install --frozen-lockfile`.

**The `cd ../..` matters.** Vercel runs the build command inside the Root Directory, where `pnpm build`
would resolve to that app's own `next build` — skipping `@app/db#generate`, so the build fails on a
missing Prisma client (`packages/db/generated/` is git-ignored). Only the root Turborepo run honours
`dependsOn: ["^generate"]`. Both projects also need **Include source files outside of the Root
Directory** enabled.

**Prisma query engine.** Each app's `build` script runs `scripts/copy-prisma-engine.mjs` before
`next build`. The generated client lives at a custom `output` path, so it is bundled rather than
externalised, and Next's file tracing cannot follow the `.node` binary the bundle loads at runtime —
the deployed function would fail with _"could not locate the Query Engine for runtime
rhel-openssl-3.0.x"_. The script copies the engine to `apps/<app>/generated/client`, which is the
first directory Prisma searches at runtime, and `outputFileTracingIncludes` in each `next.config.ts`
puts it in the deployment bundle. `schema.prisma` lists `rhel-openssl-3.0.x` explicitly in
`binaryTargets` so this works regardless of which OS ran `prisma generate`.

`admin-web` sends `robots: noindex`; consider putting it behind Vercel Authentication or an IP
allow-list as well.

### Who deploys what

**Vercel's Git integration builds and deploys both projects** — previews on every PR, production on
every push to `main`. GitHub Actions does not deploy; [.github/workflows/ci.yml](.github/workflows/ci.yml)
owns the two things Vercel does not do:

1. **quality** (PRs and pushes) — schema-owner guard → `prisma validate` → `migrate deploy` against a
   throwaway Postgres service → **migration drift check** (`prisma migrate diff --exit-code`) →
   generate → lint → format → typecheck → build. Needs no secrets.
2. **migrate** (pushes to `main`) — `prisma migrate deploy` against the production database.
   Needs `DATABASE_URL` and `DIRECT_URL` as repository secrets; `needs: quality` keeps a red build
   from touching production.

**This is a race, not a gate.** Vercel starts building the moment you push, so the migration is not
guaranteed to land before the new code. Keep migrations backward compatible, or run `pnpm db:deploy`
by hand before merging anything destructive. To stop broken code reaching Vercel at all, protect
`main` with **Require status checks to pass → Quality**.

## Documentation

- [apps/app-web/README.md](apps/app-web/README.md)
- [apps/admin-web/README.md](apps/admin-web/README.md)
- [packages/db/README.md](packages/db/README.md)
- [docs/APP-ADMIN-LANDING-PROMPT.md](docs/APP-ADMIN-LANDING-PROMPT.md) — the source specification

### Deviations from the specification

1. **No Google OAuth.** The spec asks for Credentials + Google (AC-3); the product decision was
   email + password only, so no OAuth provider is registered in either app. The Auth.js Prisma
   adapter and its `Account` table stay in the schema — they are provider-agnostic plumbing, and
   removing them would be a migration with no functional benefit.
2. **The `User.status` check lives in the Node runtime, not the middleware.** The spec asks for a
   database check on every authenticated request. Prisma cannot run on the Edge, where middleware
   executes, so middleware is only a cheap cookie/route gate; `requireUser()` / `requireAdmin()`
   perform the authoritative per-request lookup. See each app's README.
3. **Deployment is Vercel's, not the workflow's (AC-10 / AC-11).** The spec has GitHub Actions
   deploy previews and gate production behind `needs: [quality, migrate]`. We use Vercel's Git
   integration instead, which is simpler and needs no Vercel token in CI — but it deploys on push,
   so migrations race the deploy rather than gating it. Vercel's own PR bot supplies the preview
   URLs that AC-10 asks the workflow to comment.
