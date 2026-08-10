import { redirect } from '@/i18n/navigation'
import { getVerifiedUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function IndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const user = await getVerifiedUser()
  redirect({ href: user ? '/home' : '/login', locale })
}
