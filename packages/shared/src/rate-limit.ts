import { Ratelimit } from '@upstash/ratelimit'
import { getRedis } from './redis'

/**
 * Rate-limit contract — SPEC §1.5. These numbers are the contract; changing one
 * changes an acceptance criterion (AC-2), so they live in exactly one place.
 *
 * Key shape is `rl:auth:<action>:<identifier>`.
 */
export const RATE_LIMIT_PREFIX = 'rl:auth'

export const RATE_LIMITS = {
  login: { limit: 5, window: '15 m', windowSec: 15 * 60 },
  register: { limit: 5, window: '1 h', windowSec: 60 * 60 },
  'reset-req': { limit: 3, window: '1 h', windowSec: 60 * 60 },
  'reset-confirm': { limit: 5, window: '15 m', windowSec: 15 * 60 },
  // Daily-speaking OTP login (IMPL §4.5). `otp-req` is keyed by EMAIL, not by
  // IP: the abuse that actually hurts is mail-bombing one address, and the free
  // Resend tier is a hard 100 messages/day (IMPL §4.4 红线 1).
  'otp-req': { limit: 3, window: '1 h', windowSec: 60 * 60 },
  // Not in IMPL §4.5, but a six-digit code without an attempt cap is a 10^6
  // search anyone can finish. Keyed `<ip>:<email>` like login.
  'otp-verify': { limit: 5, window: '15 m', windowSec: 15 * 60 },
} as const

export type RateLimitAction = keyof typeof RATE_LIMITS

const limiters = new Map<RateLimitAction, Ratelimit>()

function getLimiter(action: RateLimitAction): Ratelimit {
  const cached = limiters.get(action)
  if (cached) return cached

  const spec = RATE_LIMITS[action]
  const limiter = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.slidingWindow(spec.limit, spec.window),
    prefix: `${RATE_LIMIT_PREFIX}:${action}`,
    analytics: false,
  })
  limiters.set(action, limiter)
  return limiter
}

export interface RateLimitVerdict {
  success: boolean
  remaining: number
  retryAfterSec: number
  key: string
}

/**
 * MUST be called BEFORE password verification / any DB write (SPEC §1.5).
 *
 * @param action     one of the four contracted auth actions
 * @param identifier e.g. `${ip}:${email}` for login, `${ip}` for register
 */
export async function checkRateLimit(
  action: RateLimitAction,
  identifier: string,
): Promise<RateLimitVerdict> {
  const key = `${RATE_LIMIT_PREFIX}:${action}:${identifier}`
  const spec = RATE_LIMITS[action]

  const result = await getLimiter(action).limit(identifier)
  const retryAfterMs = Math.max(0, result.reset - Date.now())

  return {
    success: result.success,
    remaining: result.remaining,
    // Never report 0s: clients would hot-loop. Fall back to the full window.
    retryAfterSec: result.success
      ? 0
      : Math.max(1, Math.ceil(retryAfterMs / 1000)) || spec.windowSec,
    key,
  }
}
