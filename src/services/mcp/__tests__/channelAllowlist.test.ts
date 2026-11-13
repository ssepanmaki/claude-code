import { describe, expect, mock, test } from 'bun:test'

mock.module('../../analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => [],
}))

import { isChannelAllowlisted } from '../channelAllowlist.js'

describe('isChannelAllowlisted', () => {
  test('rejects builtin plugins that are not on the allowlist', () => {
    expect(isChannelAllowlisted('example@builtin')).toBe(false)
  })

  test('rejects undefined plugin source', () => {
    expect(isChannelAllowlisted(undefined)).toBe(false)
  })
})
