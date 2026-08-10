import { redirect } from '@/i18n/navigation'
import { getVerifiedAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function IndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const admin = await getVerifiedAdmin()
  redirect({ href: admin ? '/dashboard' : '/login', locale })
}
