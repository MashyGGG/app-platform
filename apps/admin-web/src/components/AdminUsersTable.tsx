'use client'

import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { getJson, postJson, type Paged } from '@/lib/client-api'

interface AdminUser {
  id: string
  email: string
  name: string | null
  status: 'active' | 'disabled'
  createdAt: string
  role: 'super_admin' | 'operator' | null
  isSelf: boolean
}

interface CreateValues {
  email: string
  name?: string
  password: string
  role: 'super_admin' | 'operator'
}

/** Rendered only for super_admin (layer 3); the API enforces the same (layer 2). */
export function AdminUsersTable() {
  const t = useTranslations()
  const format = useFormatter()
  const { message } = App.useApp()

  const [rows, setRows] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<CreateValues>()

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (q) params.set('q', q)

    const result = await getJson<Paged<AdminUser>>(`/api/admin-users?${params}`)
    setLoading(false)

    if (!result.ok) {
      message.error(t(result.failure.messageKey))
      return
    }
    setRows(result.data.items)
    setTotal(result.data.total)
  }, [page, pageSize, q, message, t])

  useEffect(() => {
    void load()
  }, [load])

  async function mutate(url: string, body: unknown) {
    const result = await postJson<{ ok: true }>(url, body)
    if (!result.ok) {
      message.error(t(result.failure.messageKey))
      return false
    }
    void load()
    return true
  }

  async function submitCreate(values: CreateValues) {
    const ok = await mutate('/api/admin-users/create', values)
    if (ok) {
      message.success(t('adminUsers.created'))
      setCreating(false)
      form.resetFields()
    }
  }

  return (
    <>
      <Space className="mb-4">
        <Input.Search
          allowClear
          placeholder={t('adminUsers.searchPlaceholder')}
          style={{ width: 280 }}
          onSearch={(value) => {
            setPage(1)
            setQ(value)
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          {t('adminUsers.create')}
        </Button>
      </Space>

      <Table<AdminUser>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage)
            setPageSize(nextSize)
          },
        }}
        columns={[
          {
            title: t('common.email'),
            dataIndex: 'email',
            render: (email: string, row) => (
              <Space>
                {email}
                {row.isSelf ? <Tag color="purple">{t('adminUsers.self')}</Tag> : null}
              </Space>
            ),
          },
          { title: t('common.name'), dataIndex: 'name', render: (v: string | null) => v ?? '—' },
          {
            title: t('common.role'),
            dataIndex: 'role',
            render: (role: AdminUser['role'], row) => (
              <Select<'super_admin' | 'operator'>
                size="small"
                style={{ width: 150 }}
                value={role ?? undefined}
                disabled={row.isSelf}
                onChange={(next) => mutate('/api/admin-users/role', { userId: row.id, role: next })}
                options={[
                  { value: 'super_admin', label: t('common.roleSuperAdmin') },
                  { value: 'operator', label: t('common.roleOperator') },
                ]}
              />
            ),
          },
          {
            title: t('common.status'),
            dataIndex: 'status',
            render: (status: AdminUser['status']) => (
              <Tag color={status === 'active' ? 'green' : 'red'}>
                {status === 'active' ? t('common.statusActive') : t('common.statusDisabled')}
              </Tag>
            ),
          },
          {
            title: t('common.createdAt'),
            dataIndex: 'createdAt',
            render: (value: string) =>
              format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }),
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, row) => (
              <Popconfirm
                disabled={row.isSelf}
                title={
                  row.status === 'active'
                    ? t('adminUsers.confirmDisable')
                    : t('adminUsers.confirmEnable')
                }
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                onConfirm={() =>
                  mutate('/api/admin-users/status', {
                    userId: row.id,
                    status: row.status === 'active' ? 'disabled' : 'active',
                  })
                }
              >
                <Button size="small" danger={row.status === 'active'} disabled={row.isSelf}>
                  {row.status === 'active' ? t('adminUsers.disable') : t('adminUsers.enable')}
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal
        open={creating}
        title={t('adminUsers.createTitle')}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onCancel={() => setCreating(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form<CreateValues> form={form} layout="vertical" onFinish={submitCreate}>
          <Form.Item
            name="email"
            label={t('common.email')}
            rules={[{ required: true }, { type: 'email', message: t('errors.invalidEmail') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="name" label={t('common.name')}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('adminUsers.password')}
            extra={t('adminUsers.passwordHint')}
            rules={[
              { required: true },
              { min: 8, message: t('errors.passwordTooShort') },
              { pattern: /^(?=.*[a-zA-Z])(?=.*[0-9]).+$/, message: t('errors.passwordTooWeak') },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="role" label={t('common.role')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'operator', label: t('common.roleOperator') },
                { value: 'super_admin', label: t('common.roleSuperAdmin') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
