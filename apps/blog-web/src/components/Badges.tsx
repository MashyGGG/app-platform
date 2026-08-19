import Link from 'next/link'
import { STAGE_LABELS } from '@/lib/roadmap'
import type { Kind, Level, Stage } from '@/lib/post-meta'

const LEVEL_LABELS: Record<Level, string> = {
  basic: '入门',
  intermediate: '进阶',
  advanced: '深入',
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
    >
      {STAGE_LABELS[stage]}
    </span>
  )
}

export function KindBadge({ kind }: { kind: Kind }) {
  if (kind !== 'pitfall') return null
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: 'var(--warn-soft)', color: 'var(--warn)' }}
    >
      踩坑
    </span>
  )
}

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
      {LEVEL_LABELS[level]}
    </span>
  )
}

export function TagLink({ tag, count }: { tag: string; count?: number }) {
  return (
    <Link
      href={`/tags/${encodeURIComponent(tag)}`}
      className="rounded border px-2 py-0.5 text-xs transition-colors hover:border-current"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      #{tag}
      {count !== undefined && <span className="ml-1 opacity-60">{count}</span>}
    </Link>
  )
}
