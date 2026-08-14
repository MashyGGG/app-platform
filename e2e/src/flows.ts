import { type APIRequestContext } from '@playwright/test'
import { jsonOf } from './http'

/**
 * Thin, typed wrappers over the two apps' HTTP contracts. Specs read as
 * behaviour ("an operator cannot create an admin") instead of as URLs, and when
 * a route or payload changes there is exactly one place to follow it.
 */

export interface AppUser {
  id: string
  email: string
  name: string | null
  locale: string
  status: 'active' | 'disabled'
  createdAt: string
}

export interface AdminUser {
  id: string
  email: string
  name: string | null
  status: 'active' | 'disabled'
  role: 'super_admin' | 'operator' | null
  isSelf: boolean
}

export interface Page<T> {
  total: number
  page: number
  pageSize: number
  items: T[]
}

export interface AuditEntry {
  id: string
  action: string
  targetType: string
  targetId: string
  meta: Record<string, unknown> | null
  ip: string | null
  createdAt: string
  actor: { id: string; email: string; name: string | null }
}

// --- authentication ---------------------------------------------------------

/** Signs the context in; the session cookie lands in its jar. Asserts success. */
export async function signIn(
  ctx: APIRequestContext,
  credentials: { email: string; password: string },
): Promise<void> {
  const res = await ctx.post('/api/auth/login', { data: credentials })
  await jsonOf(res, 200)
}

/**
 * Signs the context in with a one-time code, creating the account on the way if
 * it is new (AC-S9). The code comes back in the request response because these
 * servers run with `OTP_DEV_ECHO=1`; there is no mailbox to read.
 *
 * Preferred over `registerAppUser` for daily-speaking specs: it yields an
 * account nobody else is practising with, so its one session per day is ours.
 */
export async function signInWithOtp(ctx: APIRequestContext, email: string): Promise<void> {
  const issued = await jsonOf<{ devCode?: string }>(
    await ctx.post('/api/auth/otp/request', { data: { email, locale: 'en' } }),
    200,
  )
  if (!issued.devCode) {
    throw new Error('the OTP request did not echo a code — is OTP_DEV_ECHO=1 set for this server?')
  }
  await jsonOf(
    await ctx.post('/api/auth/otp/verify', { data: { email, code: issued.devCode } }),
    200,
  )
}

export async function registerAppUser(
  ctx: APIRequestContext,
  input: { email: string; password: string; name?: string; locale?: 'zh' | 'en' },
): Promise<void> {
  const res = await ctx.post('/api/auth/register', { data: input })
  await jsonOf(res, 200)
}

// --- admin-web: APP users ---------------------------------------------------

export async function createAppUser(
  admin: APIRequestContext,
  input: { email: string; password: string; name?: string; locale?: 'zh' | 'en' },
): Promise<AppUser> {
  const body = await jsonOf<{ user: AppUser }>(
    await admin.post('/api/app-users/create', { data: input }),
    200,
  )
  return body.user
}

export async function listAppUsers(
  admin: APIRequestContext,
  query: { q?: string; status?: 'active' | 'disabled'; page?: number; pageSize?: number } = {},
): Promise<Page<AppUser>> {
  return jsonOf<Page<AppUser>>(await admin.get('/api/app-users', { params: query }), 200)
}

/** Exact-email lookup. The list endpoint only does `contains`, so filter here. */
export async function findAppUser(
  admin: APIRequestContext,
  email: string,
): Promise<AppUser | undefined> {
  const page = await listAppUsers(admin, { q: email, pageSize: 100 })
  return page.items.find((u) => u.email === email.toLowerCase())
}

export async function setAppUserStatus(
  admin: APIRequestContext,
  userId: string,
  status: 'active' | 'disabled',
): Promise<{ changed: boolean }> {
  return jsonOf<{ changed: boolean }>(
    await admin.post('/api/app-users/status', { data: { userId, status } }),
    200,
  )
}

// --- admin-web: backoffice users --------------------------------------------

export async function listAdminUsers(
  admin: APIRequestContext,
  query: { q?: string; pageSize?: number } = {},
): Promise<Page<AdminUser>> {
  return jsonOf<Page<AdminUser>>(await admin.get('/api/admin-users', { params: query }), 200)
}

export async function findAdminUser(
  admin: APIRequestContext,
  email: string,
): Promise<AdminUser | undefined> {
  const page = await listAdminUsers(admin, { q: email, pageSize: 100 })
  return page.items.find((u) => u.email === email.toLowerCase())
}

// --- admin-web: audit -------------------------------------------------------

/**
 * Finds the audit row a mutation must have written. Audit is append-only and
 * ordered `createdAt desc`, so the row we want is near the front — but other
 * specs run in parallel, hence the explicit `targetId` match rather than "the
 * first row".
 */
export async function expectAudited(
  admin: APIRequestContext,
  action: string,
  targetId: string,
): Promise<AuditEntry> {
  const page = await jsonOf<Page<AuditEntry>>(
    await admin.get('/api/audit-logs', { params: { action, pageSize: 100 } }),
    200,
  )
  const entry = page.items.find((item) => item.targetId === targetId)
  if (!entry) {
    throw new Error(
      `no ${action} audit row for target ${targetId} — a mutation succeeded unaudited, ` +
        `which the write+audit transaction is supposed to make impossible`,
    )
  }
  return entry
}
