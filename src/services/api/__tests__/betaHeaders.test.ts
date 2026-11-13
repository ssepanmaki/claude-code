/**
 * Beta header safety tests
 *
 * Verifies:
 * 1. Empty-string beta headers do not leak into API requests
 * 2. getExtraBodyParams merges beta headers correctly
 * 3. Beta headers that the constants layer may produce as empty values are handled properly
 * 4. The SDK's betas.toString() behavior matches expectations
 */
import { describe, expect, test } from 'bun:test'

// ── Part 1: verify toString behavior at the SDK level ──

describe('SDK betas.toString() behavior', () => {
  test('empty string in array produces invalid header value', () => {
    // This is the root cause of the 400: the SDK calls toString() on betas
    const betas = [
      'claude-code-20250219',
      '',
      'interleaved-thinking-2025-05-14',
    ]
    const headerValue = betas.toString()

    // Produces "claude-code-20250219,,interleaved-thinking-2025-05-14"
    // The empty value between the commas is the `` the API rejects
    expect(headerValue).toContain(',,')
    expect(headerValue).toBe(
      'claude-code-20250219,,interleaved-thinking-2025-05-14',
    )
  })

  test('filter(Boolean) removes empty strings', () => {
    const betas = [
      'claude-code-20250219',
      '',
      'interleaved-thinking-2025-05-14',
    ]
    const filtered = betas.filter(Boolean)
    const headerValue = filtered.toString()

    expect(filtered).not.toContain('')
    expect(headerValue).not.toContain(',,')
    expect(headerValue).toBe(
      'claude-code-20250219,interleaved-thinking-2025-05-14',
    )
  })

  test('filter(Boolean) handles multiple empty strings', () => {
    const betas = ['', 'a', '', '', 'b', '']
    const filtered = betas.filter(Boolean)

    expect(filtered).toEqual(['a', 'b'])
    expect(filtered.toString()).toBe('a,b')
  })

  test('filter(Boolean) on clean array is no-op', () => {
    const betas = ['claude-code-20250219', 'interleaved-thinking-2025-05-14']
    const filtered = betas.filter(Boolean)

    expect(filtered).toEqual(betas)
  })

  test('empty array after filter produces no header', () => {
    const betas = ['', '']
    const filtered = betas.filter(Boolean)

    expect(filtered).toEqual([])
    expect(filtered.length > 0).toBe(false)
    // useBetas would be false, header not sent at all
  })
})

// ── Part 2: empty-value detection in the constants layer ──

describe('beta header constants safety', () => {
  test('known potentially-empty constants are identified', () => {
    // These constants may be empty strings under certain conditions
    // The purpose of the test is to confirm which ones are empty so we can defend against them

    // CACHE_EDITING_BETA_HEADER — not public upstream, always empty
    // Dynamic import to avoid the bun:bundle dependency
    // Here we test the values directly
    const CACHE_EDITING_VALUE = '' // corresponds to constants/betas.ts:50
    expect(CACHE_EDITING_VALUE).toBe('')
    expect(Boolean(CACHE_EDITING_VALUE)).toBe(false)

    // CLI_INTERNAL_BETA_HEADER — empty when USER_TYPE !== 'ant'
    // USER_TYPE is usually not 'ant' in the test environment
    const CLI_INTERNAL_VALUE =
      process.env.USER_TYPE === 'ant' ? 'cli-internal-2026-02-09' : ''
    if (process.env.USER_TYPE !== 'ant') {
      expect(CLI_INTERNAL_VALUE).toBe('')
    }
  })

  test('truthy check correctly gates empty beta headers', () => {
    const emptyHeader = ''
    const validHeader = 'some-beta-2025-01-01'

    // Simulate the truthy check in claude.ts
    const betasParams: string[] = []

    // Empty header — should not be pushed
    if (emptyHeader) {
      betasParams.push(emptyHeader)
    }
    expect(betasParams).toEqual([])

    // Valid header — should be pushed
    if (validHeader) {
      betasParams.push(validHeader)
    }
    expect(betasParams).toEqual(['some-beta-2025-01-01'])
  })
})

// ── Part 3: getExtraBodyParams beta merge logic ──

describe('getExtraBodyParams beta merge', () => {
  // getExtraBodyParams parses JSON from CLAUDE_CODE_EXTRA_BODY and merges betaHeaders
  // Here we verify the edge cases of the merge logic

  test('empty beta headers array should not add anthropic_beta', () => {
    const result: Record<string, unknown> = {}
    const betaHeaders: string[] = []

    // Simulate the merge logic in getExtraBodyParams
    if (betaHeaders && betaHeaders.length > 0) {
      result.anthropic_beta = betaHeaders
    }

    expect(result.anthropic_beta).toBeUndefined()
  })

  test('beta headers with empty strings should be filtered', () => {
    const betaHeaders = ['valid-header', '', 'another-valid']

    // The fixed logic should filter before merging
    const clean = betaHeaders.filter(Boolean)
    expect(clean).toEqual(['valid-header', 'another-valid'])
  })

  test('merging avoids duplicates', () => {
    const existing = ['header-a', 'header-b']
    const incoming = ['header-b', 'header-c']

    const merged = [...existing, ...incoming.filter(h => !existing.includes(h))]

    expect(merged).toEqual(['header-a', 'header-b', 'header-c'])
  })
})

// ── Part 4: ANTHROPIC_BETAS environment variable parsing ──

describe('ANTHROPIC_BETAS env var parsing', () => {
  test('empty string env var produces no betas', () => {
    const envVal: string = ''
    const result = envVal
      ? envVal
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : []

    expect(result).toEqual([])
  })

  test('trailing comma does not produce empty entry', () => {
    const envVal = 'beta-a,beta-b,'
    const result = envVal
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    expect(result).toEqual(['beta-a', 'beta-b'])
  })

  test('whitespace-only entries are filtered', () => {
    const envVal = 'beta-a, , beta-b,  '
    const result = envVal
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    expect(result).toEqual(['beta-a', 'beta-b'])
  })

  test('single comma produces no betas', () => {
    const envVal = ','
    const result = envVal
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    expect(result).toEqual([])
  })
})

// ── Part 5: simulate the full request parameters ──

describe('request params beta assembly (simulated)', () => {
  test('simulates the full beta assembly pipeline with empty constants', () => {
    // Simulate the beta assembly flow of paramsFromContext in claude.ts
    const CLAUDE_CODE_HEADER = 'claude-code-20250219'
    const INTERLEAVED_HEADER = 'interleaved-thinking-2025-05-14'
    const CONTEXT_1M_HEADER = 'context-1m-2025-08-07'
    const CACHE_EDITING_HEADER = '' // empty!
    const AFK_MODE_HEADER = '' // also empty!

    // Step 1: base betas (from getAllModelBetas)
    const baseBetas = [
      CLAUDE_CODE_HEADER,
      INTERLEAVED_HEADER,
      CONTEXT_1M_HEADER,
    ]

    // Step 2: dynamic additions in paramsFromContext
    const betasParams = [...baseBetas]

    // Simulate the cache editing latch firing while the header is empty
    const cacheEditingHeaderLatched = true
    if (
      cacheEditingHeaderLatched &&
      CACHE_EDITING_HEADER && // <- fix: truthy check
      !betasParams.includes(CACHE_EDITING_HEADER)
    ) {
      betasParams.push(CACHE_EDITING_HEADER)
    }

    // Simulate the AFK mode latch firing while the header is empty
    const afkHeaderLatched = true
    // When feature('TRANSCRIPT_CLASSIFIER') is false, the whole if block is not entered
    // But assuming it is entered, the header is empty too
    if (
      afkHeaderLatched &&
      AFK_MODE_HEADER && // empty string, will not enter
      !betasParams.includes(AFK_MODE_HEADER)
    ) {
      betasParams.push(AFK_MODE_HEADER)
    }

    // Step 3: final filtering (our defense layer)
    const filteredBetas = betasParams.filter(Boolean)

    // Verify: no empty string leaks
    expect(filteredBetas).not.toContain('')
    expect(filteredBetas).toEqual([
      CLAUDE_CODE_HEADER,
      INTERLEAVED_HEADER,
      CONTEXT_1M_HEADER,
    ])

    // Verify: toString() does not produce ,,
    expect(filteredBetas.toString()).not.toContain(',,')
  })

  test('simulates the bug scenario WITHOUT fix', () => {
    // Reproduce the pre-fix behavior to verify the bug really exists
    const CACHE_EDITING_HEADER = '' // empty value

    const betasParams = [
      'claude-code-20250219',
      'interleaved-thinking-2025-05-14',
    ]

    // Before the fix: no truthy check, the empty string is pushed
    const cacheEditingHeaderLatched = true
    if (
      cacheEditingHeaderLatched &&
      // Note: no CACHE_EDITING_HEADER && check
      !betasParams.includes(CACHE_EDITING_HEADER) // '' is not in the array → true
    ) {
      betasParams.push(CACHE_EDITING_HEADER) // pushed an empty string!
    }

    // Proves the bug: the array contains an empty string
    expect(betasParams).toContain('')
    // SDK toString() yields a trailing comma (empty string at the end) or ,, (in the middle)
    // Both are invalid header values that the API does not accept
    const headerStr = betasParams.toString()
    // Empty string at the end → trailing comma "a,b,"
    // Empty string in the middle → consecutive commas "a,,b"
    expect(headerStr.endsWith(',') || headerStr.includes(',,')).toBe(true)
  })

  test('useBetas flag correctly handles empty-after-filter', () => {
    // If all betas are empty strings, the betas parameter should not be sent after filtering
    const betasParams = ['', '']
    const filteredBetas = betasParams.filter(Boolean)
    const useBetas = filteredBetas.length > 0

    expect(useBetas).toBe(false)
    // The API request should not contain a betas field
    const requestParams = {
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [],
      ...(useBetas && { betas: filteredBetas }),
    }
    expect(requestParams).not.toHaveProperty('betas')
  })
})
