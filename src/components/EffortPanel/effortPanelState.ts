import type { EffortValue } from '../../utils/effort.js'

/**
 * Cursor position on the panel. Used only inside the panel; never enters AppState / settings / API.
 * 'ultracode' is not an EffortLevel; in this panel it serves only as a visual placeholder and copy guidance.
 */
export type PanelPosition =
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultracode'

export const PANEL_POSITIONS: readonly PanelPosition[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultracode',
] as const

export const HOME_POSITION: PanelPosition = 'low'
export const END_POSITION: PanelPosition = 'ultracode'

/**
 * Decide whether a value can be used as a panel cursor position (excluding ultracode, since ultracode is produced only inside the panel).
 */
function isNonUltracodePosition(
  value: unknown,
): value is Exclude<PanelPosition, 'ultracode'> {
  return (
    typeof value === 'string' &&
    value !== 'ultracode' &&
    (PANEL_POSITIONS as readonly string[]).includes(value)
  )
}

/**
 * Normalize an EffortValue into a cursor position usable by the panel.
 * - null / undefined / number (ant-only) / ultracode → undefined (let the caller use displayed)
 * - valid string tier → return that tier
 */
function normalizeToPanelPosition(
  value: EffortValue | null | undefined,
): PanelPosition | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') return undefined
  if (isNonUltracodePosition(value)) {
    return value
  }
  return undefined
}

export function moveLeft(cursor: PanelPosition): PanelPosition {
  const idx = PANEL_POSITIONS.indexOf(cursor)
  if (idx <= 0) return PANEL_POSITIONS[0]
  return PANEL_POSITIONS[idx - 1]
}

export function moveRight(cursor: PanelPosition): PanelPosition {
  const idx = PANEL_POSITIONS.indexOf(cursor)
  if (idx === -1 || idx >= PANEL_POSITIONS.length - 1) {
    return PANEL_POSITIONS[PANEL_POSITIONS.length - 1]
  }
  return PANEL_POSITIONS[idx + 1]
}

export function isUltracode(cursor: PanelPosition): boolean {
  return cursor === 'ultracode'
}

/**
 * Decide the initial cursor position when the panel mounts.
 * Priority: env override (if a valid tier) > displayed level
 *
 * @param envOverride    return value of getEffortEnvOverride(): EffortValue | null | undefined
 * @param appStateEffort AppState.effortValue
 * @param displayed      getDisplayedEffortLevel(model, appStateEffort) — required, avoids depending on model here again
 */
export function getInitialCursor(args: {
  envOverride: EffortValue | null | undefined
  appStateEffort: EffortValue | undefined
  displayed: PanelPosition
}): PanelPosition {
  const fromEnv = normalizeToPanelPosition(args.envOverride)
  if (fromEnv !== undefined) return fromEnv
  // displayed is already an EffortLevel (excluding ultracode), so it is valid
  return args.displayed
}

// ---- Confirm/cancel decision (ApplyFn is injected to avoid a circular dependency and ease testing) ----

export type ConfirmOutcome =
  | {
      kind: 'apply'
      message: string
      effortUpdate?: { value: EffortValue | undefined }
    }
  | { kind: 'ultracode-hint'; message: string }

export type ApplyFn = (cursor: PanelPosition) => {
  message: string
  effortUpdate?: { value: EffortValue | undefined }
}

export const ULTRACODE_HINT =
  'ultracode is not an effort level. Use /ultracode <context> to start a multi-agent workflow.'

export const CANCEL_MESSAGE = 'Effort unchanged.'

export function computeConfirmOutcome(
  cursor: PanelPosition,
  applyFn: ApplyFn,
): ConfirmOutcome {
  if (isUltracode(cursor)) {
    return { kind: 'ultracode-hint', message: ULTRACODE_HINT }
  }
  const result = applyFn(cursor)
  return {
    kind: 'apply',
    message: result.message,
    effortUpdate: result.effortUpdate,
  }
}
