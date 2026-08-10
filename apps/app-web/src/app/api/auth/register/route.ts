import { prisma } from '@app/db'
import { API_ERROR, clientIp, hashPassword, registerSchema, zodDetails } from '@app/shared'
import { signIn } from '@/auth'
import { enforceRateLimit, internalError, jsonError, jsonOk, readJson } from '@/lib/api'

export const runtime = 'nodejs'

/** AC-1 — register, then sign the new user straight in. */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request.headers)

    // SPEC §1.5: throttle before any DB work.
    const throttled = await enforceRateLimit('register', ip)
    if (throttled) return throttled

    const parsed = registerSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
    }

    const { email, password, name, locale } = parsed.data

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) return jsonError(API_ERROR.EMAIL_TAKEN)

    const passwordHash = await hashPassword(password)
    await prisma.user.create({
      data: { email, name: name ?? null, passwordHash, locale: locale ?? 'zh', status: 'active' },
    })

    await signIn('credentials', { redirect: false, email, password })

    return jsonOk({ ok: true, redirectTo: `/${locale ?? 'zh'}/home` })
  } catch (error) {
    return internalError(error)
  }
}
