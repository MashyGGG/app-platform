export interface ApiFailure {
  error: string
  messageKey: string
  retryAfterSec?: number
  details?: Record<string, string[]>
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure }

/** Every API error already carries an i18n `messageKey` — never render `error`. */
export async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return post(url, JSON.stringify(body), 'application/json')
}

/**
 * For the one endpoint whose body is a file: a take is a single ~3 MB WAV with
 * no accompanying fields, so multipart would only add a parser to both ends.
 */
export async function postBinary<T>(
  url: string,
  body: Uint8Array,
  contentType: string,
): Promise<ApiResult<T>> {
  return post(url, body as unknown as BodyInit, contentType)
}

async function post<T>(url: string, body: BodyInit, contentType: string): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
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
