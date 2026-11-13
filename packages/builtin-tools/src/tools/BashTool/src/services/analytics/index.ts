/** Synchronously logs an analytics event (queued when no sink is attached); same as `logEvent` in the host `src/services/analytics/index.js`. */
export type logEvent = typeof import('src/services/analytics/index.js').logEvent
