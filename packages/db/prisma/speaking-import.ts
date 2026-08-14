/**
 * Content import for the daily-speaking MVP — the operations path (IMPL §3-C3).
 *
 *   pnpm speaking:import <file.json> [--allow-partial] [--dry-run]
 *
 * A CLI rather than `POST /ops/import`: an admin-web route would mean touching
 * the RBAC matrix and adding a value to the closed `AuditAction` enum (i.e. a
 * migration) for the benefit of two or three internal operators.
 *
 * The rules that decide whether content may go live live in
 * `@app/shared/speaking` so Vitest can drive them (AC-I1/AC-I4); this file is
 * only I/O plus the writes.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { formatIssues, validateImportFile } from '@app/shared/speaking'
import { loadDbEnv } from '../src/load-env'

loadDbEnv()

// Imported after loadDbEnv() for the same reason as seed.ts: constructing the
// Prisma client reads DATABASE_URL at module-evaluation time.
const { prisma } = await import('../src/index')

type Args = { file: string; allowPartial: boolean; dryRun: boolean }

function parseArgs(argv: readonly string[]): Args {
  const flags = argv.filter((arg) => arg.startsWith('--'))
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  const unknown = flags.filter((flag) => !['--allow-partial', '--dry-run'].includes(flag))

  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(', ')}`)
  if (positional.length !== 1) {
    throw new Error('usage: pnpm speaking:import <file.json> [--allow-partial] [--dry-run]')
  }

  return {
    file: path.resolve(process.cwd(), positional[0] as string),
    allowPartial: flags.includes('--allow-partial'),
    dryRun: flags.includes('--dry-run'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const raw: unknown = JSON.parse(await readFile(args.file, 'utf8'))

  // Slugs already live count towards AC-I4's floor of 21, so a top-up file of
  // three prompts is not rejected for being three prompts.
  const live = await prisma.speakingPrompt.findMany({
    where: { isActive: true },
    select: { slug: true },
  })

  const result = validateImportFile(raw, {
    requireFullRotation: !args.allowPartial,
    existingActiveSlugs: live.map((prompt) => prompt.slug),
  })

  if (!result.ok) {
    console.error(`✗ ${result.issues.length} problem(s) in ${args.file}:`)
    console.error(formatIssues(result.issues))
    // AC-I1 is "拒绝上架": nothing is written when anything is wrong.
    throw new Error('import rejected')
  }

  if (args.dryRun) {
    console.info(`✅ ${result.file.prompts.length} prompt(s) valid — nothing written (--dry-run)`)
    return
  }

  for (const input of result.file.prompts) {
    // One transaction per prompt: a prompt is the unit that is either fully
    // importable or rejected, and re-running the command fixes a partial run.
    await prisma.$transaction(async (tx) => {
      const prompt = await tx.speakingPrompt.upsert({
        where: { slug: input.slug },
        create: {
          slug: input.slug,
          text: input.text,
          warmupSentence: input.warmupSentence,
          modelAudioKey: input.modelAudioKey,
          checklist: input.checklist,
          sort: input.sort,
          isActive: input.isActive,
        },
        update: {
          text: input.text,
          warmupSentence: input.warmupSentence,
          modelAudioKey: input.modelAudioKey,
          checklist: input.checklist,
          sort: input.sort,
          isActive: input.isActive,
        },
      })

      // Words are global rows keyed by lemma — validation has already rejected
      // the file if two prompts disagree about a lemma's IPA.
      const wordIds: string[] = []
      for (const word of input.words) {
        const row = await tx.speakingWord.upsert({
          where: { lemma: word.lemma },
          create: {
            lemma: word.lemma,
            ipa: word.ipa,
            phonemes: word.phonemes,
            audioKey: word.audioKey ?? null,
            gloss: word.gloss ?? null,
          },
          update: {
            ipa: word.ipa,
            phonemes: word.phonemes,
            // Never null out an existing demo clip with an absent one: TTS
            // fallback may have filled it in since the last import (SPEC §5.3).
            ...(word.audioKey ? { audioKey: word.audioKey } : {}),
            ...(word.gloss ? { gloss: word.gloss } : {}),
          },
        })
        wordIds.push(row.id)
      }

      // The file is the source of truth for what hangs off a prompt, so links
      // and sentences are replaced rather than merged: removing a paraphrase
      // from the file must remove it from the app.
      await tx.speakingPromptWord.deleteMany({ where: { promptId: prompt.id } })
      await tx.speakingPromptWord.createMany({
        data: wordIds.map((wordId, sort) => ({ promptId: prompt.id, wordId, sort })),
      })

      await tx.speakingSentence.deleteMany({ where: { promptId: prompt.id } })
      await tx.speakingSentence.createMany({
        data: [
          {
            promptId: prompt.id,
            text: input.warmupSentence,
            audioKey: input.warmupAudioKey ?? null,
            kind: 'warmup' as const,
            sort: 0,
          },
          ...input.paraphrases.map((paraphrase, index) => ({
            promptId: prompt.id,
            text: paraphrase.text,
            audioKey: paraphrase.audioKey ?? null,
            kind: 'paraphrase' as const,
            sort: index,
          })),
        ],
      })
    })
  }

  const activeTotal = await prisma.speakingPrompt.count({ where: { isActive: true } })
  console.info(
    `✅ imported ${result.file.prompts.length} prompt(s) — ${activeTotal} active in total`,
  )
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
