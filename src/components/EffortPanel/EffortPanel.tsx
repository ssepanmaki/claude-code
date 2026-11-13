import * as React from 'react';
import { BaseText, Box, Text, useTerminalSize } from '@anthropic/ink';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { type EffortValue, getDisplayedEffortLevel, getEffortEnvOverride } from '../../utils/effort.js';
import {
  type PanelPosition,
  CANCEL_MESSAGE,
  computeConfirmOutcome,
  getInitialCursor,
  moveLeft,
  moveRight,
  PANEL_POSITIONS,
} from './effortPanelState.js';
import { executeEffort } from '../../commands/effort/effort.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useSetAppState } from '../../state/AppState.js';
import { useRippleFrame } from './useRippleFrame.js';
import {
  TRANSPARENT,
  type Overlay,
  type Segment,
  applyOverlaysToCells,
  cellsToSegments,
  computeRippleCells,
  fadeCells,
  getHueShiftAtTime,
  rotateHue,
} from './rippleAnimation.js';

/**
 * Minimum width per tier (enough for the 9-character 'ultracode' plus centered padding).
 * Used when the terminal is narrow, guaranteeing minimum readability.
 */
const MIN_SEGMENT = 12;

const SUBLABEL_ULTRACODE = 'xhigh + workflows';

// Colors: aligned with the project theme (suggestion=Medium blue #5769F7).
const COLOR_LABEL_SELECTED = '#5769F7'; // selected tier (suggestion)
const COLOR_LABEL_DEFAULT = '#7a8eff'; // unselected tier (light purple-blue, matches the ripple background)
const COLOR_OVERLAY = '#5769F7'; // overlay text such as Faster / Smarter / ▲

// Fade step per frame: at 60ms intervals, 5 frames reach the target ≈ 300ms animation duration.
const FADE_STEP = 0.2;

// Ripple source y coordinate (in the ripple area's coordinate system; y=0 is the tier-name row).
const RIPPLE_SOURCE_Y = 0;

/**
 * Compute the actual width of each tier (SEGMENT) from the terminal width.
 *
 * Rules:
 * - Reserve 1 column on each side for paddingX={1} → available width = columns - 2
 * - If available width <= MIN_SEGMENT * 6 (72), use MIN_SEGMENT (keep the current narrow layout)
 * - Otherwise fill the width: floor(available width / 6)
 *
 * That is, "unchanged when narrow, fill when wide". The minimum width ensures the 9-character 'ultracode' displays properly.
 */
function computeSegment(terminalColumns: number): number {
  const available = terminalColumns - 2; // both sides of paddingX={1}
  const minNeeded = MIN_SEGMENT * PANEL_POSITIONS.length;
  if (available <= minNeeded) return MIN_SEGMENT;
  return Math.floor(available / PANEL_POSITIONS.length);
}

/**
 * Compute the ripple source x coordinate (center column of the 'ultracode' label inside the ultracode segment).
 *
 * 'ultracode' is 9 characters, centered within SEGMENT columns:
 *   offset = floor((SEGMENT - 9) / 2)
 *   labelCenter = SEGMENT *   labelCenter = SEGMENT * 5 + offset + 4  (4 is the center offset of the 9-character string)
 *
 * SEGMENT=12 → 60 + 1 + 4 = 65 (consistent with the historical value)
 * SEGMENT=20 → 100 + 5 + 4 = 109
 */
function computeRippleSourceX(segment: number): number {
  const LABEL_LEN = 9; // 'ultracode'
  const offset = Math.max(0, Math.floor((segment - LABEL_LEN) / 2));
  const labelCenter = Math.floor(LABEL_LEN / 2); // 4
  return segment * (PANEL_POSITIONS.length - 1) + offset + labelCenter;
}

/**
 * Compute the start column of centered text inside segment idx.
 * Dynamic segment: textLen characters are centered within segment columns.
 */
function segmentTextStartX(idx: number, textLen: number, segment: number): number {
  return segment * idx + Math.max(0, Math.floor((segment - textLen) / 2));
}

type Props = {
  appStateEffort: EffortValue | undefined;
  onDone: (message: string) => void;
};

export function EffortPanel({ appStateEffort, onDone }: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const model = useMainLoopModel();
  const { columns } = useTerminalSize();

  // Adaptive width: compute each tier's width from the terminal column count.
  // When the terminal resizes, columns changes → recompute → re-render.
  const segment = React.useMemo(() => computeSegment(columns), [columns]);
  const panelWidth = segment * PANEL_POSITIONS.length;
  const rippleSourceX = React.useMemo(() => computeRippleSourceX(segment), [segment]);

  const envOverride = getEffortEnvOverride();
  const displayed = getDisplayedEffortLevel(model, appStateEffort);
  const initialCursor = getInitialCursor({ envOverride, appStateEffort, displayed });

  const [cursor, setCursor] = React.useState<PanelPosition>(initialCursor);
  const [done, setDone] = React.useState(false);

  const isOnUltracode = cursor === 'ultracode';
  const [fade, setFade] = React.useState(0);
  // Still in ripple mode: cursor is on ultracode, or the exit animation has not finished (fade > 0)
  const showingRipple = isOnUltracode || fade > 0.001;
  const [rippleRef, time] = useRippleFrame(showingRipple);

  // Fade driver: on each tick (time advances), step toward the target by FADE_STEP.
  // After the exit animation completes fade returns to zero, showingRipple becomes false, and the clock stops subscribing.
  React.useEffect(() => {
    if (!showingRipple) return;
    const target = isOnUltracode ? 1 : 0;
    setFade(prev => {
      if (prev === target) return prev;
      const next = target > prev ? prev + FADE_STEP : prev - FADE_STEP;
      return target > prev ? Math.min(target, next) : Math.max(target, next);
    });
  }, [time, isOnUltracode, showingRipple]);

  const handleConfirm = React.useCallback(() => {
    if (done) return;
    setDone(true);
    const outcome = computeConfirmOutcome(cursor, executeEffort);
    if (outcome.kind === 'apply' && outcome.effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: outcome.effortUpdate!.value,
      }));
    }
    onDone(outcome.message);
  }, [cursor, done, onDone, setAppState]);

  const handleCancel = React.useCallback(() => {
    if (done) return;
    setDone(true);
    onDone(CANCEL_MESSAGE);
  }, [done, onDone]);

  useKeybindings(
    {
      'effortPanel:decrease': () => setCursor(c => moveLeft(c)),
      'effortPanel:increase': () => setCursor(c => moveRight(c)),
      'effortPanel:home': () => setCursor('low'),
      'effortPanel:end': () => setCursor('ultracode'),
      'effortPanel:confirm': handleConfirm,
      'effortPanel:cancel': handleCancel,
    },
    { context: 'EffortPanel' },
  );

  const envActive = envOverride !== null && envOverride !== undefined;
  const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;

  // Ripple row cell computation: returns all cells of the row (including overlay text)
  // fade controls background color brightness (0 → fully transparent, 1 → full ripple).
  // Text overlays are also multiplied by fade, so the enter/exit animation fades in/out as a whole.
  const renderRippleRow = React.useCallback(
    (relY: number, overlays: Overlay[]): Segment[] => {
      const cells = computeRippleCells({
        y: relY + RIPPLE_SOURCE_Y,
        width: panelWidth,
        time,
        sourceX: rippleSourceX,
        sourceY: RIPPLE_SOURCE_Y,
      });
      const overlayed = applyOverlaysToCells(cells, overlays);
      const faded = fadeCells(overlayed, fade);
      return cellsToSegments(faded);
    },
    [time, fade, panelWidth, rippleSourceX],
  );

  return (
    <Box ref={rippleRef} flexDirection="column" paddingX={1} width={panelWidth + 2}>
      <Text bold color="suggestion">
        Effort
      </Text>
      {envActive && <Text color="warning">{`⚠ CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session`}</Text>}
      {showingRipple ? (
        <RippleContent
          renderRow={renderRippleRow}
          cursor={cursor}
          fade={fade}
          segment={segment}
          panelWidth={panelWidth}
          time={time}
        />
      ) : (
        <>
          <PlainContent cursor={cursor} segment={segment} panelWidth={panelWidth} />
          <Box marginTop={1}>
            <Text color="subtle">←/→ adjust · Enter confirm · Esc cancel</Text>
          </Box>
        </>
      )}
    </Box>
  );
}

// ---- Normal mode (no ripple) ----

function PlainContent({
  cursor,
  segment,
  panelWidth,
}: {
  cursor: PanelPosition;
  segment: number;
  panelWidth: number;
}): React.ReactNode {
  return (
    <>
      <Box marginTop={1} flexDirection="row" justifyContent="space-between">
        <Text color="suggestion">Faster</Text>
        <Text color="suggestion">Smarter</Text>
      </Box>
      <Text color="subtle">{'─'.repeat(panelWidth)}</Text>
      <Box flexDirection="row">
        {PANEL_POSITIONS.map(p => (
          <Box key={`cursor-${p}`} width={segment} justifyContent="center">
            <Text bold color={cursor === p ? 'suggestion' : 'subtle'}>
              {cursor === p ? '▲' : ' '}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row">
        {PANEL_POSITIONS.map(p => (
          <Box key={`label-${p}`} width={segment} justifyContent="center">
            <Text bold={cursor === p} color={cursor === p ? 'suggestion' : 'subtle'}>
              {p}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row">
        <Box width={segment * (PANEL_POSITIONS.length - 1)} />
        <Box width={segment} justifyContent="center">
          <Text color="subtle">{SUBLABEL_ULTRACODE}</Text>
        </Box>
      </Box>
    </>
  );
}

// ---- Ripple mode (cursor === 'ultracode') ----
//
// Rendering strategy:
// - For each row, computeRippleCells first produces the intensity→color cell array (background is spaces + color)
// - applyOverlaysToCells writes text overlays (Faster/▲/tier name/sublabel) into the matching cells
// - cellsToSegments merges adjacent same-color segments
// - The render layer walks segments: each segment is judged to be a "space ripple segment" or a "text segment"
//   - Space segment: uses backgroundColor to paint the spaces into a color block (pure color block)
//   - Text segment: uses color to paint the text (background stays terminal default, keeping the text clearest)
//   - Mixed segment (both spaces and text, uncommon): split into two Text parts, before and after
//
// Note: a Segment may contain both spaces and non-space characters (e.g. centered text "  Faster  ").
// When such a segment is rendered with color, the space part shows no color block — visually the "color block breaks".
// Fix: split each segment a second time by character type at render time (runs of whitespace vs non-whitespace).

type RippleContentProps = {
  renderRow: (relY: number, overlays: Overlay[]) => Segment[];
  cursor: PanelPosition;
  fade: number;
  segment: number;
  panelWidth: number;
  time: number;
};

function RippleContent({ renderRow, cursor, segment, panelWidth, time }: RippleContentProps): React.ReactNode {
  // Cursor index follows the cursor (during the exit animation the cursor has already moved elsewhere,
  // so the ▲ overlay moves away with it and the ultracode segment returns to the normal background color).
  const cursorIdx = PANEL_POSITIONS.indexOf(cursor);
  // The sublabel is fixed beneath the ultracode segment and does not follow the cursor.
  const ultracodeIdx = PANEL_POSITIONS.length - 1;

  // Text colors follow the wave hue rotation: take the hueShift at the current time
  // and apply it to all overlay colors, keeping the text in sync with the background color wheel.
  const hueShift = getHueShiftAtTime(time);
  const overlayColor = rotateHue(COLOR_OVERLAY, hueShift);
  const labelSelectedColor = rotateHue(COLOR_LABEL_SELECTED, hueShift);
  const labelDefaultColor = rotateHue(COLOR_LABEL_DEFAULT, hueShift);

  const fasterOverlay: Overlay = { text: 'Faster', x: 0, color: overlayColor };
  const smarterOverlay: Overlay = {
    text: 'Smarter',
    x: panelWidth - 'Smarter'.length,
    color: overlayColor,
  };
  const separatorOverlay: Overlay = {
    text: '─'.repeat(panelWidth),
    x: 0,
    color: labelDefaultColor,
  };
  const cursorOverlay: Overlay = {
    text: '▲',
    x: segmentTextStartX(cursorIdx, 1, segment),
    color: overlayColor,
  };
  const labelOverlays: Overlay[] = PANEL_POSITIONS.map((p, idx) => ({
    text: p,
    x: segmentTextStartX(idx, p.length, segment),
    color: p === cursor ? labelSelectedColor : labelDefaultColor,
  }));
  const sublabelOverlay: Overlay = {
    text: SUBLABEL_ULTRACODE,
    x: segmentTextStartX(ultracodeIdx, SUBLABEL_ULTRACODE.length, segment),
    color: labelDefaultColor,
  };

  // Row y coordinates (relative to the source RIPPLE_SOURCE_Y = tier-name row)
  //   y=-4: top pure ripple row (visually consistent, no overlay)
  //   y=-3: Faster/Smarter
  //   y=-2: divider line
  //   y=-1: ▲
  //   y=0:  tier names (source)
  //   y=1:  sublabel
  //   y=2:  bottom pure ripple row (visually consistent, no overlay)
  //
  // Shortcut-key row: plain Text, does not take part in ripple rendering (no background animation), sits right under the bottom ripple row.
  return (
    <>
      <RippleRow segments={renderRow(-4, [])} />
      <RippleRow segments={renderRow(-3, [fasterOverlay, smarterOverlay])} />
      <RippleRow segments={renderRow(-2, [separatorOverlay])} />
      <RippleRow segments={renderRow(-1, [cursorOverlay])} />
      <RippleRow segments={renderRow(0, labelOverlays)} />
      <RippleRow segments={renderRow(1, [sublabelOverlay])} />
      <RippleRow segments={renderRow(2, [])} />
      <Text color={COLOR_LABEL_DEFAULT}>←/→ adjust · Enter confirm · Esc cancel</Text>
    </>
  );
}

/**
 * Render one row of ripple segments.
 *
 * Each segment may mix spaces + text (e.g. "  Faster  "):
 * - Space parts use backgroundColor to paint color blocks (ripple color)
 * - Text parts use color to paint (bright color, background stays terminal default)
 *
 * Simplified strategy: walk segment characters and split them a second time into tokens by "is it a space".
 * Adjacent tokens of the same type merge, avoiding a React key explosion.
 */
function RippleRow({ segments }: { segments: Segment[] }): React.ReactNode {
  const tokens: Array<{ text: string; kind: 'space' | 'text'; color: string }> = [];
  for (const seg of segments) {
    // Split seg.text into space segments and non-space segments
    let buf = '';
    let bufIsSpace: boolean | null = null;
    const flush = (): void => {
      if (buf === '' || bufIsSpace === null) return;
      tokens.push({
        text: buf,
        kind: bufIsSpace ? 'space' : 'text',
        color: seg.color,
      });
      buf = '';
      bufIsSpace = null;
    };
    for (const ch of seg.text) {
      const isSpace = ch === ' ';
      if (bufIsSpace === null) {
        buf = ch;
        bufIsSpace = isSpace;
      } else if (isSpace === bufIsSpace) {
        buf += ch;
      } else {
        flush();
        buf = ch;
        bufIsSpace = isSpace;
      }
    }
    flush();
  }

  return (
    <Box flexDirection="row">
      {tokens.map((tok, i) =>
        tok.kind === 'space' ? (
          tok.color === TRANSPARENT ? (
            <BaseText key={i}>{tok.text}</BaseText>
          ) : (
            <BaseText key={i} backgroundColor={tok.color as `#${string}`}>
              {tok.text}
            </BaseText>
          )
        ) : (
          <Text key={i} color={tok.color as `#${string}`} bold>
            {tok.text}
          </Text>
        ),
      )}
    </Box>
  );
}
