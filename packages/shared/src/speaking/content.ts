/**
 * Content import contract for the daily-speaking MVP (SPEC §5.3, AC-I1/AC-I4).
 *
 * This file is deliberately pure: no Prisma, no fs, no network. The operations
 * path is a CLI (`pnpm speaking:import`, IMPL §3-C3), but the *rules* that
 * decide whether a prompt may go live are the thing AC-I1 tests, so they live
 * here where Vitest can drive them as a table.
 */
import { z } from 'zod'

/** Every prompt needs 3–5 pre-attached error-prone words (SPEC §5.1). */
export const MIN_PROMPT_WORDS = 3
export const MAX_PROMPT_WORDS = 5
/** 21 prompts = three weeks without a repeat (SPEC §5.1, AC-I4). */
export const MIN_ACTIVE_PROMPTS = 21

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)

/** Storage key, not a URL — the AudioStore resolves it (IMPL §4.3). */
const audioKeySchema = trimmed(1, 200)

export const wordSchema = z.object({
  lemma: trimmed(1, 60).toLowerCase(),
  ipa: trimmed(1, 120),
  /** Phoneme sequence handed to the reference-text assessment mode (原则 B). */
  phonemes: z.array(trimmed(1, 12)).min(1).max(40),
  audioKey: audioKeySchema.optional(),
  gloss: trimmed(1, 200).optional(),
})
export type WordInput = z.infer<typeof wordSchema>

export const paraphraseSchema = z.object({
  text: trimmed(1, 400),
  audioKey: audioKeySchema.optional(),
})
export type ParaphraseInput = z.infer<typeof paraphraseSchema>

export const promptSchema = z.object({
  /** Stable import key — re-running the import updates rather than duplicates. */
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be kebab-case'),
  text: trimmed(1, 600),
  /** AC-I1: a prompt without a warm-up sentence may not go live. */
  warmupSentence: trimmed(1, 400),
  warmupAudioKey: audioKeySchema.optional(),
  /** AC-I1: 示范音 is the trust anchor of a pronunciation product (D1/D6). */
  modelAudioKey: audioKeySchema,
  /** Drives winner C — "有观点无理由/例子" (SPEC §4.1). */
  checklist: z.array(trimmed(1, 120)).min(2).max(6),
  sort: z.number().int().min(0).max(9999),
  isActive: z.boolean().default(true),
  /** AC-I1: at least one paraphrase, or winner B has nothing to hand back. */
  paraphrases: z.array(paraphraseSchema).min(1).max(4),
  /** AC-I1: at least three pre-attached words, or winner A degrades to ASR. */
  words: z.array(wordSchema).min(MIN_PROMPT_WORDS).max(MAX_PROMPT_WORDS),
})
export type PromptInput = z.infer<typeof promptSchema>

export const importFileSchema = z.object({
  version: z.literal(1),
  prompts: z.array(promptSchema).min(1),
})
export type ImportFile = z.infer<typeof importFileSchema>

export type ImportIssue = {
  /** Machine-readable so tests assert the rule, not the prose. */
  code:
    'schema' | 'duplicate_slug' | 'duplicate_word' | 'conflicting_word' | 'too_few_active_prompts'
  path: string
  message: string
}

export type ValidateResult =
  | { ok: true; file: ImportFile; activeCount: number; issues: [] }
  | { ok: false; issues: ImportIssue[] }

export type ValidateOptions = {
  /**
   * Enforce AC-I4's "≥21 qualified prompts so the next 21 calendar days can all
   * serve one". The CLI turns this off for incremental top-up files.
   */
  requireFullRotation?: boolean
  /** Slugs already live in the database, counted towards the rotation floor. */
  existingActiveSlugs?: readonly string[]
}

/**
 * The single gate every prompt passes before it can go live (AC-I1).
 *
 * Returns *all* issues rather than throwing on the first: an operator fixing a
 * 21-prompt file wants one list, not twenty-one round trips.
 */
export function validateImportFile(raw: unknown, options: ValidateOptions = {}): ValidateResult {
  const parsed = importFileSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'schema' as const,
        path: issue.path.join('.') || '_',
        message: issue.message,
      })),
    }
  }

  const file = parsed.data
  const issues: ImportIssue[] = []

  const seenSlugs = new Set<string>()
  for (const [index, prompt] of file.prompts.entries()) {
    if (seenSlugs.has(prompt.slug)) {
      issues.push({
        code: 'duplicate_slug',
        path: `prompts.${index}.slug`,
        message: `duplicate prompt slug "${prompt.slug}"`,
      })
    }
    seenSlugs.add(prompt.slug)

    const seenLemmas = new Set<string>()
    for (const [wordIndex, word] of prompt.words.entries()) {
      if (seenLemmas.has(word.lemma)) {
        issues.push({
          code: 'duplicate_word',
          path: `prompts.${index}.words.${wordIndex}.lemma`,
          message: `"${word.lemma}" is attached to prompt "${prompt.slug}" twice`,
        })
      }
      seenLemmas.add(word.lemma)
    }
  }

  // A lemma is global (one row per word), so two prompts disagreeing about its
  // IPA is a content bug that would otherwise resolve to "last import wins".
  const byLemma = new Map<string, { ipa: string; slug: string }>()
  for (const [index, prompt] of file.prompts.entries()) {
    for (const [wordIndex, word] of prompt.words.entries()) {
      const known = byLemma.get(word.lemma)
      if (known && known.ipa !== word.ipa) {
        issues.push({
          code: 'conflicting_word',
          path: `prompts.${index}.words.${wordIndex}.ipa`,
          message: `"${word.lemma}" is "${known.ipa}" in prompt "${known.slug}" but "${word.ipa}" here`,
        })
      } else if (!known) {
        byLemma.set(word.lemma, { ipa: word.ipa, slug: prompt.slug })
      }
    }
  }

  const incomingActive = new Set(
    file.prompts.filter((prompt) => prompt.isActive).map((prompt) => prompt.slug),
  )
  const activeCount = new Set([...(options.existingActiveSlugs ?? []), ...incomingActive]).size

  if (options.requireFullRotation && activeCount < MIN_ACTIVE_PROMPTS) {
    issues.push({
      code: 'too_few_active_prompts',
      path: 'prompts',
      message: `${activeCount} active prompts, need at least ${MIN_ACTIVE_PROMPTS} (AC-I4)`,
    })
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, file, activeCount, issues: [] }
}

/** One-line-per-issue rendering for the CLI. */
export function formatIssues(issues: readonly ImportIssue[]): string {
  return issues.map((issue) => `  [${issue.code}] ${issue.path}: ${issue.message}`).join('\n')
}
