import type { Heading } from '@/lib/markdown'

/**
 * Static anchors, no scroll-spy. Highlighting the current section needs an
 * IntersectionObserver and therefore a client component; on a page whose entire
 * job is to render text, that trade is not worth making.
 */
export function Toc({ headings }: { headings: Heading[] }) {
  if (headings.length < 3) return null

  return (
    <nav
      aria-label="目录"
      className="mb-8 rounded-lg border p-4 text-sm lg:sticky lg:top-20 lg:mb-0"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-raised)' }}
    >
      <p
        className="mb-2 text-xs font-medium uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        目录
      </p>
      <ul className="space-y-1.5">
        {headings.map((heading) => (
          <li key={heading.id} className={heading.depth === 3 ? 'pl-3' : undefined}>
            <a
              href={`#${heading.id}`}
              className="block leading-snug hover:underline"
              style={{ color: heading.depth === 3 ? 'var(--text-muted)' : 'var(--text)' }}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
