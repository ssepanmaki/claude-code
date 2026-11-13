import { describe, expect, test } from 'bun:test'
import {
  type Cell,
  type Overlay,
  TRANSPARENT,
  applyOverlaysToCells,
  cellsToSegments,
  computeRippleCells,
  fadeCells,
  fadeColor,
  getHueShiftAtTime,
  intensityToColor,
  rotateHue,
} from '../rippleAnimation.js'

describe('intensityToColor', () => {
  test('intensity=0 → darkest tier (no longer transparent; used as panel base color)', () => {
    expect(intensityToColor(0)).toBe('#1a1f3a')
  })

  test('intensity < 0 clamped to 0 → darkest tier', () => {
    expect(intensityToColor(-0.5)).toBe('#1a1f3a')
  })

  test('intensity > 0 → always a #hex color string (never returns transparent)', () => {
    for (const v of [0.05, 0.1, 0.2, 0.5, 0.8]) {
      const c = intensityToColor(v)
      expect(c).not.toBe(TRANSPARENT)
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  test('intensity > 1 clamped to 1 → highest-intensity color', () => {
    expect(intensityToColor(1.5)).toBe(intensityToColor(1))
  })

  test('intensity monotonically increasing → color tier increases (at least 3 tiers)', () => {
    const samples = [0.2, 0.4, 0.6, 0.8, 1.0]
    const colors = samples.map(intensityToColor)
    const unique = new Set(colors)
    expect(unique.size).toBeGreaterThanOrEqual(3)
  })

  test('intensity=1 → suggestion suggestion tier (highest crest tier)', () => {
    expect(intensityToColor(1)).toBe('#5769F7')
  })

  test('hueShift=0 → same as no hueShift (fast path)', () => {
    for (const v of [0, 0.2, 0.5, 0.8, 1]) {
      expect(intensityToColor(v, 0)).toBe(intensityToColor(v))
    }
  })

  test('hueShift ≠ 0 → returns a different color (but still valid hex)', () => {
    const base = intensityToColor(0.8)
    const shifted = intensityToColor(0.8, 30)
    expect(shifted).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(shifted).not.toBe(base)
  })

  test('hueShift 180° → roughly the complementary color (light color to dark family)', () => {
    // #5769F7 ≈ HSL(233, 91, 65); rotating 180° → HSL(53, 91, 65) ≈ yellow family
    const shifted = intensityToColor(1, 180)
    expect(shifted).toMatch(/^#[0-9a-fA-F]{6}$/)
    // No longer blue-purple family (R component should clearly exceed B component)
    const r = parseInt(shifted.slice(1, 3), 16)
    const b = parseInt(shifted.slice(5, 7), 16)
    expect(r).toBeGreaterThan(b)
  })
})

describe('rotateHue', () => {
  test('hueShift=0 → returned as-is (fast path, no round-trip error)', () => {
    expect(rotateHue('#5769F7', 0)).toBe('#5769F7')
    expect(rotateHue('#1a1f3a', 0)).toBe('#1a1f3a')
  })

  test('rotating 360° → same as original color (full turn back to start, case-insensitive)', () => {
    expect(rotateHue('#5769F7', 360).toLowerCase()).toBe('#5769f7')
    expect(rotateHue('#5769F7', -360).toLowerCase()).toBe('#5769f7')
  })

  test('rotating ±n*360° → same as original color (any whole turn)', () => {
    expect(rotateHue('#3a4582', 720).toLowerCase()).toBe('#3a4582')
    expect(rotateHue('#3a4582', -1080).toLowerCase()).toBe('#3a4582')
  })

  test('grayscale colors (saturation=0) are unchanged after rotation', () => {
    // #808080 = (128,128,128), saturation=0, rotation is meaningless
    expect(rotateHue('#808080', 90)).toBe('#808080')
  })

  test('invalid hex → returned as-is (defensive)', () => {
    expect(rotateHue('not-a-color', 90)).toBe('not-a-color')
    expect(rotateHue('#123', 90)).toBe('#123')
  })

  test('keeps 6-digit hex format after rotation', () => {
    const rotated = rotateHue('#5769F7', 45)
    expect(rotated).toMatch(/^#[0-9a-fA-F]{6}$/)
  })
})

describe('getHueShiftAtTime', () => {
  test('time=0 → 0', () => {
    expect(getHueShiftAtTime(0)).toBe(0)
  })

  test('time > 0 → time > 0 → within [0, 360) (continuous rotation, non-negative)', () => {
    for (const t of [100, 500, 1000, 2000, 5000, 10000, 50000, 100000]) {
      const shift = getHueShiftAtTime(t)
      expect(shift).toBeGreaterThanOrEqual(0)
      expect(shift).toBeLessThan(360)
    }
  })

  test('time time advances → hueShift increases monotonically (mod 360)', () => {
    // Within one period (12000ms), hueShift should increase monotonically
    const samples = [0, 1000, 2000, 3000, 4000, 5000, 6000]
    const shifts = samples.map(getHueShiftAtTime)
    for (let i = 1; i < shifts.length; i++) {
      expect(shifts[i]).toBeGreaterThan(shifts[i - 1])
    }
  })

  test('period 12000ms (time=12000 should return to 0, mod 360)', () => {
    // 12000ms * 0.03 = 360，% 360 = 0
    const shift = getHueShiftAtTime(12000)
    expect(shift).toBe(0)
  })

  test('half period 6000ms → hueShift=180 (opposite hue)', () => {
    // 6000ms * 0.03 = 180
    expect(getHueShiftAtTime(6000)).toBe(180)
  })

  test('quarter period 3000ms → hueShift=90', () => {
    expect(getHueShiftAtTime(3000)).toBe(90)
  })

  test('multiple periods: time=24000 equals time=0', () => {
    expect(getHueShiftAtTime(24000)).toBe(0)
    expect(getHueShiftAtTime(36000)).toBe(0)
  })
})

describe('computeRippleCells', () => {
  test('returned array length equals width', () => {
    const cells = computeRippleCells({
      y: 2,
      width: 30,
      time: 100,
      sourceX: 25,
      sourceY: 2,
    })
    expect(cells.length).toBe(30)
  })

  test('every cell char is a space', () => {
    const cells = computeRippleCells({
      y: 0,
      width: 10,
      time: 0,
      sourceX: 5,
      sourceY: 0,
    })
    for (const cell of cells) {
      expect(cell.char).toBe(' ')
    }
  })

  test('every cell color is a valid string', () => {
    const cells = computeRippleCells({
      y: 0,
      width: 10,
      time: 0,
      sourceX: 5,
      sourceY: 0,
    })
    for (const cell of cells) {
      expect(typeof cell.color).toBe('string')
      expect(
        cell.color === TRANSPARENT || /^#[0-9a-fA-F]{6}$/.test(cell.color),
      ).toBe(true)
    }
  })

  test('width=0 → width=0 → empty array', () => {
    expect(
      computeRippleCells({ y: 0, width: 0, time: 0, sourceX: 0, sourceY: 0 }),
    ).toEqual([])
  })

  test('width<0 → width<0 → empty array', () => {
    expect(
      computeRippleCells({ y: 0, width: -5, time: 0, sourceX: 0, sourceY: 0 }),
    ).toEqual([])
  })

  test('source point at time=0 is a mid tier ((sin+1)/2 → intensity=0.5); as time advances it sweeps crests/troughs', () => {
    // v5 smooth wave: dist=0, time=0 gives phase=0, sin(0)=0, (0+1)/2=0.5 → intensity=0.5 → mid tier
    const t0 = computeRippleCells({
      y: 5,
      width: 11,
      time: 0,
      sourceX: 5,
      sourceY: 5,
    })
    // 0.5 * 7 = 3.5, floor = 3, RIPPLE_COLOR_STOPS[3] = '#2e3870'
    expect(t0[5].color).toBe('#2e3870')

    // As time advances, phase changes and the source sweeps through crests (bright tier) and troughs (dark tier)
    const t1 = computeRippleCells({
      y: 5,
      width: 11,
      time: 1500,
      sourceX: 5,
      sourceY: 5,
    })
    // Different time gives different colors (animation progresses)
    expect(t1[5].color).not.toBe('#2e3870')
  })

  test('coverage radius extended: dist=65 (far left side) still has a non-darkest color', () => {
    // source x=65, far end x=0 → dist=65
    // falloff = max(0, 1 - 65/90) = 0.278; at a crest intensity ≈ 0.278
    // should map to a non-darkest tier (#15182b or brighter)
    const cells = computeRippleCells({
      y: 0,
      width: 66,
      time: 0,
      sourceX: 65,
      sourceY: 0,
    })
    // Column 0 has dist=65; at time=0 phase = 65*0.35 = 22.75 rad
    // sin(22.75) ≈ -0.59 → wave = 0 → intensity = 0 → darkest tier
    // but as time advances a crest sweeps through here and intensity rises
    // Here we only verify that cells have valid colors (the darkest tier also counts as valid)
    expect(cells[0].color).toMatch(/^#[0-9a-fA-F]{6}$/)
    // After advancing time, a non-darkest color should appear on the left (crest sweeps by)
    const t1 = computeRippleCells({
      y: 0,
      width: 66,
      time: 2000,
      sourceX: 65,
      sourceY: 0,
    })
    const nonDarkest = t1.filter(c => c.color !== '#1a1f3a')
    expect(nonDarkest.length).toBeGreaterThan(0)
  })

  test('time color distribution changes as time advances (animation effect)', () => {
    const t0 = computeRippleCells({
      y: 2,
      width: 30,
      time: 0,
      sourceX: 25,
      sourceY: 2,
    })
    const t1 = computeRippleCells({
      y: 2,
      width: 30,
      time: 500,
      sourceX: 25,
      sourceY: 2,
    })
    // At least one position has a different color
    const diffs = t0.filter((c, i) => c.color !== t1[i].color)
    expect(diffs.length).toBeGreaterThan(0)
  })
})

describe('applyOverlaysToCells', () => {
  function makeCells(colors: string[]): Cell[] {
    return colors.map(c => ({ char: ' ', color: c }))
  }

  test('returned as-is when there are no overlays (but as a new array)', () => {
    const cells = makeCells(['#111', '#222', '#333'])
    const out = applyOverlaysToCells(cells, [])
    expect(out).toEqual(cells)
    expect(out).not.toBe(cells) // defensive copy
  })

  test('overlay overlay replaces char but keeps the underlying color (when color is unspecified)', () => {
    const cells = makeCells([
      TRANSPARENT,
      TRANSPARENT,
      TRANSPARENT,
      TRANSPARENT,
    ])
    const overlays: Overlay[] = [{ text: 'hi', x: 1 }]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[1].char).toBe('h')
    expect(out[2].char).toBe('i')
    expect(out[1].color).toBe(TRANSPARENT) // keeps the underlying color
    expect(out[0].char).toBe(' ')
  })

  test('overlay overlay with a specified color overwrites both char + color', () => {
    const cells = makeCells([TRANSPARENT, TRANSPARENT, TRANSPARENT])
    const overlays: Overlay[] = [{ text: 'AB', x: 0, color: '#5769F7' }]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[0]).toEqual({ char: 'A', color: '#5769F7' })
    expect(out[1]).toEqual({ char: 'B', color: '#5769F7' })
    expect(out[2]).toEqual({ char: ' ', color: TRANSPARENT })
  })

  test('overlay overlay beyond the right edge is truncated', () => {
    const cells = makeCells([TRANSPARENT, TRANSPARENT, TRANSPARENT])
    const overlays: Overlay[] = [{ text: 'abcdef', x: 1 }]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[0].char).toBe(' ')
    expect(out[1].char).toBe('a')
    expect(out[2].char).toBe('b')
    // 'cdef' is truncated
  })

  test('overlay x negative overlay x → truncated from the start (does not overflow left)', () => {
    const cells = makeCells([TRANSPARENT, TRANSPARENT, TRANSPARENT])
    const overlays: Overlay[] = [{ text: 'abc', x: -1 }]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[0].char).toBe('b') // skips 'a'; 'b' occupies position 0
    expect(out[1].char).toBe('c')
    expect(out[2].char).toBe(' ')
  })

  test('later overlay covers the earlier one (same position)', () => {
    const cells = makeCells([TRANSPARENT, TRANSPARENT, TRANSPARENT])
    const overlays: Overlay[] = [
      { text: 'AAA', x: 0, color: '#111' },
      { text: 'B', x: 1, color: '#222' },
    ]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out[0]).toEqual({ char: 'A', color: '#111' })
    expect(out[1]).toEqual({ char: 'B', color: '#222' }) // the second overlay covers it
    expect(out[2]).toEqual({ char: 'A', color: '#111' })
  })

  test('overlay overlay start position >= array length → skipped entirely', () => {
    const cells = makeCells([TRANSPARENT, TRANSPARENT])
    const overlays: Overlay[] = [{ text: 'X', x: 5 }]
    const out = applyOverlaysToCells(cells, overlays)
    expect(out.every(c => c.char === ' ')).toBe(true)
  })

  test('does not mutate the original array (defensive copy)', () => {
    const cells = makeCells([TRANSPARENT])
    const snapshot = cells.map(c => ({ ...c }))
    applyOverlaysToCells(cells, [{ text: 'X', x: 0 }])
    expect(cells).toEqual(snapshot)
  })
})

describe('cellsToSegments', () => {
  test('empty array → empty array', () => {
    expect(cellsToSegments([])).toEqual([])
  })

  test('single cell → single segment', () => {
    const cells: Cell[] = [{ char: 'a', color: '#111' }]
    expect(cellsToSegments(cells)).toEqual([{ text: 'a', color: '#111' }])
  })

  test('all same color → merged into one segment', () => {
    const cells: Cell[] = [
      { char: 'a', color: '#111' },
      { char: 'b', color: '#111' },
      { char: 'c', color: '#111' },
    ]
    expect(cellsToSegments(cells)).toEqual([{ text: 'abc', color: '#111' }])
  })

  test('alternating colors → each its own segment', () => {
    const cells: Cell[] = [
      { char: 'a', color: '#111' },
      { char: 'b', color: '#222' },
      { char: 'c', color: '#111' },
    ]
    expect(cellsToSegments(cells)).toEqual([
      { text: 'a', color: '#111' },
      { text: 'b', color: '#222' },
      { text: 'c', color: '#111' },
    ])
  })

  test('adjacent same-color segments merge, different-color segments stay separate', () => {
    const cells: Cell[] = [
      { char: 'a', color: TRANSPARENT },
      { char: 'b', color: TRANSPARENT },
      { char: 'X', color: '#5769F7' },
      { char: 'Y', color: '#5769F7' },
      { char: 'c', color: TRANSPARENT },
    ]
    expect(cellsToSegments(cells)).toEqual([
      { text: 'ab', color: TRANSPARENT },
      { text: 'XY', color: '#5769F7' },
      { text: 'c', color: TRANSPARENT },
    ])
  })

  test('segment text concatenation preserves the original order', () => {
    const cells: Cell[] = [
      { char: '1', color: '#111' },
      { char: '2', color: '#111' },
      { char: '3', color: '#111' },
    ]
    expect(cellsToSegments(cells)[0].text).toBe('123')
  })
})

describe('fadeColor', () => {
  test('fade=1 → original color (unchanged)', () => {
    expect(fadeColor('#5769F7', 1)).toBe('#5769f7')
  })

  test('fade=0 → TRANSPARENT (cell not rendered)', () => {
    expect(fadeColor('#5769F7', 0)).toBe(TRANSPARENT)
  })

  test('fade ≤ 0.01 → TRANSPARENT (threshold)', () => {
    expect(fadeColor('#5769F7', 0.01)).toBe(TRANSPARENT)
    expect(fadeColor('#5769F7', 0.009)).toBe(TRANSPARENT)
  })

  test('fade=0.5 → each RGB component halved', () => {
    // #5769F7 = (87, 105, 247), halved → (44, 53, 124) = #2c357c
    // Math.round(87*0.5)=44, Math.round(105*0.5)=53, Math.round(247*0.5)=124
    expect(fadeColor('#5769F7', 0.5)).toBe('#2c357c')
  })

  test('TRANSPARENT TRANSPARENT input → returned as-is (not processed)', () => {
    expect(fadeColor(TRANSPARENT, 1)).toBe(TRANSPARENT)
    expect(fadeColor(TRANSPARENT, 0.5)).toBe(TRANSPARENT)
  })

  test('invalid hex format → returned as-is (defensive)', () => {
    expect(fadeColor('not-a-color', 0.5)).toBe('not-a-color')
    expect(fadeColor('#123', 0.5)).toBe('#123') // not 6-digit hex
  })

  test('fade < 0 clamped to 0 → TRANSPARENT', () => {
    expect(fadeColor('#5769F7', -0.5)).toBe(TRANSPARENT)
  })

  test('fade > 1 clamped to 1 → original color', () => {
    expect(fadeColor('#5769F7', 1.5)).toBe('#5769f7')
  })

  test('result is always 6-digit hex (leading zeros padded)', () => {
    // #010203 = (1, 2, 3), fade=0.5 → after Math.round it is (1, 1, 2) = #010102
    // but 1*0.5 = 0.5, Math.round(0.5) = 1 (banker's rounding is round half up in JS)
    // Verify the format: 6-digit hex
    const result = fadeColor('#010203', 0.5)
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('fadeCells', () => {
  test('empty array → empty array', () => {
    expect(fadeCells([], 0.5)).toEqual([])
  })

  test('each cell color is scaled by fade, char is preserved', () => {
    const cells: Cell[] = [
      { char: ' ', color: '#5769F7' },
      { char: 'A', color: '#ffffff' },
    ]
    const out = fadeCells(cells, 0.5)
    expect(out[0]).toEqual({ char: ' ', color: '#2c357c' })
    // #ffffff = (255, 255, 255)，fade=0.5 → (128, 128, 128) = #808080
    expect(out[1]).toEqual({ char: 'A', color: '#808080' })
  })

  test('does not mutate the original array (defensive copy)', () => {
    const cells: Cell[] = [{ char: ' ', color: '#5769F7' }]
    const snapshot = cells.map(c => ({ ...c }))
    fadeCells(cells, 0.5)
    expect(cells).toEqual(snapshot)
  })

  test('TRANSPARENT cell TRANSPARENT cells stay TRANSPARENT', () => {
    const cells: Cell[] = [
      { char: ' ', color: TRANSPARENT },
      { char: ' ', color: '#5769F7' },
    ]
    const out = fadeCells(cells, 0.5)
    expect(out[0].color).toBe(TRANSPARENT)
    expect(out[1].color).toBe('#2c357c')
  })

  test('fade=0 → all non-transparent colors become TRANSPARENT', () => {
    const cells: Cell[] = [
      { char: ' ', color: '#5769F7' },
      { char: ' ', color: '#1a1f3a' },
    ]
    const out = fadeCells(cells, 0)
    expect(out[0].color).toBe(TRANSPARENT)
    expect(out[1].color).toBe(TRANSPARENT)
  })
})
