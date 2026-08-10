'use client'

import { EditOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { getJson, postJson, type Paged } from '@/lib/client-api'

interface AppUser {
  id: string
  email: string
  name: string | null
  locale: string
  status: 'active' | 'disabled'
  createdAt: string
}

interface EditValues {
  name?: string | null
  locale?: 'zh' | 'en'
}

export function AppUsersTable() {
  const t = useTranslations()
  const format = useFormatter()
  const { message } = App.useApp()

  const [rows, setRows] = useState<AppUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [form] = Form.useForm<EditValues>()

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (q) params.set('q', q)

    const result = await getJson<Paged<AppUser>>(`/api/app-users?${params}`)
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

  async function setStatus(user: AppUser, status: 'active' | 'disabled') {
    const result = await postJson<{ ok: true }>('/api/app-users/status', {
      userId: user.id,
      status,
    })
    if (!result.ok) {
      message.error(t(result.failure.messageKey))
      return
    }
    message.success(t('appUsers.saved'))
    void load()
  }

  async function submitEdit(values: EditValues) {
    if (!editing) return
    const result = await postJson<{ ok: true }>('/api/app-users/update', {
      userId: editing.id,
      name: values.name ?? null,
      locale: values.locale,
    })
    if (!result.ok) {
      message.error(t(result.failure.messageKey))
      return
    }
    message.success(t('appUsers.saved'))
    setEditing(null)
    void load()
  }

  return (
    <>
      <Space className="mb-4">
        <Input.Search
          allowClear
          placeholder={t('appUsers.searchPlaceholder')}
          style={{ width: 280 }}
          onSearch={(value) => {
            setPage(1)
            setQ(value)
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      </Space>

      <Table<AppUser>
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
            render: (email: string) => <Typography.Text>{email}</Typography.Text>,
          },
          { title: t('common.name'), dataIndex: 'name', render: (v: string | null) => v ?? '—' },
          { title: t('appUsers.locale'), dataIndex: 'locale' },
          {
            title: t('common.status'),
            dataIndex: 'status',
            render: (status: AppUser['status']) => (
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
              <Space>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(row)
                    form.setFieldsValue({ name: row.name, locale: row.locale as 'zh' | 'en' })
                  }}
                >
                  {t('appUsers.edit')}
                </Button>
                <Popconfirm
                  title={
                    row.status === 'active'
                      ? t('appUsers.confirmDisable')
                      : t('appUsers.confirmEnable')
                  }
                  okText={t('common.confirm')}
                  cancelText={t('common.cancel')}
                  onConfirm={() => setStatus(row, row.status === 'active' ? 'disabled' : 'active')}
                >
                  <Button size="small" danger={row.status === 'active'}>
                    {row.status === 'active' ? t('appUsers.disable') : t('appUsers.enable')}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={Boolean(editing)}
        title={t('appUsers.editTitle')}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form<EditValues> form={form} layout="vertical" onFinish={submitEdit}>
          <Form.Item name="name" label={t('common.name')}>
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="locale" label={t('appUsers.locale')}>
            <Select
              options={[
                { value: 'zh', label: t('common.zh') },
                { value: 'en', label: t('common.en') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
