/**
 * EffortPanel ultracode tier background ripple animation — pure function module (color driven).
 *
 * Design:
 * - Starts only when the cursor rests on ultracode (the subscription clock is controlled by useRippleFrame)
 * - Source: bottom-right of the panel (the ultracode glyph position), radiating concentric waves left/up
 * - Per-position intensity (0~1) → color (dark purple-blue gradient of the suggestion family)
 * - Text overlays sit on top of the ripple (last-write-wins, color can be set independently)
 *
 * Render model: one cell (char + color) per position; adjacent same-color cells merge into segments.
 * The render layer outputs a Box flexDirection="row" with multiple Text segments (one color each).
 *
 * All functions are pure: same inputs → same outputs, which eases unit tests + frame snapshots.
 */

/**
 * Color gradient of the suggestion family (dark background → suggestion color).
 *
 * Design: every intensity maps to a concrete color (never transparent), so the whole panel is
 * a "dark purple-blue ocean" base color with wave crests flowing over it. This makes the ripple
 * color changes more visible, and troughs stay dark too (they do not "disappear").
 *
 * The darkest tier is #1a1f3a (purple-black, ~12% luminance), not pure black — so distant
 * troughs do not look like a "hard black edge". Crests top out at suggestion (#5769F7), avoiding
 * the same color as text overlays (also suggestion family), which would swallow each other.
 *
 * These are the base colors (returned when hueShift=0). Production code passes hueShift so the
 * whole gradient rotates around the hue wheel, creating a drifting-primary-color effect over time.
 */
const RIPPLE_COLOR_STOPS = [
  '#1a1f3a', // 0.00 ~ 0.14 — darkest (purple-black base, not pure black)
  '#1f2543', // 0.14 ~ 0.28
  '#252c55', // 0.28 ~ 0.42
  '#2e3870', // 0.42 ~ 0.56
  '#3a4582', // 0.56 ~ 0.70
  '#4a5bb0', // 0.70 ~ 0.84
  '#5769F7', // 0.84 ~ 1.00 — suggestion (wave crest)
] as const

/**
 * Continuous hue rotation speed (degrees/ms).
 * Period = 360 / 0.03 = 12000ms = 12s, far slower than the ripple phase (~1.6s),
 * so the color drift feels "ambient" rather than "animated".
 *
 * Continuous rotation (not sin oscillation) visits the whole 0~360° hue wheel:
 * blue 233° → purple 270° → magenta 300° → red 0° → orange 30° → yellow 60° →
 * green 120° → cyan 180° → blue 233° (one full turn).
 */
const HUE_ROTATION_DEG_PER_MS = 0.03

/**
 * hex → {h, s, l} (h in degrees, s/l in 0~1).
 *
 * Standard RGB → HSL conversion. Invalid hex (not #rrggbb) → h=0, s=0, l=0 (black).
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { h: 0, s: 0, l: 0 }
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) {
    h = 60 * (((g - b) / d) % 6)
  } else if (max === g) {
    h = 60 * ((b - r) / d + 2)
  } else {
    h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s, l }
}

/**
 * {h, s, l} → hex。
 *
 * Standard HSL → RGB conversion. h is automatically taken mod 360.
 */
function hslToHex(h: number, s: number, l: number): string {
  const hNorm = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hPrime = hNorm / 60
  const x = c * (1 - Math.abs((hPrime % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hPrime < 1) {
    r = c
    g = x
  } else if (hPrime < 2) {
    r = x
    g = c
  } else if (hPrime < 3) {
    g = c
    b = x
  } else if (hPrime < 4) {
    g = x
    b = c
  } else if (hPrime < 5) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const m = l - c / 2
  const toHex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Rotate a hex color around the hue wheel by hueShift degrees.
 *
 * Keeps saturation and lightness unchanged and rotates only the hue. Used to make RIPPLE_COLOR_STOPS as a whole
 * drift to different hues (blue→cyan→purple→blue cycle), so the primary color changes over time.
 *
 * Invalid hex is returned as-is (defensive).
 */
export function rotateHue(hex: string, hueShift: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  if (hueShift === 0) return hex // fast path: avoid a pointless round-trip
  const { h, s, l } = hexToHsl(hex)
  return hslToHex(h + hueShift, s, l)
}

/**
 * Compute the current hue offset from time (degrees, continuous rotation).
 *
 * The return value is always in [0, 360) and monotonically increasing (mod 360).
 * About 12s per turn, covering the full color wheel.
 */
export function getHueShiftAtTime(time: number): number {
  return (time * HUE_ROTATION_DEG_PER_MS) % 360
}

/**
 * Intensity (any real number) → color string.
 *
 * Clamped to [0, 1] and bucketed by RIPPLE_COLOR_STOPS. Never returns transparent.
 * intensity=0 → darkest tier (#1a1f3a, used as the panel base color).
 *
 * @param hueShift degrees by which the whole color scale rotates around the hue wheel (0 = base colors).
 *                 Production code passes getHueShiftAtTime(time) to drift the primary color.
 *                 Test code passes 0 (default) for deterministic output.
 */
export function intensityToColor(intensity: number, hueShift = 0): string {
  const v = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity
  const idx = Math.min(
    RIPPLE_COLOR_STOPS.length - 1,
    Math.floor(v * RIPPLE_COLOR_STOPS.length),
  )
  const base = RIPPLE_COLOR_STOPS[idx]
  return hueShift === 0 ? base : rotateHue(base, hueShift)
}

/**
 * The 'transparent' literal. intensityToColor never returns it (kept as a compatibility export).
 * The render layer may use this constant for semantic checks (e.g. a cell is overlay text rather than ripple background).
 */
export const TRANSPARENT = 'transparent'

/**
 * Single-position cell: char + color.
 * - When color is 'transparent' the render layer applies no color (background stays the terminal default).
 * - Text overlay cells use a concrete color (suggestion / warning, etc.).
 */
export type Cell = {
  char: string
  color: string
}

/**
 * Render segment: adjacent cells with the same color are merged.
 * Reduces the number of React Text nodes (a row drops from 72 Text nodes to ~5-10).
 */
export type Segment = {
  text: string
  color: string
}

/**
 * Text overlay: covers the text string at x position on a given row.
 * - When color is undefined, the underlying ripple cell color is kept (only char is replaced)
 * - When color is given, both char + color are overwritten
 *
 * An overlay rendered later covers an earlier one at the same position (last-write-wins).
 */
export type Overlay = {
  text: string
  /** Start column; may be negative (prefix gets truncated) */
  x: number
  /** Overlay glyph color; undefined = keep the underlying ripple color */
  color?: string
}

/**
 * Ripple background character.
 * A space leaves the background empty and relies on color only (visually like "color blobs").
 * A space has stable width (always 1 column), unlike variable-width unicode characters.
 */
const RIPPLE_BG_CHAR = ' '

/**
 * Compute the full list of ripple cells for row y of the panel.
 *
 * Ripple math (v6.1 — smooth breathing + primary color rotating through the full hue wheel):
 *   dx = x - sourceX
 *   dy = (y - sourceY) *   dy = (y - sourceY) * 1.5    (visual stretch along y, since row height > glyph width)
 *   dist = sqrt(dx² + dy²)
 *   phase = dist * 0.35 - time *   phase = dist * 0.35 - time * 0.004   (speed slowed to 1/3 of the original)
 *   wave = (sin(phase) + 1) / 2          ([−1,1] → [0,1], smooth with no flat band)
 *   falloff = max(0, 1 - dist / 90)       (coverage radius extended to 90)
 *   intensity = wave * falloff
 *   hueShift = (time *   hueShift = (time * 0.03) % 360        (continuous rotation, one full wheel per 12s)
 *   color = intensityToColor(intensity, hueShift)
 *
 * v6.1 changes hueShift to continuous rotation (v6 was a sin±25° oscillation whose gamut was too narrow to
 * reach red/yellow). Now a full hue wheel is traversed every 12s: blue→purple→magenta→red→orange→yellow→green→cyan→blue.
 * The two time constants (phase 0.004 vs hue 0.03) are decoupled so "flow" and "color change" are out of sync.
 *
 * Each position's intensity goes through intensityToColor → color string (never transparent) and is written into the cell.
 *
 * @returns Cell array whose length is exactly width
 */
export function computeRippleCells(args: {
  y: number
  width: number
  time: number
  sourceX: number
  sourceY: number
}): Cell[] {
  const { y, width, time, sourceX, sourceY } = args
  if (width <= 0) return []

  const hueShift = getHueShiftAtTime(time)

  const cells: Cell[] = new Array(width)
  for (let x = 0; x < width; x++) {
    const dx = x - sourceX
    const dy = (y - sourceY) * 1.5
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Main ripple phase (speed slowed: 0.012 → 0.004, about 1/3 speed)
    const phase = dist * 0.35 - time * 0.004
    // Smooth breathing: [−1,1] → [0,1], no flat band, no double frequency
    const wave = (Math.sin(phase) + 1) / 2

    // Distance falloff (coverage radius extended to 90: was 40)
    const falloff = Math.max(0, 1 - dist / 90)
    const intensity = wave * falloff

    cells[x] = {
      char: RIPPLE_BG_CHAR,
      color: intensityToColor(intensity, hueShift),
    }
  }
  return cells
}

/**
 * Overlay the overlays text onto cells.
 *
 * Behavior:
 * - Text characters always win (replacing the underlying cell.char)
 * - When overlay.color is undefined, the underlying cell.color is kept (only char is replaced)
 * - When overlay.color is given, both char + color are overwritten
 * - Text beyond the right edge is truncated
 * - When x is negative, the first |x| characters are skipped
 *
 * Does not mutate the original array; returns a new one (defensive copy).
 */
export function applyOverlaysToCells(
  cells: Cell[],
  overlays: Overlay[],
): Cell[] {
  const out: Cell[] = cells.map(c => ({ ...c }))
  for (const overlay of overlays) {
    const start = overlay.x
    if (start >= out.length) continue
    for (let i = 0; i < overlay.text.length; i++) {
      const targetIdx = start + i
      if (targetIdx < 0) continue
      if (targetIdx >= out.length) break
      out[targetIdx] = {
        char: overlay.text[i],
        color: overlay.color ?? out[targetIdx].color,
      }
    }
  }
  return out
}

/**
 * Merge adjacent same-color cells into segments.
 *
 * Used to reduce render nodes: a row of 72 cells may have only 5-10 color change points,
 * so after merging only N Text segments are rendered instead of N single-character Text nodes.
 */
export function cellsToSegments(cells: Cell[]): Segment[] {
  if (cells.length === 0) return []
  const segments: Segment[] = []
  let current: Segment = { text: cells[0].char, color: cells[0].color }
  for (let i = 1; i < cells.length; i++) {
    const cell = cells[i]
    if (cell.color === current.color) {
      current.text += cell.char
    } else {
      segments.push(current)
      current = { text: cell.char, color: cell.color }
    }
  }
  segments.push(current)
  return segments
}

/**
 * Scale a hex color's luminance by a fade factor (0~1).
 *
 * Used for enter/exit animations:
 * - fade ≤ 0.01 → TRANSPARENT (cell renders no background, same as terminal default)
 * - fade = 0.5  → each RGB component halved (dark purple-blue)
 * - fade = 1    → original color (full ripple)
 *
 * Invalid hex (not #rrggbb format) is returned as-is (defensive).
 */
export function fadeColor(color: string, fade: number): string {
  if (color === TRANSPARENT) return TRANSPARENT
  const f = fade < 0 ? 0 : fade > 1 ? 1 : fade
  if (f <= 0.01) return TRANSPARENT
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  const fr = Math.round(r * f)
    .toString(16)
    .padStart(2, '0')
  const fg = Math.round(g * f)
    .toString(16)
    .padStart(2, '0')
  const fb = Math.round(b * f)
    .toString(16)
    .padStart(2, '0')
  return `#${fr}${fg}${fb}`
}

/**
 * Scale the colors of a whole row of cells by fade (for enter/exit animations).
 *
 * Does not mutate the original array; returns a new one.
 */
export function fadeCells(cells: Cell[], fade: number): Cell[] {
  return cells.map(c => ({ char: c.char, color: fadeColor(c.color, fade) }))
}
