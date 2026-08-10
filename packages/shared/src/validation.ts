import { z } from 'zod'
import { AUDIT_ACTIONS } from './audit'

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email({ message: 'errors.invalidEmail' })

export const passwordSchema = z
  .string()
  .min(8, { message: 'errors.passwordTooShort' })
  .max(128, { message: 'errors.passwordTooLong' })
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'errors.passwordTooWeak',
  })

export const localeSchema = z.enum(['zh', 'en'])
export type Locale = z.infer<typeof localeSchema>

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80).optional(),
  locale: localeSchema.optional(),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
})

export const forgotPasswordSchema = z.object({
  email: emailSchema,
  locale: localeSchema.optional(),
})

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  email: emailSchema,
  password: passwordSchema,
})

export const adminRoleSchema = z.enum(['super_admin', 'operator'])
export type AdminRoleName = z.infer<typeof adminRoleSchema>

export const userStatusSchema = z.enum(['active', 'disabled'])
export type UserStatusName = z.infer<typeof userStatusSchema>

/**
 * Admin: create an APP user from the console.
 *
 * Same shape as `registerSchema` minus the self-service parts: the admin picks
 * the initial password, so `passwordSchema` is reused rather than relaxed — a
 * console-created account must not be weaker than a self-registered one.
 */
export const appUserCreateSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80).optional(),
  locale: localeSchema.optional(),
})
export type AppUserCreateInput = z.infer<typeof appUserCreateSchema>

/** Admin: edit an APP user's basic info (SPEC §1.7 — operator may do this). */
export const appUserUpdateSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().max(80).nullable().optional(),
  locale: localeSchema.optional(),
})

export const setStatusSchema = z.object({
  userId: z.string().min(1),
  status: userStatusSchema,
})

/** Admin: create a backoffice user (super_admin only). */
export const adminUserCreateSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80).optional(),
  role: adminRoleSchema,
})

export const adminUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: adminRoleSchema,
})

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: userStatusSchema.optional(),
})
export type ListQuery = z.infer<typeof listQuerySchema>

export const auditActionSchema = z.enum(AUDIT_ACTIONS)

export const auditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: auditActionSchema.optional(),
})

/** Flattens a ZodError into the `details` field of the API error envelope. */
export function zodDetails(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    ;(out[key] ??= []).push(issue.message)
  }
  return out
}
