/** Reads GrowthBook/gate config from the disk cache (may be slightly stale); same as the host `getFeatureValue_CACHED_MAY_BE_STALE`. */
export type getFeatureValue_CACHED_MAY_BE_STALE =
  typeof import('src/services/analytics/growthbook.js').getFeatureValue_CACHED_MAY_BE_STALE
