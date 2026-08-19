import 'server-only'
import {
  DEFAULT_MAX_DURATION_MS,
  DEFAULT_MIN_DURATION_MS,
  type AudioLimits,
} from '@app/shared/speaking'

/**
 * Every environment knob the daily-speaking product reads, in one file so the
 * deployment contract is greppable (and so no route invents its own default).
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * SPEC §4.1 says 30–90 s and that is the production contract. The override
 * exists for the e2e suite alone: a browser spec that has to speak for a real
 * 30 seconds turns a 20-second suite into a five-minute one, while the 30 s
 * boundary itself is already a Vitest row (`wav.test.ts`).
 */
export function audioLimits(): AudioLimits {
  return {
    minDurationMs: intFromEnv('SPEAKING_MIN_DURATION_MS', DEFAULT_MIN_DURATION_MS),
    maxDurationMs: intFromEnv('SPEAKING_MAX_DURATION_MS', DEFAULT_MAX_DURATION_MS),
  }
}

/**
 * SPEC §4.1's 30–90 s window is the MAIN take's contract; the retry is a
 * different act. Winner A asks for "再读 ≤3 个词", B for one model sentence, C
 * for one more sentence — none of which take thirty seconds to say. Holding the
 * retry to the main floor would reject the very thing the coach line asked for
 * and strand the student on P3, which is the one place AC-S5 must not strand
 * them. The ceiling stays: it is the upload budget, not a product rule.
 */
export const DEFAULT_RETRY_MIN_DURATION_MS = 2_000

export function retryAudioLimits(): AudioLimits {
  return {
    minDurationMs: intFromEnv('SPEAKING_RETRY_MIN_DURATION_MS', DEFAULT_RETRY_MIN_DURATION_MS),
    maxDurationMs: audioLimits().maxDurationMs,
  }
}

/**
 * P1 热身 — one sentence read against a reference text (AC-S7), not an answer.
 *
 * A different act again, so a different window: the floor only has to be long
 * enough that an empty take is caught, and the ceiling only long enough for one
 * sentence said slowly. Holding the warm-up to the main take's 30 s would turn
 * an optional beat into the longest one in the session.
 */
export const DEFAULT_WARMUP_MIN_DURATION_MS = 1_000
export const DEFAULT_WARMUP_MAX_DURATION_MS = 30_000

export function warmupAudioLimits(): AudioLimits {
  return {
    minDurationMs: intFromEnv('SPEAKING_WARMUP_MIN_DURATION_MS', DEFAULT_WARMUP_MIN_DURATION_MS),
    maxDurationMs: intFromEnv('SPEAKING_WARMUP_MAX_DURATION_MS', DEFAULT_WARMUP_MAX_DURATION_MS),
  }
}

/**
 * AC-S10 — 「超过 20s 但未报错」的降级线.
 *
 * Measured on the CLIENT, and deliberately so (IMPL §4.5): the server cannot
 * know how long the student has been staring at a spinner, and the request is
 * not cancelled when the line is crossed — it keeps running, and its result is
 * still rendered if the student is still there. The override exists so the e2e
 * suite can cross this line in seconds rather than in twenty.
 */
export const DEFAULT_DEGRADE_AFTER_MS = 20_000

export function degradeAfterMs(): number {
  return intFromEnv('SPEAKING_DEGRADE_AFTER_MS', DEFAULT_DEGRADE_AFTER_MS)
}

/**
 * The two failure shapes AC-S6 and AC-S10 are about — a 500, and a slow-but-fine
 * response — cannot be produced by a black-box test any other way: the stub
 * provider is deterministic and never fails, which is the whole point of it.
 *
 * So the suite asks for them explicitly, per request (IMPL §4.2). Off unless
 * `SPEAKING_TEST_HOOKS=1`, and refused outright on a production deployment —
 * the same belt-and-braces as `SPEAKING_AUDIO_PLACEHOLDER` and `OTP_DEV_ECHO`.
 */
export function testHooksEnabled(): boolean {
  return process.env.SPEAKING_TEST_HOOKS === '1' && process.env.VERCEL_ENV !== 'production'
}

/** How long `SPEAKING_TEST_HOOK=slow` stalls — past the 20 s line by default. */
export const DEFAULT_TEST_HOOK_DELAY_MS = 25_000

export function testHookDelayMs(): number {
  return intFromEnv('SPEAKING_TEST_HOOK_DELAY_MS', DEFAULT_TEST_HOOK_DELAY_MS)
}

/** Local directory the dev/e2e AudioStore writes to. Git-ignored. */
export function audioDir(): string {
  return process.env.SPEAKING_AUDIO_DIR ?? '.data/audio'
}

/**
 * Serve a silent WAV for a key the store does not hold.
 *
 * The seeded prompts reference 示范音 keys (`seed/words/plan.mp3`) whose files
 * are content ops has not produced yet. In development and e2e a placeholder
 * keeps the player real instead of leaving a dead <audio>; in production a
 * missing 示范音 must stay a visible 404, because a pronunciation product whose
 * model audio is silence is worse than one that admits the gap.
 */
export function servesAudioPlaceholder(): boolean {
  return process.env.SPEAKING_AUDIO_PLACEHOLDER === '1' && process.env.VERCEL_ENV !== 'production'
}
