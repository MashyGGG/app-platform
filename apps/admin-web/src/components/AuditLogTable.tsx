'use client'

import { ReloadOutlined } from '@ant-design/icons'
import { App, Button, Select, Space, Table, Tag, Typography } from 'antd'
// Deep import on purpose: the '@app/shared' barrel pulls in argon2 (native,
// server-only) which must never reach a client bundle.
import { AUDIT_ACTIONS, type AuditActionName } from '@app/shared/audit'
import { useCallback, useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { getJson, type Paged } from '@/lib/client-api'

interface AuditRow {
  id: string
  action: AuditActionName
  targetType: string
  targetId: string
  meta: unknown
  ip: string | null
  createdAt: string
  actor: { id: string; email: string; name: string | null }
}

/** Read-only by construction — there is no mutating call anywhere in this file. */
export function AuditLogTable() {
  const t = useTranslations()
  const format = useFormatter()
  const { message } = App.useApp()

  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [action, setAction] = useState<AuditActionName | undefined>()
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (action) params.set('action', action)

    const result = await getJson<Paged<AuditRow>>(`/api/audit-logs?${params}`)
    setLoading(false)

    if (!result.ok) {
      message.error(t(result.failure.messageKey))
      return
    }
    setRows(result.data.items)
    setTotal(result.data.total)
  }, [page, pageSize, action, message, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <Space className="mb-4">
        <Select<AuditActionName>
          allowClear
          style={{ width: 260 }}
          placeholder={t('audit.allActions')}
          value={action}
          onChange={(value) => {
            setPage(1)
            setAction(value)
          }}
          options={AUDIT_ACTIONS.map((a) => ({ value: a, label: a }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      </Space>

      <Table<AuditRow>
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
        expandable={{
          expandedRowRender: (row) => (
            <Typography.Text code copyable={{ text: JSON.stringify(row.meta, null, 2) }}>
              {JSON.stringify(row.meta)}
            </Typography.Text>
          ),
          rowExpandable: (row) => row.meta != null,
        }}
        columns={[
          {
            title: t('audit.time'),
            dataIndex: 'createdAt',
            render: (value: string) =>
              format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'medium' }),
          },
          {
            title: t('audit.action'),
            dataIndex: 'action',
            render: (value: AuditActionName) => <Tag color="geekblue">{value}</Tag>,
          },
          {
            title: t('audit.actor'),
            dataIndex: ['actor', 'email'],
          },
          {
            title: t('audit.target'),
            key: 'target',
            render: (_, row) => `${row.targetType}:${row.targetId}`,
          },
          { title: t('audit.ip'), dataIndex: 'ip', render: (v: string | null) => v ?? '—' },
        ]}
      />
    </>
  )
}
