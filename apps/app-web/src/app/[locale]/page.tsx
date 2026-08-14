import { redirect } from '@/i18n/navigation'
import { getVerifiedUser } from '@/lib/session'
import { POST_AUTH_LANDING } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export default async function IndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const user = await getVerifiedUser()
  redirect({ href: user ? POST_AUTH_LANDING : '/login', locale })
}
