/**
 * What sits between the product and a real speech vendor (IMPL §7).
 *
 * Azure Speech F0 — the tier this MVP starts on — allows exactly ONE concurrent
 * request and 5 audio hours a month. Two students pressing 提交 in the same
 * second is therefore not an edge case, it is Tuesday, and it comes back as a
 * 429. So every call goes through three layers, in this order:
 *
 *   1. a concurrency queue, so we do not generate the 429 ourselves;
 *   2. exponential backoff, for the ones the queue could not prevent;
 *   3. a fallback to the stub provider, so that running out of free quota
 *      DEGRADES the day instead of failing it.
 *
 * Layer 3 is the important one and it is why this file exists at all. IMPL §7:
 * 「退避耗尽走 DEGRADED（已有分支），不新增失败态」. The student still gets exactly
 * one next step; the session merely records that the rule layer produced it.
 *
 * Everything here is pure except `sleep`, which is injected — which is what
 * lets Vitest drive the whole ladder without a timer or a network.
 */
import type {
  AssessResult,
  SpeechContext,
  SpeechDegradation,
  SpeechFailureKind,
  SpeechProvider,
  TranscribeResult,
} from './speech'

export class SpeechProviderError extends Error {
  readonly kind: SpeechFailureKind
  readonly status?: number
  /** Honoured ahead of the computed backoff when the vendor sends `Retry-After`. */
  readonly retryAfterMs?: number

  constructor(
    kind: SpeechFailureKind,
    message: string,
    options: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(message)
    this.name = 'SpeechProviderError'
    this.kind = kind
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
  }
}

/**
 * HTTP status → what to do about it.
 *
 * 403 is the ambiguous one: Azure returns it both for a forbidden key and for a
 * spent quota, and the two want opposite handling. The body carries the word
 * ("quota", "exceeded"), so it is read — and when it does not, the safer read
 * is `permanent`: a bad key that silently degrades everyone to stub scoring is
 * a much quieter failure than one that shows up as a 500.
 */
export function classifyStatus(status: number, body = ''): SpeechFailureKind {
  const mentionsQuota = /quota|exceed|limit/i.test(body)

  if (status === 429) return 'throttled'
  if (status === 403 || status === 402) return mentionsQuota ? 'quota' : 'permanent'
  if (status === 408 || status >= 500) return 'transient'
  return 'permanent'
}

/** Anything that is not already a `SpeechProviderError` — a socket drop, a DNS blip. */
export function classifyThrown(error: unknown): SpeechFailureKind {
  return error instanceof SpeechProviderError ? error.kind : 'transient'
}

export interface BackoffOptions {
  /** How many EXTRA attempts follow the first one. */
  retries: number
  baseDelayMs: number
  maxDelayMs: number
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  retries: 3,
  baseDelayMs: 400,
  maxDelayMs: 4_000,
}

/**
 * The delay before attempt n+1, doubling and capped: 400 / 800 / 1600 by
 * default, so a fully-retried call adds 2.8 s — real against SPEC §4.3's 8 s
 * target, but nowhere near the 20 s degrade line (AC-S10).
 *
 * Deliberately deterministic (no jitter). The queue below is what spreads load
 * here; a single-slot queue has nothing to thunder against, and a Vitest row is
 * worth more than randomness this tier will never notice.
 */
export function backoffDelaysMs(options: BackoffOptions = DEFAULT_BACKOFF): number[] {
  return Array.from({ length: Math.max(0, options.retries) }, (_, index) =>
    Math.min(options.baseDelayMs * 2 ** index, options.maxDelayMs),
  )
}

/**
 * FIFO, at most `limit` in flight. `limit` is 1 for Azure F0 — the free tier's
 * concurrency, expressed as the one number it actually is.
 *
 * FIFO matters: a student who pressed 提交 first should not be overtaken while
 * they watch a spinner and the 20 s line approaches.
 */
export function createConcurrencyQueue(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  const waiting: Array<() => void> = []
  let running = 0

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    running += 1
    try {
      return await task()
    } finally {
      running -= 1
      waiting.shift()?.()
    }
  }
}

export interface ResilienceOptions {
  /** Azure F0 allows 1. Raise it with the tier, never above it. */
  concurrency?: number
  backoff?: BackoffOptions
  sleep?: (ms: number) => Promise<void>
  /** Called once per fallback, so the deployment can count how often free quota runs out. */
  onFallback?: (degradation: SpeechDegradation) => void
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * `primary` guarded by the three layers, falling back to `fallback`.
 *
 * The returned provider keeps `primary`'s name: this is the same provider with
 * the free tier's realities attached, and callers that log `provider.name` want
 * to know which vendor was configured, not which one answered a given call —
 * that question is answered per result, by `degraded`.
 */
export function withSpeechResilience(
  primary: SpeechProvider,
  fallback: SpeechProvider,
  options: ResilienceOptions = {},
): SpeechProvider {
  const queue = createConcurrencyQueue(Math.max(1, options.concurrency ?? 1))
  const delays = backoffDelaysMs(options.backoff ?? DEFAULT_BACKOFF)
  const sleep = options.sleep ?? defaultSleep

  async function attempt<T>(task: () => Promise<T>): Promise<T> {
    let lastKind: SpeechFailureKind = 'transient'

    for (let index = 0; index <= delays.length; index += 1) {
      try {
        return await queue(task)
      } catch (error) {
        lastKind = classifyThrown(error)

        // A misconfiguration must stay loud: retrying it wastes the student's
        // seconds and degrading it hides a broken deployment behind scores that
        // look plausible. This is the FAILED branch AC-S6 already covers.
        if (lastKind === 'permanent') throw error
        // Quota is not retryable by definition — the month is spent.
        if (lastKind === 'quota') break

        const wait = delays[index]
        if (wait === undefined) break
        // `Retry-After` is the vendor telling us when its slot frees up; it wins
        // over our schedule whenever it asks for longer.
        const retryAfter = error instanceof SpeechProviderError ? (error.retryAfterMs ?? 0) : 0
        await sleep(Math.max(retryAfter, wait))
      }
    }

    throw new SpeechProviderError(lastKind, `${primary.name} unavailable after retries`)
  }

  async function guarded<T extends { degraded?: SpeechDegradation }>(
    task: () => Promise<T>,
    degradedTask: () => Promise<T>,
  ): Promise<T> {
    try {
      return await attempt(task)
    } catch (error) {
      if (classifyThrown(error) === 'permanent') throw error

      const degraded: SpeechDegradation = { provider: fallback.name, reason: classifyThrown(error) }
      options.onFallback?.(degraded)
      return { ...(await degradedTask()), degraded }
    }
  }

  return {
    name: primary.name,

    transcribe(audio: Uint8Array, context?: SpeechContext): Promise<TranscribeResult> {
      return guarded(
        () => primary.transcribe(audio, context),
        () => fallback.transcribe(audio, context),
      )
    },

    assess(audio: Uint8Array, referenceText: string): Promise<AssessResult> {
      return guarded(
        () => primary.assess(audio, referenceText),
        () => fallback.assess(audio, referenceText),
      )
    },
  }
}
