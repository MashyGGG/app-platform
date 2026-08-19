import { describe, expect, it } from 'vitest'
import { type PromptInput, validateImportFile } from './content'

/**
 * AC-I1: "THE 系统 SHALL 拒绝上架缺少 warmup_sentence / model_audio /
 * ≥1 paraphrase / ≥3 预挂词 的 prompt." 测法 = 导入校验报错.
 *
 * This is the *only* place those four rules are enforced, and the import path
 * is a CLI (IMPL §3-C3) that E2E never drives — so a boundary table here is the
 * whole test coverage for the gate that decides whether content can go live.
 */
const word = (lemma: string, ipa = `/${lemma}/`) => ({
  lemma,
  ipa,
  phonemes: lemma.slice(0, 2).split(''),
  audioKey: `seed/words/${lemma}.mp3`,
})

const prompt = (overrides: Partial<PromptInput> = {}): Record<string, unknown> => ({
  slug: 'weekend-plan',
  text: 'What are you planning to do this weekend, and why?',
  warmupSentence: 'This weekend I want to try something new.',
  modelAudioKey: 'seed/prompts/weekend-plan/model.mp3',
  checklist: ['说出你的打算', '给一个理由'],
  sort: 1,
  isActive: true,
  paraphrases: [{ text: 'Put differently: what is your plan, and what is behind it?' }],
  words: [word('weekend'), word('plan'), word('because')],
  ...overrides,
})

const file = (...prompts: Record<string, unknown>[]) => ({ version: 1, prompts })

const codesOf = (raw: unknown, options?: Parameters<typeof validateImportFile>[1]) => {
  const result = validateImportFile(raw, options)
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

describe('validateImportFile — AC-I1 required content', () => {
  it('accepts a prompt carrying all four required assets', () => {
    const result = validateImportFile(file(prompt()))
    expect(result.ok).toBe(true)
    expect(result.ok && result.activeCount).toBe(1)
  })

  it.each([
    ['no warmup sentence', { warmupSentence: '' }],
    ['whitespace-only warmup sentence', { warmupSentence: '   ' }],
    ['no model audio', { modelAudioKey: '' }],
    ['zero paraphrases', { paraphrases: [] }],
    ['only two pre-attached words', { words: [word('weekend'), word('plan')] }],
  ])('rejects a prompt with %s', (_label, overrides) => {
    expect(codesOf(file(prompt(overrides as Partial<PromptInput>)))).toContain('schema')
  })

  it('accepts exactly three words and exactly five, and rejects six', () => {
    const lemmas = ['weekend', 'plan', 'because', 'family', 'travel', 'because-again']
    const withWords = (count: number) =>
      file(prompt({ words: lemmas.slice(0, count).map((l) => word(l)) }))
    expect(validateImportFile(withWords(3)).ok).toBe(true)
    expect(validateImportFile(withWords(5)).ok).toBe(true)
    expect(validateImportFile(withWords(6)).ok).toBe(false)
  })

  it('rejects an unversioned or empty file rather than importing nothing', () => {
    expect(codesOf({ prompts: [prompt()] })).toContain('schema')
    expect(codesOf(file())).toContain('schema')
  })

  it('rejects a slug that is not kebab-case, so import keys stay URL-safe', () => {
    expect(codesOf(file(prompt({ slug: 'Weekend Plan' })))).toContain('schema')
  })

  it('reports every failing prompt in one pass, not just the first', () => {
    const result = validateImportFile(
      file(prompt({ slug: 'a', warmupSentence: '' }), prompt({ slug: 'b', paraphrases: [] })),
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues.length).toBeGreaterThanOrEqual(2)
  })
})

describe('validateImportFile — content integrity', () => {
  it('rejects two prompts sharing a slug, which would silently overwrite on import', () => {
    expect(codesOf(file(prompt({ slug: 'same' }), prompt({ slug: 'same' })))).toContain(
      'duplicate_slug',
    )
  })

  it('rejects the same lemma attached twice to one prompt', () => {
    expect(
      codesOf(file(prompt({ words: [word('plan'), word('plan'), word('because')] }))),
    ).toContain('duplicate_word')
  })

  it('rejects the same lemma carrying two different IPAs across prompts', () => {
    // Words are global rows keyed by lemma; without this check the import would
    // resolve the conflict as "last file wins" and quietly change a word's
    // reference pronunciation for every other prompt using it.
    expect(
      codesOf(
        file(
          prompt({ slug: 'a', words: [word('plan', '/plæn/'), word('x1'), word('x2')] }),
          prompt({ slug: 'b', words: [word('plan', '/plan/'), word('x3'), word('x4')] }),
        ),
      ),
    ).toContain('conflicting_word')
  })

  it('allows the same lemma on two prompts when the IPA agrees', () => {
    expect(
      validateImportFile(
        file(
          prompt({ slug: 'a', words: [word('plan', '/plæn/'), word('x1'), word('x2')] }),
          prompt({ slug: 'b', words: [word('plan', '/plæn/'), word('x3'), word('x4')] }),
        ),
      ).ok,
    ).toBe(true)
  })
})

describe('validateImportFile — AC-I4 rotation floor', () => {
  const many = (count: number) =>
    file(...Array.from({ length: count }, (_, i) => prompt({ slug: `p-${i}`, sort: i })))

  it('rejects fewer than 21 active prompts when a full rotation is required', () => {
    expect(codesOf(many(20), { requireFullRotation: true })).toContain('too_few_active_prompts')
    expect(validateImportFile(many(21), { requireFullRotation: true }).ok).toBe(true)
  })

  it('does not count inactive prompts towards the 21', () => {
    const prompts = Array.from({ length: 21 }, (_, i) =>
      prompt({ slug: `p-${i}`, sort: i, isActive: i !== 0 }),
    )
    expect(codesOf(file(...prompts), { requireFullRotation: true })).toContain(
      'too_few_active_prompts',
    )
  })

  it('counts prompts already live in the database, so top-up files are allowed', () => {
    const existingActiveSlugs = Array.from({ length: 20 }, (_, i) => `live-${i}`)
    expect(validateImportFile(many(1), { requireFullRotation: true, existingActiveSlugs }).ok).toBe(
      true,
    )
  })

  it('does not double-count a slug that is being re-imported', () => {
    const existingActiveSlugs = Array.from({ length: 20 }, (_, i) => `p-${i}`)
    expect(codesOf(many(20), { requireFullRotation: true, existingActiveSlugs })).toContain(
      'too_few_active_prompts',
    )
  })

  it('stays silent about the floor when a full rotation is not required', () => {
    expect(validateImportFile(many(1)).ok).toBe(true)
  })
})
