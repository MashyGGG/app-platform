'use client'

import { GlobalOutlined } from '@ant-design/icons'
import { Select } from 'antd'
import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'
import { locales } from '@/i18n/routing'

/** AC-12 — language toggle, available on every screen. */
export function LocaleSwitcher() {
  const t = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  return (
    <Select
      aria-label={t('language')}
      value={locale}
      loading={pending}
      variant="borderless"
      suffixIcon={<GlobalOutlined />}
      onChange={(next) => {
        startTransition(() => {
          router.replace(pathname, { locale: next })
        })
      }}
      options={locales.map((l) => ({ value: l, label: t(l) }))}
    />
  )
}
