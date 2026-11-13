import { describe, expect, test } from 'bun:test'
import type { EffortValue } from '../../../utils/effort.js'
import {
  CANCEL_MESSAGE,
  type ApplyFn,
  ULTRACODE_HINT,
  END_POSITION,
  HOME_POSITION,
  PANEL_POSITIONS,
  type PanelPosition,
  computeConfirmOutcome,
  getInitialCursor,
  isUltracode,
  moveLeft,
  moveRight,
} from '../effortPanelState.js'

describe('effortPanelState', () => {
  test('PANEL_POSITIONS order is low → ultracode', () => {
    expect(PANEL_POSITIONS).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultracode',
    ])
  })

  test('moveLeft stays at low when already at low', () => {
    expect(moveLeft('low')).toBe('low')
  })

  test('moveLeft moves left normally', () => {
    expect(moveLeft('high')).toBe('medium')
    expect(moveLeft('ultracode')).toBe('max')
  })

  test('moveRight stays at ultracode when already at ultracode', () => {
    expect(moveRight('ultracode')).toBe('ultracode')
  })

  test('moveRight moves right normally', () => {
    expect(moveRight('medium')).toBe('high')
    expect(moveRight('max')).toBe('ultracode')
  })

  test('HOME_POSITION equals low', () => {
    expect(HOME_POSITION).toBe('low')
  })

  test('END_POSITION equals ultracode', () => {
    expect(END_POSITION).toBe('ultracode')
  })

  test('isUltracode guard', () => {
    expect(isUltracode('ultracode')).toBe(true)
    expect(isUltracode('max')).toBe(false)
  })

  test('getInitialCursorreturns the env value when the env override is a valid tier', () => {
    expect(
      getInitialCursor({
        envOverride: 'high',
        appStateEffort: 'medium',
        displayed: 'high',
      }),
    ).toBe('high')
  })

  test('getInitialCursoruses displayed when env is null (unset)', () => {
    expect(
      getInitialCursor({
        envOverride: null,
        appStateEffort: undefined,
        displayed: 'medium',
      }),
    ).toBe('medium')
  })

  test('getInitialCursoruses displayed when env is undefined', () => {
    expect(
      getInitialCursor({
        envOverride: undefined,
        appStateEffort: 'high',
        displayed: 'high',
      }),
    ).toBe('high')
  })

  test('getInitialCursorfalls back to displayed when env is numeric (ant-only)', () => {
    // A number is not a valid PanelPosition; fall back
    expect(
      getInitialCursor({
        envOverride: 75,
        appStateEffort: 'medium',
        displayed: 'medium',
      }),
    ).toBe('medium')
  })

  test('PanelPosition type is checked at compile time (implicit)', () => {
    const p: PanelPosition = 'xhigh'
    expect(p).toBe('xhigh')
  })
})

describe('computeConfirmOutcome', () => {
  const mockApply: ApplyFn = cursor => ({
    message: `applied:${cursor}`,
    // In the test the cursor is a PanelPosition (including ultracode), but the ApplyFn contract requires EffortValue.
    // At runtime mockApply is only called by computeConfirmOutcome on non-ultracode tiers,
    // so the cast is safe. Production code with the real executeEffort never sees ultracode.
    effortUpdate: { value: cursor as unknown as EffortValue },
  })

  test('ultracode → kind=ultracode-hintkind=ultracode-hint, includes the /ultracode guidance', () => {
    const out = computeConfirmOutcome('ultracode', mockApply)
    expect(out.kind).toBe('ultracode-hint')
    if (out.kind === 'ultracode-hint') {
      expect(out.message).toBe(ULTRACODE_HINT)
      expect(out.message).toContain('/ultracode')
    }
  })

  test('ultracode does not call applyFn (never triggered as a side effect)', () => {
    let called = false
    const spy: ApplyFn = c => {
      called = true
      return { message: `applied:${c}` }
    }
    computeConfirmOutcome('ultracode', spy)
    expect(called).toBe(false)
  })

  test('low → kind=applykind=apply, message comes from applyFn, effortUpdate passes through', () => {
    const out = computeConfirmOutcome('low', mockApply)
    expect(out.kind).toBe('apply')
    if (out.kind === 'apply') {
      expect(out.message).toBe('applied:low')
      expect(out.effortUpdate?.value).toBe('low')
    }
  })

  test('high → apply apply path does not take the ultracode branch', () => {
    const out = computeConfirmOutcome('high', mockApply)
    expect(out.kind).toBe('apply')
  })

  test('applyFn outcome.effortUpdate is undefined when applyFn returns no effortUpdate', () => {
    const noUpdate: ApplyFn = c => ({ message: `applied:${c}` })
    const out = computeConfirmOutcome('medium', noUpdate)
    expect(out.kind).toBe('apply')
    if (out.kind === 'apply') {
      expect(out.effortUpdate).toBeUndefined()
    }
  })
})

test('constant strings', () => {
  expect(CANCEL_MESSAGE).toBe('Effort unchanged.')
  expect(ULTRACODE_HINT).toContain('/ultracode <context>')
})
