import { defineRouting } from 'next-intl/routing'

export const locales = ['zh', 'en'] as const
export type AppLocale = (typeof locales)[number]

export const routing = defineRouting({
  locales,
  defaultLocale: 'zh',
  localePrefix: 'always',
})

export function isAppLocale(value: string | undefined): value is AppLocale {
  return !!value && (locales as readonly string[]).includes(value)
}
