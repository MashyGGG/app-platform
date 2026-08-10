import 'server-only'
import { API_ERROR, checkRateLimit, errorBody, jsonError, type RateLimitAction } from '@app/shared'

export function jsonOk<T extends object>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
}

export { jsonError }

export async function enforceRateLimit(
  action: RateLimitAction,
  identifier: string,
): Promise<Response | null> {
  const verdict = await checkRateLimit(action, identifier)
  if (verdict.success) return null
  return jsonError(API_ERROR.RATE_LIMITED, { retryAfterSec: verdict.retryAfterSec })
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

export function internalError(error: unknown): Response {
  console.error('[api] unhandled error', error)
  return new Response(JSON.stringify(errorBody(API_ERROR.INTERNAL)), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  })
}
