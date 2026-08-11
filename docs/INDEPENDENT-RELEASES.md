# Independent releases (app-web / admin-web)

Record of how this monorepo ships each app on its own version without splitting the repo or the
shared database.

## Goal

- Deploy **app-web** or **admin-web** alone, each with its own SemVer.
- Keep the existing production gate: **published GitHub Release** → quality → migrate → deploy
  (never deploy on push to `main`).
- Website “Draft a new release” and `gh release create` behave the same.

## Tag → deploy target

| Tag pattern            | Deploy matrix                         | Typical use                          |
| ---------------------- | ------------------------------------- | ------------------------------------ |
| `app-web/vX.Y.Z`       | app-web only                          | UI / app-only changes                |
| `admin-web/vX.Y.Z`     | admin-web only                        | Console-only changes                 |
| `vX.Y.Z`               | both apps                             | Shared packages or schema work       |

`X.Y.Z` must be numeric SemVer (`1.2.0`). Pre-release suffixes (`v1.2.0-beta`) are **rejected**.

Any other tag fails in the `resolve-release` job before migrate/deploy.

## Pipeline

```text
release published
  ├─ resolve-release   parse tag → JSON matrix
  └─ quality           full monorepo (unchanged)
         ↓
      migrate          always (prisma migrate deploy, idempotent)
         ↓
      deploy           matrix from resolve-release → vercel deploy --prod
```

Implementation: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — job `resolve-release`
outputs `matrix`; `deploy` uses `fromJSON(needs.resolve-release.outputs.matrix)`.

## How to cut a release

### GitHub website

1. Open the repo → **Releases** → **Draft a new release**.
2. Create a tag named exactly as in the table (e.g. `app-web/v1.2.0`).
3. Target the commit you intend to ship (usually `main`).
4. Click **Publish release** (not “Save draft”).

### CLI

```bash
gh release create app-web/v1.2.0 --generate-notes
gh release create admin-web/v0.9.1 --generate-notes
gh release create v1.3.0 --generate-notes
```

Pushing a tag without a published Release does **not** start the workflow.

## Version source of truth

- **Shipping version** = the GitHub Release tag.
- `apps/app-web/package.json` and `apps/admin-web/package.json` `version` fields may be bumped
  independently for local/display use; they are **not** read by CI to choose the deploy target.
- Root `package.json` version is not the release coordinate for either app.

## Risks (do not skip)

1. **Shared schema.** Single-app deploys leave the other app on its previous build. Schema changes
   must stay expand/contract-compatible with that previous build across the migrate→deploy window
   and until the second app is released.
2. **Shared packages** (`@app/db`, `@app/shared`). Breaking changes → use a plain `vX.Y.Z` release
   so both apps ship together.
3. **quality is always whole-repo.** A single-app tag does not skip lint/typecheck/build of the
   other workspace — by design.

## Verification checklist

- [ ] Publish `app-web/v…` → Actions shows one deploy job for app-web; admin-web has no new prod deploy.
- [ ] Publish `admin-web/v…` → only admin-web deploys.
- [ ] Publish `v…` → both deploy; migrate succeeds.
- [ ] Publish an illegal tag (e.g. `foo/v1.0.0`) → `resolve-release` fails; no migrate/deploy.
