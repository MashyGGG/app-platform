import type { ReactNode } from 'react'
import { ConsoleShell } from '@/components/ConsoleShell'
import { SignOutButton } from '@/components/SignOutButton'
import { requireAdmin } from '@/lib/session'

// Never statically rendered: the AdminProfile + status check must run per request.
export const dynamic = 'force-dynamic'

export default async function ConsoleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  // AC-6 / AC-8 — no AdminProfile, or a disabled account, never gets past here,
  // no matter how valid the JWT in the cookie is.
  const admin = await requireAdmin(locale)

  return (
    <ConsoleShell role={admin.role} email={admin.email} signOutSlot={<SignOutButton />}>
      {children}
    </ConsoleShell>
  )
}
