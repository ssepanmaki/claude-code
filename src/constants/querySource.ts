/**
 * Identifies the business source of a model/API call, used for telemetry breakdown, cache control and 529 retry policy.
 * The value domain grows with features (including prefixes such as `repl_main_thread:*` and `agent:*`), so `string` is used;
 * common literals appear at the call sites and in `FOREGROUND_529_RETRY_SOURCES` in `withRetry.ts`.
 */
export type QuerySource = string // free-text label aligned with the source field in logs/statistics
