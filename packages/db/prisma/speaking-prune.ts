/**
 * Audio retention for the daily-speaking product (IMPL §4.3 / §7 风险 3).
 *
 *   pnpm speaking:prune [--days=7] [--dry-run]
 *
 * Vercel Blob's Hobby tier holds ~340 of this product's 90-second takes, and the
 * product writes up to two a day per student. Retention is therefore not
 * housekeeping, it is the reason the free tier does not stop accepting writes
 * one Tuesday — which is why 决策 Q2 made this an MVP deliverable rather than a
 * later chore.
 *
 * What it deletes: the BYTES of takes older than the window `/me` renders.
 * What it never deletes: the session row. 原则 E is about the record, not the
 * recording, so `audioKey` / `retryAudioKey` are cleared and everything the week
 * view and the 7-day sentence are computed from stays exactly where it was.
 *
 * Idempotent and interruptible: bytes go first, columns second, so a run that
 * dies in the middle leaves keys that the NEXT run tries again. The reverse
 * order would leave bytes nobody can name — quota spent forever.
 */
import path from 'node:path'
import { createAudioStore } from '@app/shared/audio-store'
import { DEFAULT_RETENTION_DAYS, effectiveRetentionDays, pruneCutoff } from '@app/shared/speaking'
import { loadDbEnv } from '../src/load-env'

loadDbEnv()

// Imported after loadDbEnv() for the same reason as seed.ts: constructing the
// Prisma client reads DATABASE_URL at module-evaluation time.
const { prisma } = await import('../src/index')

type Args = { days: number; dryRun: boolean }

function parseArgs(argv: readonly string[]): Args {
  const unknown = argv.filter((arg) => arg !== '--dry-run' && !arg.startsWith('--days='))
  if (unknown.length > 0) {
    throw new Error(`usage: pnpm speaking:prune [--days=N] [--dry-run] (got: ${unknown.join(' ')})`)
  }

  const flag = argv.find((arg) => arg.startsWith('--days='))?.slice('--days='.length)
  const days = flag === undefined ? envDays() : Number.parseInt(flag, 10)
  if (!Number.isFinite(days) || days < 0) throw new Error(`--days must be a non-negative integer`)

  return { days, dryRun: argv.includes('--dry-run') }
}

function envDays(): number {
  const raw = process.env.SPEAKING_RETENTION_DAYS
  if (!raw) return DEFAULT_RETENTION_DAYS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETENTION_DAYS
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const store = createAudioStore({
    blobToken: process.env.BLOB_READ_WRITE_TOKEN,
    localDir: path.resolve(process.cwd(), process.env.SPEAKING_AUDIO_DIR ?? '.data/audio'),
    capacityBytes: Number.parseInt(
      process.env.SPEAKING_BLOB_CAPACITY_BYTES ?? String(1024 * 1024 * 1024),
      10,
    ),
  })

  // 「容量埋点，逼近上限自动缩到 3 天」(IMPL §7). Pressure can only shorten the
  // window, never extend it — an empty store is no reason to keep audio longer
  // than the week view can play.
  const usage = await store.usage()
  const days = effectiveRetentionDays({ retentionDays: args.days, usage })
  const cutoff = pruneCutoff(new Date(), days)

  if (usage) {
    const ratio = ((usage.usedBytes / usage.capacityBytes) * 100).toFixed(1)
    console.info(
      `store ${store.name}: ${megabytes(usage.usedBytes)} of ${megabytes(usage.capacityBytes)} (${ratio}%)`,
    )
  }
  if (days !== args.days) {
    console.warn(`⚠ store under capacity pressure — retention tightened ${args.days}d → ${days}d`)
  }

  const stale = await prisma.speakingSession.findMany({
    where: {
      startedAt: { lt: cutoff },
      OR: [{ audioKey: { not: null } }, { retryAudioKey: { not: null } }],
    },
    select: { id: true, audioKey: true, retryAudioKey: true },
  })

  const keys = stale.flatMap((session) =>
    [session.audioKey, session.retryAudioKey].filter((key): key is string => key !== null),
  )

  console.info(
    `${stale.length} session(s) with audio started before ${cutoff.toISOString()} → ${keys.length} take(s)`,
  )

  if (args.dryRun) {
    console.info('✅ nothing deleted (--dry-run)')
    return
  }
  if (stale.length === 0) return

  // One session at a time. A take that fails to delete strands one student's
  // playback for one day rather than aborting the whole run — and the next run
  // picks it up again, because its columns were never cleared.
  let pruned = 0
  for (const session of stale) {
    const sessionKeys = [session.audioKey, session.retryAudioKey].filter(
      (key): key is string => key !== null,
    )

    try {
      await store.remove(sessionKeys)
      await prisma.speakingSession.update({
        where: { id: session.id },
        data: { audioKey: null, retryAudioKey: null },
      })
      pruned += sessionKeys.length
    } catch (error) {
      console.error(`✗ ${session.id}: ${String(error)}`)
    }
  }

  console.info(`✅ pruned ${pruned}/${keys.length} take(s), ${stale.length} session(s) kept`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
