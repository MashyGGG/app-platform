import { Card } from 'antd'
import type { ReactNode } from 'react'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'
import { Paragraph, Title } from '@/components/typography'

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-2 flex justify-end">
          <LocaleSwitcher />
        </div>
        <Card>
          <Title level={3} style={{ marginBottom: 4 }}>
            {title}
          </Title>
          {subtitle ? <Paragraph type="secondary">{subtitle}</Paragraph> : null}
          {children}
        </Card>
      </div>
    </main>
  )
}
