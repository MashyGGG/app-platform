import 'server-only'
import { prisma } from '@app/db'
import { getRedis, isRedisConfigured } from '@app/shared'

/** SPEC §1.5 — dashboard cache key and TTL are part of the contract. */
export const DASHBOARD_CACHE_KEY = 'cache:dash:summary'
export const DASHBOARD_CACHE_TTL_SEC = 60

export interface DashboardSummary {
  appUsers: number
  appUsersDisabled: number
  adminUsers: number
  superAdmins: number
  operators: number
  newUsers7d: number
  auditLogs: number
  auditLogs24h: number
  generatedAt: string
}

async function computeSummary(): Promise<DashboardSummary> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [appUsers, appUsersDisabled, superAdmins, operators, newUsers7d, auditLogs, auditLogs24h] =
    await Promise.all([
      // "APP user" = a User with no AdminProfile (SPEC §2).
      prisma.user.count({ where: { adminProfile: { is: null } } }),
      prisma.user.count({ where: { adminProfile: { is: null }, status: 'disabled' } }),
      prisma.adminProfile.count({ where: { role: 'super_admin' } }),
      prisma.adminProfile.count({ where: { role: 'operator' } }),
      prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      prisma.auditLog.count(),
      prisma.auditLog.count({ where: { createdAt: { gte: since24h } } }),
    ])

  return {
    appUsers,
    appUsersDisabled,
    adminUsers: superAdmins + operators,
    superAdmins,
    operators,
    newUsers7d,
    auditLogs,
    auditLogs24h,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * AC-9 — aggregate metrics, cached in Redis for 60s. Redis is a cache only:
 * a cache miss (or no Redis at all) still returns correct data from PostgreSQL.
 */
export async function getDashboardSummary(): Promise<{ data: DashboardSummary; cached: boolean }> {
  if (!isRedisConfigured()) {
    return { data: await computeSummary(), cached: false }
  }

  const redis = getRedis()

  try {
    const cached = await redis.get<DashboardSummary>(DASHBOARD_CACHE_KEY)
    if (cached) return { data: cached, cached: true }
  } catch (error) {
    console.warn('[dashboard] cache read failed, falling back to DB', error)
  }

  const data = await computeSummary()

  try {
    await redis.set(DASHBOARD_CACHE_KEY, data, { ex: DASHBOARD_CACHE_TTL_SEC })
  } catch (error) {
    console.warn('[dashboard] cache write failed', error)
  }

  return { data, cached: false }
}
