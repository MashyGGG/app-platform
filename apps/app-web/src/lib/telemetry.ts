/**
 * Minimal client-side event log.
 *
 * AC-S2 is measured, not eyeballed: "从进入首页到开始录音 ≤10s · 测法：埋点
 * `home_to_recording_ms ≤ 10000`". So the number has to exist somewhere a
 * black-box test can read it, and `window.__appTelemetry` is that somewhere.
 *
 * There is no analytics vendor here and the MVP does not need one — IMPL §4.4's
 * four free-tier red lines are counted server-side. When one is added, this is
 * the single place that starts shipping events off the device.
 */
export interface TelemetryEvent {
  name: string
  at: number
  payload: Record<string, number | string | boolean>
}

declare global {
  interface Window {
    __appTelemetry?: TelemetryEvent[]
  }
}

export function track(name: string, payload: TelemetryEvent['payload'] = {}): void {
  if (typeof window === 'undefined') return
  const event: TelemetryEvent = { name, at: Date.now(), payload }
  ;(window.__appTelemetry ??= []).push(event)
  console.info('[telemetry]', name, payload)
}

/**
 * Milliseconds since this document started loading.
 *
 * `performance.now()` is relative to the navigation, which is exactly AC-S2's
 * "进入首页" — and unlike a React-mount timestamp it includes the time the page
 * spent rendering before any of our code ran.
 */
export function msSinceNavigation(): number {
  return Math.round(performance.now())
}
