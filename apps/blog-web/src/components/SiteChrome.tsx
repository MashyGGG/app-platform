import Link from 'next/link'
import { SITE } from '@/lib/site'

const NAV = [
  { href: '/roadmap', label: '学习路线' },
  { href: '/posts', label: '全部笔记' },
  { href: '/pitfalls', label: '踩坑记录' },
  { href: '/tags', label: '标签' },
] as const

export function SiteHeader() {
  return (
    <header
      className="sticky top-0 z-10 border-b backdrop-blur"
      style={{
        borderColor: 'var(--border)',
        backgroundColor: 'color-mix(in srgb, var(--bg) 88%, transparent)',
      }}
    >
      <div className="mx-auto flex h-14 max-w-4xl items-center gap-5 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          {SITE.name}
        </Link>
        <nav className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer
      className="mt-16 border-t py-8 text-sm"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4">
        <span>© {SITE.author} · 写给未来的自己</span>
        <Link href="/feed.xml" className="hover:underline">
          RSS
        </Link>
        <span className="ml-auto">内容即代码，每篇笔记都是仓库里的一个 .md 文件</span>
      </div>
    </footer>
  )
}
