/**
 * Uniform JSON error envelope. `messageKey` is an i18n key — never ship a
 * hard-coded English string to the client (SPEC §1.5).
 */
export interface ApiErrorBody {
  error: string
  messageKey: string
  retryAfterSec?: number
  details?: Record<string, string[]>
}

export const API_ERROR = {
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INTERNAL: 'INTERNAL',
} as const

export type ApiErrorCode = (typeof API_ERROR)[keyof typeof API_ERROR]

const MESSAGE_KEYS: Record<ApiErrorCode, string> = {
  RATE_LIMITED: 'errors.rateLimited',
  VALIDATION_FAILED: 'errors.validationFailed',
  INVALID_CREDENTIALS: 'errors.invalidCredentials',
  EMAIL_TAKEN: 'errors.emailTaken',
  ACCOUNT_DISABLED: 'errors.accountDisabled',
  UNAUTHORIZED: 'errors.unauthorized',
  FORBIDDEN: 'errors.forbidden',
  NOT_FOUND: 'errors.notFound',
  INVALID_TOKEN: 'errors.invalidToken',
  INTERNAL: 'errors.internal',
}

const STATUS: Record<ApiErrorCode, number> = {
  RATE_LIMITED: 429,
  VALIDATION_FAILED: 400,
  INVALID_CREDENTIALS: 401,
  EMAIL_TAKEN: 409,
  ACCOUNT_DISABLED: 403,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_TOKEN: 400,
  INTERNAL: 500,
}

export function errorBody(code: ApiErrorCode, extra?: Partial<ApiErrorBody>): ApiErrorBody {
  return { error: code, messageKey: MESSAGE_KEYS[code], ...extra }
}

export function errorStatus(code: ApiErrorCode): number {
  return STATUS[code]
}

export function jsonError(code: ApiErrorCode, extra?: Partial<ApiErrorBody>): Response {
  const body = errorBody(code, extra)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (code === API_ERROR.RATE_LIMITED && body.retryAfterSec != null) {
    headers['retry-after'] = String(body.retryAfterSec)
  }
  return new Response(JSON.stringify(body), { status: errorStatus(code), headers })
}
