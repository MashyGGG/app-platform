import { prisma } from '@app/db'
import { API_ERROR, listQuerySchema, zodDetails } from '@app/shared'
import { internalError, jsonError, jsonOk } from '@/lib/api'
import { requireApiAdmin } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** APP users = User rows WITHOUT an AdminProfile (SPEC §2). */
export async function GET(request: Request) {
  const gate = await requireApiAdmin('appUser.view')
  if (!gate.ok) return gate.response

  const url = new URL(request.url)
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return jsonError(API_ERROR.VALIDATION_FAILED, { details: zodDetails(parsed.error) })
  }

  const { page, pageSize, q, status } = parsed.data

  try {
    const where = {
      adminProfile: { is: null },
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { name: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          locale: true,
          status: true,
          createdAt: true,
        },
      }),
    ])

    return jsonOk({ total, page, pageSize, items })
  } catch (error) {
    return internalError(error)
  }
}
