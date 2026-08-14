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
