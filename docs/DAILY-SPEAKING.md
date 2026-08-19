# Daily speaking — running it

Product scope lives in [`spec/NEW-PRODUCT-daily-speaking-v2.0-standalone.md`](spec/NEW-PRODUCT-daily-speaking-v2.0-standalone.md)
(the SPEC) and the build plan in
[`spec/IMPL-daily-speaking-mvp-in-app-platform.md`](spec/IMPL-daily-speaking-mvp-in-app-platform.md)
(the IMPL). **This file is neither.** It is what an operator needs to run the thing: which
environment variables exist, what happens when a free tier runs out, how to prune audio, and the
eleven-step manual pass that says the MVP is done.

The whole product lives in five places, and that is deliberate (IMPL §3-C1 — it must stay
liftable into its own repo):

| Where                                    | What                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| `apps/app-web/src/app/[locale]/{today,me,auth}` | The three student screens                              |
| `apps/app-web/src/app/api/speaking/**`   | The API, plus `/api/auth/otp/*`                              |
| `apps/app-web/src/lib/speaking/**`       | Server logic: provider selection, storage, scoring, config   |
| `packages/shared/src/speaking/**`        | Pure domain logic — winner rules, rotation, providers, retention |
| `packages/db/prisma/speaking-*.ts`       | `speaking:import`, `speaking:seed`, `speaking:prune`         |

---

## 1. Commands

```bash
pnpm speaking:seed                       # import the 21 bundled prompts (idempotent)
pnpm speaking:import <file.json> [--allow-partial] [--dry-run]
pnpm speaking:prune [--days=7] [--dry-run]
```

`speaking:prune` deletes the BYTES of takes older than the retention window and clears
`audioKey` / `retryAudioKey`. **It never deletes a session row** — 原则 E is about the record, not
the recording, so `/me`, the 7-day sentence and every completion count are unaffected. Run it
daily (a Vercel cron, a GitHub scheduled workflow, or by hand); it is idempotent, so running it
twice is free and running it late only means one busy day.

---

## 2. Environment

Everything is optional; the defaults are the free, offline, deterministic ones. `.env.example` is
the authoritative list — this table is the reasoning.

### Speech

| Variable                | Default  | Why it exists                                                    |
| ----------------------- | -------- | ---------------------------------------------------------------- |
| `SPEECH_PROVIDER`       | `stub`   | `stub` or `azure`. Anything else throws at startup.               |
| `AZURE_SPEECH_KEY`      | —        | Required for `azure`; missing → the app throws rather than silently scoring with the stub. |
| `AZURE_SPEECH_REGION`   | —        | e.g. `eastus`.                                                    |
| `AZURE_SPEECH_LANGUAGE` | `en-US`  | BCP-47.                                                           |
| `SPEECH_CONCURRENCY`    | `1`      | Azure F0 allows exactly one in flight. Raise **with** the tier.   |

The stub is not a test toy. It is a deterministic scorer — the same audio always produces the same
winner — which is what makes AC-S3 assertable in a black-box test, **and** it is the running mode
the product degrades to when Azure is unavailable. It never goes away.

### Storage and retention

| Variable                       | Default        | Why it exists                                              |
| ------------------------------ | -------------- | ---------------------------------------------------------- |
| `BLOB_READ_WRITE_TOKEN`        | —              | Its presence is what selects Vercel Blob over the filesystem. |
| `SPEAKING_AUDIO_DIR`           | `.data/audio`  | Where the local store writes. Git-ignored.                  |
| `SPEAKING_RETENTION_DAYS`      | `7`            | The window `/me` renders — audio older than it is audio nothing can play. |
| `SPEAKING_BLOB_CAPACITY_BYTES` | `1073741824`   | 1 GB, the Hobby tier. What retention pressure is measured against. |

Blobs are written with `access: 'private'`; playback always goes through
`GET /api/speaking/audio/{key}`, behind the same session gate as everything else, and a student can
only fetch keys under their own id.

### Timings and test seams

`SPEAKING_MIN_DURATION_MS` / `MAX` (30–90 s, SPEC §4.1), the retry and warm-up floors,
`SPEAKING_DEGRADE_AFTER_MS` (AC-S10's 20 s line, measured in the browser),
`SPEAKING_TEST_HOOKS` + `SPEAKING_TEST_HOOK_DELAY_MS`, `SPEAKING_AUDIO_PLACEHOLDER`,
`OTP_DEV_ECHO`. The last four are **refused on a production deployment** whatever the value says.
See `.env.example` for the full text.

---

## 3. What happens when a free tier runs out

IMPL §4.4 sets four red lines, and none of them is allowed to surface as an error:

| Red line                              | What crossing it looks like             | What the product does                                               |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| Resend, 100 emails/day                | OTP request fails                       | Codes print to the server log when `RESEND_API_KEY` is unset; switch to Brevo at the limit. |
| Azure F0, concurrency 1               | HTTP 429                                | Queue (1 in flight) → backoff 400/800/1600 ms → then degrade.        |
| Azure F0, 5 audio hours/month         | HTTP 403 "quota exceeded"               | No retry (the month is over) — degrade immediately.                  |
| Vercel Blob Hobby, 1 GB (~340 takes)  | Writes start failing                    | `speaking:prune` tightens 7 days → 3 days automatically past 80% full. |

**"Degrade" means the stub scores the take.** The student still gets exactly one next step — AC-S3
holds — plus a one-line notice that scoring was simplified (`today.simplifiedScoring`), and the
session records `degradedFlag = true`. The day is **not** failed and the day's allowance is **not**
consumed differently. This is IMPL §7's 「退避耗尽走 DEGRADED（已有分支），不新增失败态」.

Two things deliberately do **not** degrade:

- **A misconfiguration** (bad key, bad region, 401) is rethrown and lands on the FAILED branch
  AC-S6 already covers. Degrading it would hide a broken deployment behind plausible-looking scores.
- **The 20-second slow-network path** (AC-S10) is a *client* timer and a separate branch. Merging
  it with either failure or quota-degradation would corrupt the one signal that says whether
  scoring is too slow or actually broken.

`degradedFlag` is therefore set by two different causes and answers one question: how often was
this day not scored properly?

### Azure, specifically

One endpoint does both jobs. `assess()` sends the reference text (原则 B's phoneme mode) and
`transcribe()` sends an empty one (Azure's unscripted mode), both via the short-audio REST endpoint
with a `Pronunciation-Assessment` header. That is what makes **per-word** scores exist in both
directions — plain `format=detailed` recognition gives a confidence for the utterance only, and
per-word confidence is exactly what winner A's candidate set is drawn from (SPEC §5.3).

Known limitation, by choice: the REST endpoint takes no phrase list, so a prompt's pre-attached
lemmas are not used as a recognition bias when `azure` is active. It costs little — those words are
still the *first* place winner A looks, and the ASR confidence column is only the fallback for when
none of them scored badly.

---

## 4. The eleven-step manual pass (SPEC §12)

The MVP's automated signals are `pnpm test` (255 Vitest cases) and `pnpm e2e` (Playwright, stub
provider). This pass is what M5 adds on top: a human, a microphone, and real credentials.

Setup:

```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed
pnpm speaking:seed
pnpm dev                                  # app-web on :3000
```

1. **Import 21 valid prompts, and confirm an incomplete one is rejected.**
   `pnpm speaking:import <file.json> --dry-run` — drop a 示范音, a warm-up sentence, a third word or
   the paraphrase and it must refuse to write anything (AC-I1).
2. **A brand-new email → code → sign-in → lands on `/today`** (AC-S9). With `RESEND_API_KEY` unset
   the code is in the server log.
3. **First tap on record → permission → recording starts.** Read
   `window.__appTelemetry` in the console: `home_to_recording_ms ≤ 10000` (AC-S2).
4. **Skip the warm-up, speak ~45 s → exactly ONE next step appears** (AC-S3) → **re-record without
   leaving the screen** (AC-S4) → 「今天练完了」.
5. **Next day: speak, then press 跳过再试.** Session `COMPLETED`, `retryState = SKIPPED` (AC-S5).
6. **Re-enter the app the same day → the same session, no second prompt** (AC-I2).
7. **The following day → a different prompt** (rotation, AC-I4).
8. **Speak deliberately unclearly → winner A, and each of the ≤3 words plays** (AC-I3).
9. **Inject a scoring failure** — `SPEAKING_TEST_HOOKS=1`, then send
   `x-speaking-test-hook: fail` — the prompt survives, re-recording works, no completion row is
   written (AC-S6).
10. **After three completed days, `/me` shows a non-empty sentence.** Construct 4A/2B/1C and check
    the wording and counts, and that the server log shows **no LLM call** — there is no LLM in the
    codebase to call (决策 Q3), which is why AC-S8 holds by construction.
11. **Inject a 25 s delay that still returns 200** — `x-speaking-test-hook: slow` — the degrade
    notice appears at 20 s, skipping straight to `COMPLETED` is offered, and `degradedFlag = true`
    is recorded (AC-S10).

With Azure credentials configured, repeat steps 4 and 8 once with `SPEECH_PROVIDER=azure` to
confirm the real chain, then check the Azure portal's usage against the 5-hour monthly budget.

To exercise the degrade ladder against the real provider, set `AZURE_SPEECH_KEY` to a valid key and
`SPEECH_CONCURRENCY=1`, then submit two takes at once: the second queues rather than 429s. Setting
a deliberately wrong key instead must produce a **failure**, not a degraded score — that asymmetry
is the point.
