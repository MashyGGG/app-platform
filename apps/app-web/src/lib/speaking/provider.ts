import 'server-only'
import {
  createAzureSpeechProvider,
  createStubSpeechProvider,
  withSpeechResilience,
  type SpeechProvider,
} from '@app/shared/speaking'
import { azureSpeechEnv, speechConcurrency, speechProviderName } from './config'

/**
 * Provider selection (IMPL §4.2).
 *
 * Three facts decide everything in this file:
 *
 * 1. `stub` is the default, and it is not a test toy — it is the free-tier
 *    fallback (IMPL §4.4), so it is constructed on every path.
 * 2. Azure is only reachable when a key exists. `SPEECH_PROVIDER=azure` without
 *    credentials THROWS rather than quietly falling back: a deployment that
 *    thinks it is scoring with Azure and is actually scoring with a hash of the
 *    audio is the worst of the three possible outcomes.
 * 3. Azure F0 allows one concurrent request and 5 audio hours a month, so it is
 *    never used bare — `withSpeechResilience` puts a queue, backoff and the stub
 *    fallback in front of it (IMPL §7).
 */
let cached: SpeechProvider | null = null

export function getSpeechProvider(): SpeechProvider {
  if (cached) return cached

  const stub = createStubSpeechProvider()
  if (speechProviderName() === 'stub') {
    cached = stub
    return cached
  }

  const env = azureSpeechEnv()
  if (!env) throw new Error('SPEECH_PROVIDER=azure needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION')

  cached = withSpeechResilience(createAzureSpeechProvider(env), stub, {
    concurrency: speechConcurrency(),
    // The one place the free tier running out becomes visible in the logs. The
    // session's `degradedFlag` is the durable record; this is for whoever is
    // watching the deploy on the day it first happens.
    onFallback: (degradation) =>
      console.warn('[speaking] degraded to %s (%s)', degradation.provider, degradation.reason),
  })
  return cached
}

/** Only for tests that flip `SPEECH_PROVIDER` between cases. */
export function resetSpeechProvider(): void {
  cached = null
}
