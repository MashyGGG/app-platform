import { Result } from 'antd'

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <Result status="404" title="404" />
    </main>
  )
}
