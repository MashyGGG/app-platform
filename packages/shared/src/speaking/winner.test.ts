import { describe, expect, it } from 'vitest'
import { STUB_LOW_CONFIDENCE, createStubSpeechProvider, type AsrWord } from './speech'
import {
  COACH_LINE_KEYS,
  MAX_RETRY_WORDS,
  MIN_TOKENS_FOR_RATIO,
  MIN_TYPE_TOKEN_RATIO,
  MIN_WORD_CONFIDENCE,
  pickWinner,
  tokenize,
  typeTokenRatio,
  type PromptMaterial,
  type WinnerInput,
} from './winner'

/**
 * AC-S3: "THE 系统 SHALL 同屏返回**恰好 1 个** winnerType ∈ {A,B,C} 及可执行
 * retryItems." The e2e proves the route returns one winner over HTTP; what it
 * cannot afford is the boundary table — every threshold below would be a
 * 30-second recording upload there, and thirty of them a suite that nobody runs.
 */

const PROMPT: PromptMaterial = {
  checklist: ['说出你的打算', '给一个理由', '举一个具体例子'],
  words: [
    { lemma: 'weekend', ipa: '/ˈwiːkend/', audioKey: 'seed/words/weekend.mp3' },
    { lemma: 'plan', ipa: '/plæn/', audioKey: 'seed/words/plan.mp3' },
    { lemma: 'because', ipa: '/bɪˈkɒz/', audioKey: 'seed/words/because.mp3' },
  ],
  paraphrases: [{ text: 'Another way to say it: my plan is simple.', audioKey: 'seed/p/1.mp3' }],
}

/** A long, varied, well-structured answer — the "nothing is wrong" baseline. */
const GOOD_TRANSCRIPT =
  'I think the weekend matters to me because it changes how my whole week feels afterwards. ' +
  'My plan is simple and cheap, and it still leaves room for something unexpected. ' +
  'For example last month I walked across the river with a friend and we talked for hours.'

function input(overrides: Partial<WinnerInput> = {}): WinnerInput {
  const transcript = overrides.transcript ?? GOOD_TRANSCRIPT
  return {
    transcript,
    words: tokenize(transcript).map((word) => ({ word, confidence: 0.95 })),
    durationMs: 45_000,
    prompt: PROMPT,
    ...overrides,
  }
}

/** Rewrites the confidence of named words, leaving the rest untouched. */
function weaken(transcript: string, weak: Record<string, number>): AsrWord[] {
  return tokenize(transcript).map((word) => ({ word, confidence: weak[word] ?? 0.95 }))
}

describe('pickWinner — exactly one winner, always (AC-S3)', () => {
  it('returns a single winner and a non-empty next step for every scenario', () => {
    const scenarios = [
      input(),
      input({ words: weaken(GOOD_TRANSCRIPT, { weekend: 0.2 }) }),
      input({
        transcript: 'It is very good because it is very good and it is very good for me. '.repeat(
          3,
        ),
      }),
      input({ transcript: 'Honestly I would choose the second one.' }),
    ]

    for (const scenario of scenarios) {
      const result = pickWinner(scenario)
      expect(['A', 'B', 'C']).toContain(result.winnerType)
      expect(result.retryItems.length).toBeGreaterThan(0)
      expect(COACH_LINE_KEYS).toContain(result.coachLineKey)
    }
  })

  it('never returns "nothing to work on" — C is the floor', () => {
    // A flawless answer still gets one actionable next step; a session that ends
    // with no next step would break the core loop (D1).
    const result = pickWinner(input())
    expect(result.winnerType).toBe('C')
    expect(result.retryItems).toHaveLength(1)
    // ...and the line admits the answer was fine rather than asking for a
    // reason the student already gave.
    expect(result.coachLineKey).toBe('today.coach.C_more')
  })
})

describe('winner A — 听不清', () => {
  it('wins on the confidence boundary and not a hair above it', () => {
    const justBelow = pickWinner(
      input({ words: weaken(GOOD_TRANSCRIPT, { weekend: MIN_WORD_CONFIDENCE - 0.001 }) }),
    )
    expect(justBelow.winnerType).toBe('A')

    const exactly = pickWinner(
      input({ words: weaken(GOOD_TRANSCRIPT, { weekend: MIN_WORD_CONFIDENCE }) }),
    )
    expect(exactly.winnerType).not.toBe('A')
  })

  it('hands back at most three words, worst first (SPEC §4.1)', () => {
    const result = pickWinner(
      input({
        words: weaken(GOOD_TRANSCRIPT, {
          weekend: 0.1,
          plan: 0.2,
          because: 0.3,
          simple: 0.4,
          river: 0.5,
        }),
      }),
    )

    expect(result.winnerType).toBe('A')
    expect(result.retryItems).toHaveLength(MAX_RETRY_WORDS)
    expect(result.retryItems.map((item) => item.text)).toEqual(['weekend', 'plan', 'because'])
    expect(result.coachLineParams).toEqual({ count: MAX_RETRY_WORDS })
  })

  it('prefers a pre-attached word over a worse ASR word — that is where the 示范音 is', () => {
    // `simple` scores worse, but only `plan` comes with an IPA and a recording;
    // AC-I3 wants every returned word playable, so material beats rank.
    const result = pickWinner(input({ words: weaken(GOOD_TRANSCRIPT, { simple: 0.1, plan: 0.4 }) }))

    expect(result.winnerType).toBe('A')
    expect(result.retryItems[0]).toMatchObject({
      kind: 'word',
      text: 'plan',
      audioKey: 'seed/words/plan.mp3',
    })
    expect(result.retryItems[1]).toMatchObject({ kind: 'word', text: 'simple', audioKey: null })
  })

  it('still fires when the prompt has no pre-attached hit — ASR is the second tier', () => {
    const result = pickWinner(input({ words: weaken(GOOD_TRANSCRIPT, { river: 0.1 }) }))
    expect(result.winnerType).toBe('A')
    // Null until the M5 TTS fallback fills it in (SPEC §5.3 "无示范音则 TTS").
    expect(result.retryItems[0]).toMatchObject({ text: 'river', ipa: '', audioKey: null })
  })
})

describe('winner B — 在背稿', () => {
  const scripted = 'It is very good because it is very good for me and it is very good. '.repeat(3)

  it('fires below the type/token ratio and hands back one paraphrase', () => {
    const result = pickWinner(input({ transcript: scripted }))

    expect(typeTokenRatio(tokenize(scripted))).toBeLessThan(MIN_TYPE_TOKEN_RATIO)
    expect(result.winnerType).toBe('B')
    expect(result.retryItems).toEqual([
      { kind: 'sentence', text: PROMPT.paraphrases[0]?.text, audioKey: 'seed/p/1.mp3' },
    ])
  })

  it('loses to A: fixing word choice is pointless while the words are unintelligible', () => {
    const result = pickWinner(
      input({ transcript: scripted, words: weaken(scripted, { good: 0.2 }) }),
    )
    expect(result.winnerType).toBe('A')
  })

  it('does not fire on a short answer — the ratio is noise below the token floor', () => {
    const short = 'it is good it is good it is good'
    expect(tokenize(short).length).toBeLessThan(MIN_TOKENS_FOR_RATIO)
    expect(typeTokenRatio(tokenize(short))).toBeLessThan(MIN_TYPE_TOKEN_RATIO)
    expect(pickWinner(input({ transcript: short })).winnerType).toBe('C')
  })
})

describe('winner C — 没说完', () => {
  it('asks for the reason when there is no reason marker', () => {
    const result = pickWinner(
      input({ transcript: 'I would choose the second one. For example I did it last week.' }),
    )
    expect(result.winnerType).toBe('C')
    expect(result.coachLineKey).toBe('today.coach.C_reason')
    expect(result.retryItems).toEqual([{ kind: 'checklist', text: '给一个理由', audioKey: null }])
  })

  it('asks for the example when the reason is already there', () => {
    const result = pickWinner(
      input({ transcript: 'I would choose the second one because it is cheaper.' }),
    )
    expect(result.winnerType).toBe('C')
    expect(result.coachLineKey).toBe('today.coach.C_example')
    expect(result.retryItems).toEqual([
      { kind: 'checklist', text: '举一个具体例子', audioKey: null },
    ])
  })

  it('falls back to the last checklist entry when a prompt carries only two', () => {
    const result = pickWinner(
      input({
        transcript: 'I would choose the second one.',
        prompt: { ...PROMPT, checklist: ['说出你的打算', '给一个理由'] },
      }),
    )
    expect(result.retryItems[0]?.text).toBe('给一个理由')
  })
})

describe('the stub provider feeds each winner exactly once (IMPL §4.2)', () => {
  const vocabulary = PROMPT.words.map((word) => word.lemma)

  it.each([
    ['unclear', 'A'],
    ['scripted', 'B'],
    ['incomplete', 'C'],
  ] as const)('scenario %s → winner %s', async (scenario, expected) => {
    const provider = createStubSpeechProvider(() => scenario)
    const { text, words } = await provider.transcribe(new Uint8Array([1, 2, 3]), { vocabulary })

    const result = pickWinner({ transcript: text, words, durationMs: 45_000, prompt: PROMPT })
    expect(result.winnerType).toBe(expected)
  })

  it('marks exactly the pre-attached lemmas as unclear, so winner A has playable words', async () => {
    const provider = createStubSpeechProvider(() => 'unclear')
    const { words } = await provider.transcribe(new Uint8Array([1]), { vocabulary })

    const weak = new Set(
      words.filter((word) => word.confidence === STUB_LOW_CONFIDENCE).map((word) => word.word),
    )
    expect([...weak].sort()).toEqual([...vocabulary].sort())
  })
})
