import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BACKOFF,
  SpeechProviderError,
  backoffDelaysMs,
  classifyStatus,
  classifyThrown,
  createConcurrencyQueue,
  withSpeechResilience,
} from './speech-resilience'
import { createStubSpeechProvider } from './speech'
import type { SpeechProvider } from './speech'

/**
 * The free tier's realities, as a table (IMPL §7).
 *
 * Every branch here first runs in production otherwise: Azure F0's concurrency
 * of 1 means a 429 is normal traffic, not an incident, and the whole point of
 * the ladder below is that the student never learns any of it happened. A
 * black-box test cannot reach these paths — the stub never fails — so this is
 * the layer they get asserted at.
 */

function failing(kind: 'throttled' | 'quota' | 'transient' | 'permanent', times = Infinity) {
  let calls = 0
  const provider: SpeechProvider = {
    name: 'azure',
    async transcribe(audio, context) {
      calls += 1
      if (calls <= times) throw new SpeechProviderError(kind, kind)
      return createStubSpeechProvider().transcribe(audio, context)
    },
    async assess(audio, referenceText) {
      calls += 1
      if (calls <= times) throw new SpeechProviderError(kind, kind)
      return createStubSpeechProvider().assess(audio, referenceText)
    },
  }
  return { provider, calls: () => calls }
}

const AUDIO = new Uint8Array([1, 2, 3, 4])
const noSleep = async () => undefined

describe('classifyStatus', () => {
  it.each([
    // 429 is the F0 concurrency limit, and it is the one status this product
    // expects to see routinely.
    [429, '', 'throttled'],
    [500, '', 'transient'],
    [503, '', 'transient'],
    [408, '', 'transient'],
    // 403 is ambiguous at Azure: a forbidden key and a spent quota share it.
    [403, 'Quota exceeded for this subscription', 'quota'],
    [402, 'monthly limit reached', 'quota'],
    // …and with no such wording, the safer read is a broken deployment, because
    // degrading everyone to stub scores would hide it.
    [403, 'Forbidden', 'permanent'],
    [401, '', 'permanent'],
    [400, '', 'permanent'],
  ])('%i %s → %s', (status, body, expected) => {
    expect(classifyStatus(status, body)).toBe(expected)
  })
})

describe('classifyThrown', () => {
  it('treats an unknown throw as transient — a dropped socket deserves a retry', () => {
    expect(classifyThrown(new Error('ECONNRESET'))).toBe('transient')
    expect(classifyThrown(new SpeechProviderError('quota', 'spent'))).toBe('quota')
  })
})

describe('backoffDelaysMs', () => {
  it('doubles and caps', () => {
    expect(backoffDelaysMs(DEFAULT_BACKOFF)).toEqual([400, 800, 1600])
    expect(backoffDelaysMs({ retries: 5, baseDelayMs: 1000, maxDelayMs: 3000 })).toEqual([
      1000, 2000, 3000, 3000, 3000,
    ])
  })

  it('adds less than the 20s degrade line, so a retried call still renders', () => {
    const total = backoffDelaysMs(DEFAULT_BACKOFF).reduce((sum, delay) => sum + delay, 0)
    expect(total).toBeLessThan(20_000)
  })

  it('is empty when retries are off', () => {
    expect(backoffDelaysMs({ retries: 0, baseDelayMs: 400, maxDelayMs: 4000 })).toEqual([])
  })
})

describe('createConcurrencyQueue', () => {
  it('never runs more than the limit at once — F0 allows exactly one', async () => {
    const queue = createConcurrencyQueue(1)
    let running = 0
    let peak = 0

    await Promise.all(
      Array.from({ length: 5 }, () =>
        queue(async () => {
          running += 1
          peak = Math.max(peak, running)
          await Promise.resolve()
          running -= 1
        }),
      ),
    )

    expect(peak).toBe(1)
  })

  it('releases the slot when a task throws, or the second submitter waits forever', async () => {
    const queue = createConcurrencyQueue(1)
    await expect(queue(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(queue(async () => 'through')).resolves.toBe('through')
  })

  it('runs in submission order — the first to press 提交 is not overtaken', async () => {
    const queue = createConcurrencyQueue(1)
    const order: number[] = []
    await Promise.all(
      [0, 1, 2].map((index) =>
        queue(async () => {
          order.push(index)
        }),
      ),
    )
    expect(order).toEqual([0, 1, 2])
  })
})

describe('withSpeechResilience', () => {
  const options = { sleep: noSleep, backoff: DEFAULT_BACKOFF }

  it('retries a 429 and returns the primary result — no degradation recorded', async () => {
    const azure = failing('throttled', 2)
    const provider = withSpeechResilience(azure.provider, createStubSpeechProvider(), options)

    const result = await provider.transcribe(AUDIO)

    expect(azure.calls()).toBe(3)
    expect(result.degraded).toBeUndefined()
  })

  it('falls back to the stub once the backoff is spent, rather than failing the day', async () => {
    const azure = failing('throttled')
    const provider = withSpeechResilience(azure.provider, createStubSpeechProvider(), options)

    const result = await provider.transcribe(AUDIO)

    // 1 + 3 retries, then the fallback answers — AC-S6's FAILED branch is NOT
    // taken, because a busy vendor is not a broken one (IMPL §7).
    expect(azure.calls()).toBe(4)
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.degraded).toEqual({ provider: 'stub', reason: 'throttled' })
  })

  it('does not retry a spent quota — the month is over, not busy', async () => {
    const azure = failing('quota')
    const seen: string[] = []
    const provider = withSpeechResilience(azure.provider, createStubSpeechProvider(), {
      ...options,
      onFallback: (degradation) => seen.push(degradation.reason),
    })

    const result = await provider.assess(AUDIO, 'the weekend is my favourite time')

    expect(azure.calls()).toBe(1)
    expect(result.degraded?.reason).toBe('quota')
    expect(result.words.length).toBeGreaterThan(0)
    expect(seen).toEqual(['quota'])
  })

  it('rethrows a misconfiguration instead of hiding it behind plausible scores', async () => {
    const azure = failing('permanent')
    const provider = withSpeechResilience(azure.provider, createStubSpeechProvider(), options)

    await expect(provider.transcribe(AUDIO)).rejects.toThrow(SpeechProviderError)
    expect(azure.calls()).toBe(1)
  })

  it('waits at least as long as Retry-After asks', async () => {
    const slept: number[] = []
    const azure: SpeechProvider = {
      name: 'azure',
      async transcribe() {
        throw new SpeechProviderError('throttled', 'busy', { retryAfterMs: 5_000 })
      },
      assess: createStubSpeechProvider().assess,
    }

    const provider = withSpeechResilience(azure, createStubSpeechProvider(), {
      backoff: DEFAULT_BACKOFF,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })

    await provider.transcribe(AUDIO)
    expect(slept).toEqual([5_000, 5_000, 5_000])
  })

  it('keeps the primary name — `degraded` answers "who scored this", not the name', async () => {
    const provider = withSpeechResilience(
      failing('throttled').provider,
      createStubSpeechProvider(),
      options,
    )
    expect(provider.name).toBe('azure')
  })
})
