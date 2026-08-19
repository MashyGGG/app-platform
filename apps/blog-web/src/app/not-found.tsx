import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>
        404
      </p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">这里没有东西</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        链接可能改过，或者这篇笔记还没写。
      </p>
      <Link
        href="/"
        className="mt-6 inline-block text-sm hover:underline"
        style={{ color: 'var(--accent)' }}
      >
        回首页
      </Link>
    </div>
  )
}
