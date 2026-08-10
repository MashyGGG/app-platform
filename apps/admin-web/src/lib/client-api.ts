export interface ApiFailure {
  error: string
  messageKey: string
  retryAfterSec?: number
  details?: Record<string, string[]>
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure }

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, init)
    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        ok: false,
        failure: (data as ApiFailure) ?? { error: 'INTERNAL', messageKey: 'errors.internal' },
      }
    }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, failure: { error: 'NETWORK', messageKey: 'errors.network' } }
  }
}

/** Every API error carries an i18n `messageKey` — never render `error` directly. */
export function getJson<T>(url: string): Promise<ApiResult<T>> {
  return request<T>(url, { cache: 'no-store' })
}

export function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export interface Paged<T> {
  total: number
  page: number
  pageSize: number
  items: T[]
}
