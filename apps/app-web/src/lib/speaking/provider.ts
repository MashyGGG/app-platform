import 'server-only'
import { createStubSpeechProvider, type SpeechProvider } from '@app/shared/speaking'

/**
 * Provider selection (IMPL §4.2). `stub` is the default and stays the default
 * until M5 wires Azure Speech — and even then it remains the fallback running
 * mode when the F0 quota (5 audio hours/month) is spent, so this is not a test
 * seam that disappears.
 */
let cached: SpeechProvider | null = null

export function getSpeechProvider(): SpeechProvider {
  if (cached) return cached

  const name = process.env.SPEECH_PROVIDER ?? 'stub'
  if (name !== 'stub') {
    // Fail loud rather than silently scoring production with the stub.
    throw new Error(`unknown SPEECH_PROVIDER "${name}" (only "stub" exists before M5)`)
  }

  cached = createStubSpeechProvider()
  return cached
}
