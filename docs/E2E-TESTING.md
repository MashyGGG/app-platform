# End-to-end verification

> Answers TODO #5 — *端到端验证如何做？是否需要引入第三方依赖库？*
> Short version: **yes, one dependency — Playwright**, added as a separate `e2e` workspace.
> `pnpm e2e` boots production builds of both apps against a real PostgreSQL + Redis and drives them
> over HTTP. 32 tests, ~25 s.

---

## 1. Why a third-party library is unavoidable here

The repo's existing signal — `lint && format:check && typecheck && build && check:schema-owner` —
proves the code *compiles and is well-formed*. Every claim this platform actually makes is invisible
to it, because each one spans a boundary that a compiler cannot see across:

| Claim (from the README's invariants) | What has to be real for it to hold |
| --- | --- |
| Disabling a user takes effect on their **next request** | a live JWT + a DB write from the *other* app + `getVerifiedUser()` + the cookie-clearing redirect |
| An app-web session can never enter the console | two cookie names, two `AUTH_SECRET`s, real JWE decryption failure |
| The console menu can never advertise what the API rejects | Edge middleware + Node API gate + rendered sidebar, three separate code paths |
| No admin write can go unaudited | `prisma.$transaction` actually committing both rows |
| Login rate limiting can't be used as a password oracle | Redis, real ordering inside the route handler |

You cannot write those tests with the standard library. You need something that owns a browser and an
HTTP client with a cookie jar. That is the whole reason to take the dependency — not "tests are good
practice".

### Why Playwright, not Cypress / Selenium / a hand-rolled `fetch` script

Both Playwright and Cypress are first-class in the [Next.js testing guide]. For **this** repo
Playwright wins on four specifics, not on general popularity:

1. **Two apps, two origins, one test.** The kill-switch test needs an authenticated browser on
   `:3000` *and* an authenticated API client on `:3001` inside one test. Playwright drives the browser
   out-of-process, so multiple `BrowserContext`s and origins are ordinary; Cypress runs inside the
   page and has historically fought cross-origin navigation — exactly the shape of a NextAuth
   redirect flow.
2. **First-class API testing.** `APIRequestContext` shares a cookie jar with the browser, so the same
   test can sign in over HTTP and then assert what the UI renders. That is what makes it possible to
   verify contracts *and* wiring without two frameworks.
3. **`webServer` + project `dependencies`.** Playwright starts both apps itself and runs a `setup`
   project once to mint the signed-in cookie jars. No shell orchestration, no `wait-on`.
4. **Nothing to pay for.** Built-in parallelism, sharding, the HTML report, traces on failure. The CI
   job needs no service and no secret.

A hand-rolled `fetch` script could cover the API contracts, and would be tempting — but it cannot see
the sidebar, the antd form, the middleware redirect, or the browser's cookie behaviour, which is
where three of the five claims above live.

[Next.js testing guide]: https://nextjs.org/docs/app/guides/testing

## 2. Shape of the suite

```
e2e/
  playwright.config.ts   4 projects, 2 webServers
  src/                   env, HTTP helpers, typed API wrappers, cookie helpers
  setup/
    auth.setup.ts        identity probe → 3 signed-in cookie jars (runs once)
    global-teardown.ts   disables the throwaway accounts
  tests/
    app-web/             registration journey (UI) · login + rate-limit contract
    admin-web/           APP-user CRUD + audit · RBAC across 3 layers · privilege guards
    cross-app/           the kill switch · session isolation
```

Three deliberate design decisions, each of which is the reason a whole class of flakiness is absent:

**Black box — the suite never imports `@app/db`.** Not one direct database write or read. Fixtures are
created through the console's own endpoints and verified through `/api/audit-logs`. A test that
reaches into Prisma to arrange state can pass while the endpoint that is supposed to arrange it is
broken; and it silently gains permission a real operator does not have.

**Every request carries its own `x-forwarded-for`.** Rate limits key on the client IP
(`rl:auth:login:<ip>:<email>`). With one shared address, `register` — 5 per hour — would start
throwing 429s on a developer's fifth run of the day, and a throttled request looks exactly like a
regression. Each context claims a random `10.x.x.x`, so buckets never collide, and the one test that
*wants* a pinned bucket asks for one.

**Long-lived fixture actors, throwaway subjects.** There is no hard-delete endpoint anywhere (a
product decision). Unique-per-run admin accounts would therefore accumulate forever, so the two actor
accounts (`e2e-operator@e2e.test`, `e2e-app-user@e2e.test`) have stable addresses and setup *repairs*
them if a previous run left them demoted or disabled. Test subjects are per-run
(`e2e-tmp-*@e2e.test`) and teardown disables them — cleanup the only way an operator could do it.
Their rows and audit trail stay, on purpose: a suite able to erase audit rows would be evidence the
append-only invariant is breakable.

## 3. Running it

```bash
docker compose up -d          # postgres + redis + the Upstash-REST shim
pnpm db:deploy && pnpm db:seed
pnpm e2e:browsers             # once — downloads Chromium
pnpm build                    # the suite runs `next start`, i.e. real production builds
pnpm e2e
pnpm e2e:report               # HTML report; traces are attached to failures
```

| Variable / flag | Effect |
| --- | --- |
| `E2E_DEV=1` | run `next dev` instead of `next start` — no rebuild between edits |
| `E2E_APP_URL`, `E2E_ADMIN_URL` | move the suite off `:3000` / `:3001` when those ports are taken |
| `E2E_REUSE=1` | attach to servers you already have running (see the warning below) |
| `pnpm e2e:ui` | Playwright's interactive runner |

> **`reuseExistingServer` is off by default, on purpose.** Playwright's documented default reuses
> whatever already answers on the port. On a machine with several Next.js projects that means the
> suite silently tests the *wrong app* and reports its 404s as product failures — this happened while
> the suite was being written. The first setup test is an identity probe for the same reason: an
> unauthenticated `GET /api/me` must return a 401 carrying this platform's error envelope, or the run
> stops with an explanation instead of 30 confusing failures.

## 4. What CI does

A new `e2e` job runs in parallel with `quality`, on every PR and again on release, and `migrate` now
needs both — so a broken kill switch cannot reach production. It uses a throwaway PostgreSQL plus the
same `serverless-redis-http` shim as local dev, and needs **no secrets**. `AUTH_SECRET_APP` and
`AUTH_SECRET_ADMIN` are set to *different* dummy values there, because a single shared secret would
turn the session-isolation vulnerability into a green build.

This suite runs **only** in CI and by hand — never in the pre-commit hook, which stops at `lint-staged`,
the schema guard and the ~1 s unit suite. Requiring docker, a seeded database and two production builds
before every commit would cost minutes when the stack is up and fail outright when it is not.

## 5. Deliberately not covered

Being explicit, so nobody reads a green suite as more than it is:

- **The password-reset flow** — switched off in the product (`_forgot-password` / `_reset-password`).
  When it comes back, the token lifecycle is worth a spec.
- **Concurrency.** The "you cannot demote the last super_admin" guard reads and then writes outside a
  transaction. Two simultaneous demotions can both pass the check. Playwright can express the race,
  but not deterministically; that guard belongs in SQL or in the transaction.
- **The `email` package / Resend.** No mail server in the loop.
- **Locale coverage.** Specs drive `/en` for legible selectors; `/zh` is only exercised incidentally.
- **Visual regression.** Playwright can do screenshot diffing; antd + SSR makes it noisy and it would
  earn its place only once the UI settles.

## 6. Does E2E replace unit tests?

**No — but for this repo it is the right thing to build first, and most of what unit tests would cover
here is already covered by something cheaper.**

E2E answers *"does the system do what we promise?"*. Unit tests answer *"is this function right, and
which line is wrong?"*. A suite that only has the first kind tells you something broke and makes you
bisect to find out where; a suite that only has the second can be entirely green while the product is
broken at every seam. The usual pyramid (many unit, some integration, few E2E) still holds.

What is different here is that this codebase has unusually little of the thing unit tests are good at.
Almost every module is either a thin adapter over Prisma/Auth.js (a unit test would assert the mock,
not the behaviour) or a declaration (`rbac.ts`'s matrix, `errors.ts`'s status map) whose correctness
TypeScript already enforces. The genuine logic is all *between* modules, which is exactly what E2E
reaches and unit tests structurally cannot.

Where unit tests would pay for themselves, in priority order:

1. **`packages/shared/src/validation.ts`** — the zod schemas. Pure functions, a real table of
   edge cases (unicode emails, 128-char password boundary, letters-and-digits rule), zero setup cost.
2. **`clientIp()`** — header parsing: multi-hop `x-forwarded-for`, whitespace, `x-real-ip` fallback,
   the `0.0.0.0` default. Feeds both rate-limit keys and audit rows, so quietly important.
3. **`rbac.ts`'s `can()` / route matching** — cheap to pin, and prevents a typo in `ROUTE_PERMISSIONS`
   from silently un-gating a route.
4. **`schema-url.ts`** — URL rewriting with an existing `?schema=`, missing query strings, both URL
   shapes. Currently only ever exercised by deploying.

That is a `vitest` project of maybe 60 assertions, and it would run in under a second. The right
sequencing was E2E first: it is what covers the claims we would be embarrassed to break, and it
guards the refactors that a unit-test layer will want to make.

> **Since written:** that layer now exists — `pnpm test`, 186 tests, ~1.5 s. It follows this list, plus
> one addition the list missed (every server `messageKey` really being translated in both locales) and
> one small extraction to make the middleware's route logic reachable. See
> [UNIT-TESTING.md](UNIT-TESTING.md).
