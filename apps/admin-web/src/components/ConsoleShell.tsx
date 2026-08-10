'use client'

import {
  DashboardOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { Layout, Menu, Tag, Typography } from 'antd'
import { useTranslations } from 'next-intl'
import { useMemo, type ReactNode } from 'react'
import { Link, usePathname } from '@/i18n/navigation'
import { can, type Permission } from '@/lib/rbac'
import type { AdminRoleName } from '@app/shared'
import { LocaleSwitcher } from '@/components/LocaleSwitcher'

const NAV: Array<{ key: string; href: string; permission: Permission; icon: ReactNode }> = [
  {
    key: 'dashboard',
    href: '/dashboard',
    permission: 'dashboard.view',
    icon: <DashboardOutlined />,
  },
  { key: 'appUsers', href: '/app-users', permission: 'appUser.view', icon: <TeamOutlined /> },
  {
    key: 'adminUsers',
    href: '/admin-users',
    permission: 'adminUser.view',
    icon: <SafetyCertificateOutlined />,
  },
  { key: 'auditLogs', href: '/audit-logs', permission: 'audit.view', icon: <FileSearchOutlined /> },
]

/**
 * RBAC enforcement layer 3 — UI visibility (SPEC §1.7).
 *
 * Hiding a menu item is a courtesy, NOT a control: the same permission is
 * enforced in middleware (layer 1) and re-checked against the DB by every API
 * (layer 2). Never rely on this alone.
 */
export function ConsoleShell({
  role,
  email,
  signOutSlot,
  children,
}: {
  role: AdminRoleName
  email: string
  signOutSlot: ReactNode
  children: ReactNode
}) {
  const t = useTranslations()
  const pathname = usePathname()

  const items = useMemo(
    () =>
      NAV.filter((item) => can(role, item.permission)).map((item) => ({
        key: item.href,
        icon: item.icon,
        label: <Link href={item.href}>{t(`nav.${item.key}`)}</Link>,
      })),
    [role, t],
  )

  const selected = NAV.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  )?.href

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider breakpoint="lg" collapsedWidth="0" theme="light" width={220}>
        <div className="px-4 py-4">
          <Typography.Text strong>{t('common.appName')}</Typography.Text>
        </div>
        <Menu mode="inline" selectedKeys={selected ? [selected] : []} items={items} />
      </Layout.Sider>

      <Layout>
        <Layout.Header
          className="flex items-center justify-end gap-3"
          style={{ background: '#fff' }}
        >
          <Typography.Text type="secondary">{email}</Typography.Text>
          <Tag color={role === 'super_admin' ? 'gold' : 'blue'}>
            {role === 'super_admin' ? t('common.roleSuperAdmin') : t('common.roleOperator')}
          </Tag>
          <LocaleSwitcher />
          {signOutSlot}
        </Layout.Header>

        <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  )
}
