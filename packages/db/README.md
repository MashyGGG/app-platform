# `@app/db` — the Schema Owner

This package is the **only** place in the repository where the database schema exists and the
**only** place migrations are created or applied. Both apps import the client from here.

```ts
import { prisma, type User } from '@app/db'
```

## Why a singleton

`src/index.ts` caches the `PrismaClient` on `globalThis` outside production so Next.js hot reload
doesn't exhaust the connection pool. Apps must never call `new PrismaClient()` themselves.

## Commands (always run from the repo root)

```bash
pnpm db:migrate    # prisma migrate dev  — creates a new migration
pnpm db:deploy     # prisma migrate deploy — applies pending migrations (CI/prod)
pnpm db:seed       # idempotent super_admin seed
pnpm db:generate   # regenerate the client into ./generated/client
pnpm db:validate   # prisma validate
```

> **Never** run any of these from inside `apps/*`. `pnpm check:schema-owner` fails the build if an
> app declares a `prisma` CLI dependency or a migrate script.

## Configuration

`prisma.config.ts` (Prisma 6.19 — replaces the deprecated `package.json#prisma` block) loads the
monorepo-root `.env` first, then a package-local `.env` if present, and registers the seed command.
Without it Prisma would not see the root `.env` and `DIRECT_URL` would be undefined.

The generator writes to `../generated/client` (git-ignored) rather than into `node_modules`, so the
client survives pnpm's strict linking and is trivially traceable by Next.js `outputFileTracing`.

## Schema notes

- `User.passwordHash` is nullable at the schema level, but every sign-up path sets it: email +
  password is the only authentication method. The nullable column keeps the Auth.js adapter's
  contract intact and lets `fakeVerify()` answer "no password" in constant time.
- `User.status` (`active | disabled`) is the authoritative kill switch. It is re-read from the
  database on **every** protected request, so disabling a user takes effect immediately even though
  sessions are JWTs (see each app's README).
- `AdminProfile` has `userId` as its primary key: a user either has a console role or doesn't.
  There is no "admin table" — an admin **is** a user.
- `AuditLog.actorUserId` uses `onDelete: Restrict`. An audit trail that can be erased by deleting
  the actor isn't an audit trail.
- Audit rows are always written inside the same `prisma.$transaction` as the business write they
  describe, so a mutation can never succeed unaudited.
