import { LogoutOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { getTranslations } from 'next-intl/server'
import { signOut } from '@/auth'

export async function SignOutButton() {
  const t = await getTranslations('common')

  async function doSignOut() {
    'use server'
    await signOut({ redirectTo: '/' })
  }

  return (
    <form action={doSignOut}>
      <Button htmlType="submit" icon={<LogoutOutlined />}>
        {t('logout')}
      </Button>
    </form>
  )
}
