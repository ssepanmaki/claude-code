import { randomUUID } from 'crypto'
import { getInitialSettings } from './settings/settings.js'
import type { Message } from '../types/message.js'

// Usage type (extracted from the API response)
interface Usage {
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface CacheHitRateInfo {
  hitRate: number
  threshold: number
  trend: number | null // positive = rising, negative = falling
  shouldWarn: boolean
}

interface CacheWarningState {
  lastHitRate: number | null
  lastTimestamp: number | null
}

// Module-level state, tracked independently per querySource
const cacheWarningStateBySource = new Map<string, CacheWarningState>()

// Limit the number of tracked sources to prevent unbounded Map growth.
// querySource strings are effectively unbounded (typed as `any`), so a
// long-running session that spawns many subagents could leak memory.
// Evict the oldest entry (by insertion order) when the limit is exceeded.
const MAX_SOURCE_ENTRIES = 50

const DEFAULT_CACHE_THRESHOLD = 70

/**
 * Read the cache threshold config from settings.json
 */
export function getCacheThreshold(): number {
  const settings = getInitialSettings()
  return settings.cacheThreshold ?? DEFAULT_CACHE_THRESHOLD
}

/**
 * Check whether cache warnings are enabled. Defaults to true.
 */
export function isCacheWarningEnabled(): boolean {
  const settings = getInitialSettings()
  return settings.cacheWarningEnabled ?? true
}

/**
 * Compute the cache hit rate
 * Returns a value in the range 0-100; null means no valid data
 */
export function calculateCacheHitRate(
  usage: Usage | null | undefined,
): number | null {
  if (!usage) return null

  const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens } =
    usage

  // All cache fields being 0 means there is no cache data
  if (cache_read_input_tokens === 0 && cache_creation_input_tokens === 0) {
    return null
  }

  const totalInputTokens =
    input_tokens + cache_creation_input_tokens + cache_read_input_tokens
  if (totalInputTokens === 0) return null

  return (cache_read_input_tokens / totalInputTokens) * 100
}

/**
 * Detect whether a cache warning needs to be shown
 * @param usage API usage data
 * @param querySource query source (used to track state independently)
 * @param threshold cache threshold percentage
 * @returns warning info, or null if no warning is needed
 */
export function shouldShowCacheWarning(
  usage: Usage | null | undefined,
  querySource: string,
  threshold: number,
): CacheHitRateInfo | null {
  const hitRate = calculateCacheHitRate(usage)

  // No cache data
  if (hitRate === null) {
    return null
  }

  // Get or initialize the state for this querySource
  let state = cacheWarningStateBySource.get(querySource)
  if (!state) {
    state = { lastHitRate: null, lastTimestamp: null }
    // Evict oldest entry when at capacity so the Map stays bounded
    if (cacheWarningStateBySource.size >= MAX_SOURCE_ENTRIES) {
      const oldestKey = cacheWarningStateBySource.keys().next().value
      if (oldestKey !== undefined) {
        cacheWarningStateBySource.delete(oldestKey)
      }
    }
    cacheWarningStateBySource.set(querySource, state)
  }

  // Do not show a warning for the first request
  if (state.lastHitRate === null) {
    state.lastHitRate = hitRate
    state.lastTimestamp = Date.now()
    return null
  }

  // Compute the trend
  const trend = hitRate - state.lastHitRate

  // Update state
  state.lastHitRate = hitRate
  state.lastTimestamp = Date.now()

  // Check whether a warning is needed
  if (hitRate < threshold) {
    return { hitRate, threshold, trend, shouldWarn: true }
  }

  return null
}

/**
 * Generate the cache warning message
 * @param info cache warning info
 * @returns system-type message, visible in the REPL main screen and in transcript mode
 */
export function createCacheWarningMessage(info: CacheHitRateInfo): Message {
  const { hitRate, threshold, trend } = info

  let content = `Cache hit rate ${hitRate.toFixed(0)}%, below ${threshold}% threshold`

  if (trend !== null && Math.abs(trend) > 0.1) {
    const trendIcon = trend > 0 ? '^' : 'v'
    const trendPercent = Math.abs(trend).toFixed(0)
    content += ` (${trendIcon}${trendPercent}%)`
  }

  return {
    type: 'system',
    subtype: 'cache_warning',
    level: 'warning' as const,
    content,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  } as Message
}

/**
 * Reset the per-source tracking state — only used in tests.
 */
export function _resetCacheWarningStateForTest(): void {
  cacheWarningStateBySource.clear()
}
