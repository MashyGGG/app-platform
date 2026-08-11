# Unit testing

> Companion to [E2E-TESTING.md](E2E-TESTING.md), which asked "does E2E replace unit tests?" and
> answered "no, but most of what unit tests are good at is already covered here by something cheaper".
> This document is the follow-through: **Vitest, 83 tests in 7 files, ~0.9 s**, covering only the
> places where a unit test earns its keep in this particular codebase.
>
> `pnpm test`

---

## 1. What a unit test is for _here_

The rule this suite follows: **a unit test is worth writing when E2E cannot reach the case cheaply, or
when the failure mode is silent.** Three shapes qualify in this repo, and almost nothing else does.

| Shape                                    | Why E2E can't do it                                                                                                                                                                                                                                              | Where                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Boundary tables behind a rate limit**  | `register` allows 5 requests per hour per IP. Twenty password-boundary cases over HTTP means either fighting the limiter or minting twenty client IPs — and a `400` response cannot tell you _which_ rule rejected the input.                                       | `validation.ts`                          |
| **Pure functions that fail silently**    | `clientIp()` returning the wrong hop does not throw; it puts requests in the wrong rate-limit bucket. The E2E suite is structurally blind to it because it _depends_ on that function trusting `x-forwarded-for` in order to give each context its own bucket.      | `ip.ts`                                  |
| **Code whose branches only run in prod** | `DATABASE_SCHEMA` is unset in dev, in CI and in the E2E job. Every branch of `withSchema()` first executes for real against a shared production database, and its failure mode is the runtime client and `prisma migrate` disagreeing about which schema they own. | `schema-url.ts`                          |
| **Contracts TypeScript cannot see**      | `errors.ts` is typed; `en.json` is data. Adding an error code without its translation compiles, lints, typechecks, and shows the user the literal string `errors.somethingNew`.                                                                                    | `messages.test.ts` (both apps)           |
| **Declarations with real branching**     | The RBAC matrix itself is checked by TypeScript, but the path-to-permission resolution around it is genuine branching logic and was unreachable without booting Next.                                                                                              | `rbac.ts` + the extraction in §4         |

Everything else in this codebase is either a thin adapter over Prisma/Auth.js — where a unit test
asserts the mock rather than the behaviour — or a declaration whose correctness the compiler already
enforces. That is why the suite is small on purpose, and why growing it is not automatically progress.

## 2. Choice of runner: Vitest 4

For this repo specifically, not on general popularity:

- Everything is `"type": "module"` with `moduleResolution: "Bundler"`, and the workspaces import each
  other through package.json `exports` (`@app/shared`, `@app/shared/validation`). Vitest resolves all
  of that through Vite with no configuration. Jest would need ts-jest/SWC plus a `moduleNameMapper`
  duplicating every subpath export by hand.
- Its `expect` is the same API the Playwright suite already uses, so the two suites read alike.
- `projects` handles the one real complication: each Next.js app maps `@/*` to its **own** `src`, so a
  single resolver cannot serve both.

**Rejected: `node:test` + tsx** — zero new dependencies, and genuinely sufficient for the three pure
modules. It lost on coverage and watch mode needing to be assembled by hand, on the assertion style
diverging from the E2E suite, and on `@/lib/rbac` needing manual alias resolution.

**Rejected: Jest** — the configuration above, for no benefit here.

## 3. Layout

```
vitest.config.mts               4 projects, node environment, coverage without a gate
packages/shared/src/
  validation.test.ts            the zod boundary tables
  ip.test.ts                    clientIp header parsing
  errors.test.ts                the API error envelope
packages/db/src/
  schema-url.test.ts            DATABASE_SCHEMA rewriting
apps/admin-web/src/
  lib/rbac.test.ts              the matrix, the route table, resolveConsoleRoute
  messages/messages.test.ts     every server messageKey is translated, en ≡ zh
apps/app-web/src/
  messages/messages.test.ts     same contract, asserted per app
```

Tests sit next to the code they cover, so each workspace's existing `tsconfig.json` typechecks them
with no new `include`, and `pnpm typecheck` covers the tests themselves.

**`.mts`, not `.ts`** — the repo root has no `"type": "module"`, so Vite would load a `.ts` config as
CommonJS and warn about the ESM syntax inside it.

**One root config, not a Turborepo task.** A 0.9-second suite gains nothing from task caching, and
three per-workspace configs would be three things to keep in sync. Revisit if a project ever needs
`jsdom`, or if the suite stops being instant.

**`globals: false`** (the default) — tests import `describe`/`it`/`expect` explicitly, so neither
tsconfig `types` nor the ESLint config has to learn a new set of globals.

## 4. The one production change: `resolveConsoleRoute`

`apps/admin-web/src/middleware.ts` had this inside its `authEdge()` callback:

```ts
const rest = `/${segments.slice(hasLocale ? 2 : 1).join('/')}`.replace(/\/$/, '')
const routeRule = ROUTE_PERMISSIONS.find((r) => rest === r.prefix || rest.startsWith(`${r.prefix}/`))
```

That is the only real branching in the RBAC layer, and it was unreachable without booting Next. It now
lives in `lib/rbac.ts` as `resolveConsoleRoute(pathname, locales, defaultLocale)`, returning
`{ locale, rest, rule }`; the middleware destructures it and is otherwise unchanged.

The locale list is a **parameter rather than an import** so the function stays free of `next-intl` —
otherwise every test of it would drag `next-intl/routing` into the module graph.

The refactor is behaviour-preserving by construction (the same expressions, moved) and was verified by
running the full Playwright suite against it: **32 passed**, including the three specs that exercise
this exact path (`rbac.spec.ts`'s redirect to `/en/dashboard?denied=1`, the anonymous page redirect,
and the sidebar/API agreement).

The test that matters most there pins a subtlety worth stating out loud: the rule match is
`rest.startsWith(`${prefix}/`)` and **not** `startsWith(prefix)`. The looser form would put a future
`/app-users-export` or `/dashboard-public` behind a permission nobody intended — a redirect with no
visible cause. There is a test asserting exactly those four sibling paths stay ungated.

## 5. Rules this suite keeps

Stated as rules because the value of the suite comes from what it refuses to do:

- **No mocked Prisma.** Anything needing `vi.mock('@app/db')` is wiring, and wiring belongs in E2E,
  where it runs against a real database.
- **No route-handler tests with synthetic `Request` objects.** The twenty handlers under `apps/*/api`
  are covered for real by Playwright; a fake `NextRequest` would only assert our own idea of Next's
  contract.
- **No jsdom, no component tests.** antd + SSR + `next-intl` makes them expensive and brittle, and the
  E2E suite already renders the real thing in a real browser.
- **No snapshots of the `PERMISSIONS` matrix.** It would go red on every legitimate permission change
  while catching nothing.
- **No coverage threshold.** In a repo that is mostly thin adapters, a percentage gate rewards tests
  that assert a mock. `pnpm test:coverage` prints a report to read; nothing gates on it.
- **Every assertion says why.** A test whose failure message doesn't explain what broke costs more
  than it saves — most of these carry a comment naming the failure it prevents.

## 6. Where it runs

**CI** — a step inside the existing **`quality`** job, between `typecheck` and `build`. Not a job of its
own: it needs no service and no secret and finishes in a second, so a separate job's queue time would
exceed its runtime. `migrate` already needs `quality`, so the unit suite gates a release for free.

**Pre-commit** — [`.husky/pre-commit`](../.husky/pre-commit) runs `pnpm test` after `lint-staged` and the
schema-ownership guard. It is affordable there precisely because of the rules in §5: no database, no
docker, no build, ~1 s. It runs the whole suite rather than a staged-file subset, so there is no
partial-check hole to reason about.

The E2E suite is deliberately **not** in the hook. It needs `docker compose up`, a migrated and seeded
database and a production build of both apps — minutes when the stack is up and a certain failure when
it is not, which trains the habit of `--no-verify` and takes the cheap checks down with it. A local hook
is a fast signal, not a gate; it can always be skipped, so the gate lives in CI.

## 7. What this found

Writing the tests turned up one thing, and it is worth being precise that it is not a bug:

**Non-ASCII email addresses cannot register.** zod 3's `.email()` is an ASCII-only regex, so both
`jörg@example.de` (unicode local part) and `user@exämple.de` (unicode domain) are refused with
`errors.invalidEmail`. RFC 6531 permits them; most mail providers reject them too, and nobody has
asked for them — so this stays as it is. It is recorded here and in a test because it became the
product's behaviour by accident rather than by decision.

Two things deliberately left as documented behaviour rather than "fixed", because changing either is a
product decision and not a test's business:

- **An unrecognised first path segment is not gated by RBAC.** `/EN/admin-users` (capitalised locale)
  is not recognised as a locale, so `rest` stays `/EN/admin-users`, matches no rule, and falls through
  to `next-intl`'s middleware, which redirects it. Safe today because the console has no route the
  intl layer would serve under an unknown prefix. There is a test documenting it, so if that ever
  changes, the test changes with it.
- **The last-active-`super_admin` guard still reads outside its transaction**
  ([E2E-TESTING.md §5](E2E-TESTING.md#5-deliberately-not-covered)). Neither suite can pin a race
  deterministically; that guard belongs in SQL or inside the transaction.

## 8. Where this would grow next

In order, if the code moves:

1. **`packages/shared/src/rate-limit.ts`** — the budget table (`login` 5/15min, `register` 5/h) and the
   key shape are asserted only indirectly, by one E2E test that spends five real requests to prove it.
   Extracting the key builder would make the whole table testable in microseconds.
2. **`packages/shared/src/audit.ts`** — it returns Prisma create-args, which is exactly the kind of
   pure shape a unit test can pin without a database.
3. **`password.ts`** — argon2id is a native module and the E2E suite exercises it end to end on every
   run; only worth unit-testing if the parameters ever become configurable.
