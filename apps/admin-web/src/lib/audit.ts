import 'server-only'
import type { Prisma } from '@app/db'
import { AUDIT_TARGET_USER, type AuditActionName } from '@app/shared'

export interface AuditInput {
  actorUserId: string
  action: AuditActionName
  targetId: string
  targetType?: string
  meta?: Prisma.InputJsonValue
  ip?: string | null
}

/**
 * Audit contract — SPEC §1.6.
 *
 * Returns a Prisma create operation to be included in the SAME `$transaction`
 * as the write it describes. That is deliberate: if the audit insert fails the
 * business write rolls back with it, so an audit row can never be silently
 * dropped. Callers must not "fire and forget" this.
 */
export function auditCreate(input: AuditInput): Prisma.AuditLogCreateArgs {
  return {
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType ?? AUDIT_TARGET_USER,
      targetId: input.targetId,
      meta: input.meta,
      ip: input.ip ?? null,
    },
  }
}
