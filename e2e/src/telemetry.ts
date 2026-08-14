/**
 * Mirror of `apps/app-web/src/lib/telemetry.ts`'s public shape.
 *
 * Declared rather than imported: the suite is black box and does not resolve app
 * source. AC-S2 is defined as an assertion on an event
 * (`home_to_recording_ms ≤ 10000`), so the event log is part of the product's
 * observable surface, the same as a route or a cookie name.
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
