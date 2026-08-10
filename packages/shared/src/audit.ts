/**
 * Audit contract — SPEC §1.6. The closed action set is mirrored by the
 * `AuditAction` enum in packages/db/prisma/schema.prisma; both must change
 * together (a migration is required, which is the point).
 */
export const AUDIT_ACTIONS = [
  'APP_USER_UPDATE',
  'APP_USER_DISABLE',
  'APP_USER_ENABLE',
  'ADMIN_USER_CREATE',
  'ADMIN_USER_UPDATE_ROLE',
  'ADMIN_USER_DISABLE',
  'ADMIN_USER_ENABLE',
] as const

export type AuditActionName = (typeof AUDIT_ACTIONS)[number]

export function isAuditAction(value: string): value is AuditActionName {
  return (AUDIT_ACTIONS as readonly string[]).includes(value)
}

/** Every first-phase audit row targets a User row. */
export const AUDIT_TARGET_USER = 'User' as const
