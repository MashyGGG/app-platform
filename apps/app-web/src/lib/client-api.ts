export interface ApiFailure {
  error: string
  messageKey: string
  retryAfterSec?: number
  details?: Record<string, string[]>
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure }

/** Every API error already carries an i18n `messageKey` — never render `error`. */
export async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

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
