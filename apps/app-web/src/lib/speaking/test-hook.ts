import 'server-only'
import { TEST_HOOK_HEADER, parseTestHook, type SpeakingTestHook } from '@app/shared/speaking'
import { testHookDelayMs, testHooksEnabled } from './config'

/**
 * The server half of the per-request test hooks — see
 * `packages/shared/src/speaking/test-hook.ts` for what they are and why they
 * exist. This file is the gate and the effect; the protocol is pure and lives
 * there.
 */

export function readTestHook(request: Request): SpeakingTestHook | null {
  // The gate. Off unless SPEAKING_TEST_HOOKS=1, and refused outright on a
  // production deployment — so on a real deployment this always returns null.
  if (!testHooksEnabled()) return null
  return parseTestHook(request.headers.get(TEST_HOOK_HEADER), request.headers.get('cookie'))
}

/**
 * Applied INSIDE the route's `try`, before the real work, so `fail` travels the
 * exact path a genuine provider error would — `markSessionFailed` and the 500
 * envelope included. A hook that took its own shortcut would be testing itself.
 */
export async function applyTestHook(hook: SpeakingTestHook | null): Promise<void> {
  if (hook === 'fail') {
    throw new Error('injected scoring failure (speaking test hook)')
  }
  if (hook === 'slow') {
    await new Promise((resolve) => setTimeout(resolve, testHookDelayMs()))
  }
}
