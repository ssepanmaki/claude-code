import { type DOMElement, useAnimationFrame } from '@anthropic/ink'

const RIPPLE_INTERVAL_MS = 60

/**
 * ultracode ripple animation hook.
 *
 * Design:
 * - Subscribes to the clock only when enabled=true (cursor === 'ultracode', or the exit fade-out has not finished),
 *   when passing null useAnimationFrame does not subscribe to ClockContext internally, so setInterval never fires.
 * - Returns [ref, time]: ref is attached to the ripple container (drives viewport-pause), and time
 *   is used by computeRippleLine to compute the ripple phase of each row.
 *
 * When enabled=false it returns time=0 (downstream simply does not render the ripple layer based on enabled,
 * but 0 is still a valid value, avoiding an unexpected NaN phase output).
 *
 * Note: callers should pass showingRipple (on ultracode || fade > 0), not rippleActive,
 * so the clock keeps advancing during the exit animation and the fade useEffect has ticks to fire on.
 */
export function useRippleFrame(
  enabled: boolean,
): [ref: (element: DOMElement | null) => void, time: number] {
  const [ref, time] = useAnimationFrame(enabled ? RIPPLE_INTERVAL_MS : null)
  return [ref, enabled ? time : 0]
}
