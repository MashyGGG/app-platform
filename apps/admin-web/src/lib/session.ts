import 'server-only'
import { redirect } from 'next/navigation'
import { prisma } from '@app/db'
import { API_ERROR, errorBody, errorStatus, type AdminRoleName } from '@app/shared'
import { auth } from '@/auth'
import { expiredSessionCookie } from '@/lib/cookies'
import { can, type Permission } from '@/lib/rbac'

export interface AdminIdentity {
  id: string
  email: string
  name: string | null
  role: AdminRoleName
}

/**
 * ============================================================================
 * RBAC enforcement layer 2 — the authoritative one (SPEC §1.4, §1.7).
 * ============================================================================
 * Re-reads BOTH `User.status` and `AdminProfile.role` from PostgreSQL on every
 * request. A still-valid JWT for a disabled or demoted admin is worthless here
 * (AC-6 / AC-8). Middleware (layer 1) and hidden UI (layer 3) are conveniences;
 * this is the gate that decides.
 */
export async function getVerifiedAdmin(): Promise<AdminIdentity | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      adminProfile: { select: { role: true } },
    },
  })

  if (!user || user.status !== 'active' || !user.adminProfile) return null

  return { id: user.id, email: user.email, name: user.name, role: user.adminProfile.role }
}

/** Server Components. Sends unauthorised visitors through a cookie-clearing route. */
export async function requireAdmin(
  locale: string,
  permission?: Permission,
): Promise<AdminIdentity> {
  const admin = await getVerifiedAdmin()
  if (!admin) {
    redirect(`/api/auth/force-signout?locale=${encodeURIComponent(locale)}`)
  }
  if (permission && !can(admin.role, permission)) {
    redirect(`/${locale}/dashboard?denied=1`)
  }
  return admin
}

/** Route Handlers. Returns the admin, or a ready-to-return 401/403 Response. */
export async function requireApiAdmin(
  permission?: Permission,
): Promise<{ ok: true; admin: AdminIdentity } | { ok: false; response: Response }> {
  const admin = await getVerifiedAdmin()

  if (!admin) {
    const response = jsonErrorResponse(API_ERROR.UNAUTHORIZED)
    response.headers.append('set-cookie', expiredSessionCookie())
    return { ok: false, response }
  }

  // AC-7 — an operator hitting an admin-user endpoint gets a real 403.
  if (permission && !can(admin.role, permission)) {
    return { ok: false, response: jsonErrorResponse(API_ERROR.FORBIDDEN) }
  }

  return { ok: true, admin }
}

function jsonErrorResponse(code: typeof API_ERROR.UNAUTHORIZED | typeof API_ERROR.FORBIDDEN) {
  return new Response(JSON.stringify(errorBody(code)), {
    status: errorStatus(code),
    headers: { 'content-type': 'application/json' },
  })
}
