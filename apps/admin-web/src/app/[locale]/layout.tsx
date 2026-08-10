import { AntdRegistry } from '@ant-design/nextjs-registry'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AntdProvider } from '@/components/AntdProvider'
import { isAppLocale, routing } from '@/i18n/routing'
import '../globals.css'

export const metadata: Metadata = {
  title: 'Admin Console',
  description: 'APP Platform — backoffice',
  robots: { index: false, follow: false },
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isAppLocale(locale)) notFound()

  const messages = await getMessages()

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <AntdRegistry>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <AntdProvider locale={locale}>{children}</AntdProvider>
          </NextIntlClientProvider>
        </AntdRegistry>
      </body>
    </html>
  )
}
