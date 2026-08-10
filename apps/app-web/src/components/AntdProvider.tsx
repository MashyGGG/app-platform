'use client'

// Required for antd 5 on React 19 (message/notification/Modal static methods).
import '@ant-design/v5-patch-for-react-19'
import { App, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'

export function AntdProvider({ locale, children }: { locale: string; children: ReactNode }) {
  return (
    <ConfigProvider
      locale={locale === 'en' ? enUS : zhCN}
      theme={{ token: { colorPrimary: '#1677ff', borderRadius: 8 } }}
    >
      <App>{children}</App>
    </ConfigProvider>
  )
}
