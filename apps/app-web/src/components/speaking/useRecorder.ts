'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AUDIO_SAMPLE_RATE } from '@app/shared/speaking/wav'
import { encodeTake } from '@/lib/speaking/pcm'

export type RecorderState = 'idle' | 'requesting' | 'recording'

export interface Recorder {
  state: RecorderState
  /**
   * Milliseconds of audio actually CAPTURED, not wall-clock elapsed.
   *
   * They differ, and the difference is what the upload gate rejects: the audio
   * thread can start late or drop frames under load, so a take that ran for 30
   * seconds on the clock may carry 29.6 seconds of samples. Gating "I'm done"
   * on this number means the button can only enable once the take will really
   * pass server-side validation.
   */
  elapsedMs: number
  /** i18n key, set when the microphone could not be opened. */
  errorKey: string | null
  start: () => Promise<boolean>
  stop: () => Promise<Uint8Array | null>
}

const WORKLET_URL = '/speaking/pcm-recorder.worklet.js'

/**
 * Microphone → 16 kHz PCM, in one click.
 *
 * AC-S2 budgets **ten seconds from opening the page to recording**, permission
 * prompt included, which rules out the usual "explain, then ask, then a start
 * button" ladder: `start()` requests the device and begins capturing in the same
 * user gesture (SPEC §4.3 — 不允许多层弹窗).
 */
export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const chunks = useRef<Float32Array[]>([])
  const frames = useRef(0)
  const context = useRef<AudioContext | null>(null)
  const stream = useRef<MediaStream | null>(null)

  const teardown = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    void context.current?.close().catch(() => undefined)
    context.current = null
  }, [])

  // Releasing the microphone is not optional housekeeping: a navigation away
  // mid-take would otherwise leave the browser's recording indicator lit.
  useEffect(() => teardown, [teardown])

  useEffect(() => {
    if (state !== 'recording') return
    const timer = setInterval(() => {
      const rate = context.current?.sampleRate ?? AUDIO_SAMPLE_RATE
      setElapsedMs(Math.floor((frames.current / rate) * 1000))
    }, 200)
    return () => clearInterval(timer)
  }, [state])

  const start = useCallback(async () => {
    setErrorKey(null)
    setState('requesting')
    chunks.current = []
    frames.current = 0

    // Which half failed decides what the student is told. "Allow the
    // microphone" is useless advice when the real problem is that the worklet
    // module did not load, and it would have them retry forever.
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch (error) {
      console.error('[recorder] microphone unavailable', error)
      setState('idle')
      setErrorKey('today.micDenied')
      return false
    }

    try {
      // Ask for 16 kHz so no resampling is needed. `encodeTake` still reads the
      // rate the context actually got — browsers may decline the hint.
      const ctx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
      await ctx.audioWorklet.addModule(WORKLET_URL)

      const node = new AudioWorkletNode(ctx, 'pcm-recorder')
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        chunks.current.push(event.data)
        frames.current += event.data.length
      }

      ctx.createMediaStreamSource(media).connect(node)
      // Through a muted gain to the destination: a worklet with nothing
      // downstream is not guaranteed to be pulled, and routing it to the
      // speakers unmuted would feed the student their own voice.
      const muted = ctx.createGain()
      muted.gain.value = 0
      node.connect(muted).connect(ctx.destination)

      stream.current = media
      context.current = ctx
      setElapsedMs(0)
      setState('recording')
      return true
    } catch (error) {
      console.error('[recorder] could not open the capture graph', error)
      // `media` is open but was never handed to `stream`, so teardown cannot see
      // it — release it here or the recording indicator stays lit.
      media.getTracks().forEach((track) => track.stop())
      teardown()
      setState('idle')
      setErrorKey('today.recorderUnavailable')
      return false
    }
  }, [teardown])

  const stop = useCallback(async () => {
    const ctx = context.current
    if (!ctx) return null

    const sampleRate = ctx.sampleRate
    const recorded = chunks.current
    chunks.current = []
    teardown()
    setState('idle')

    if (recorded.length === 0) return null
    return encodeTake(recorded, sampleRate)
  }, [teardown])

  return { state, elapsedMs, errorKey, start, stop }
}
