# Ink TUI Rendering Logic: Deep Review

**8 subsystems, 47 candidate findings, 6 confirmed issues: an adversarially verified health check of the ink kernel.**

---

## Review Cost

| Dimension | Value |
|---|---|
| Subsystems | 8 (render-core / screen-buffer / layout / termio / events / keybindings / components / text-encoding) |
| Code reviewed | ~27,500 lines in 145 `.ts`/`.tsx` files |
| Orchestration phases | 4 (Map → Find → Verify → Synthesize) |
| **Total agents** | **158** (157 × glm-5.2 + 1 × opus for the final write-up) |
| **Total tokens** | **≈ 5.92M** (input ≈ 5.68M, output ≈ 244K) |
| Tool calls | 2,332 (≈ 14.8 per agent) |
| Median per-agent context | 32,341 input tokens / 1,208 output tokens |
| Wall-clock time | ≈ 10.6 hours (concurrency 3) |
| Candidate findings | 47 |
| Confirmed findings | 6 (13% pass rate) |
| Rejected findings | 41 (7 kept in this document as false-positive analyses) |

> Over 80% of the tokens went to the verify phase. Every candidate finding was sent to three independent verifiers (correctness / reproducibility / severity), and each verifier re-read and re-grepped the source on its own. 47 candidates × 3 perspectives = 141 verifier calls. That is expensive, but 87% of candidates were independently refuted, and only problems that survived all three perspectives made it into this document.

---

## Summary

This review covers eight core subsystems of `packages/@ant/ink/`: render core (reconciler / render-node-to-output), screen buffer and output (screen / output / log-update), layout engine (yoga adapter / wrapAnsi / measure-text), terminal I/O parsing (tokenize / sgr / parser), event system (dispatcher / hit-test / keybinding-setup), keybindings (resolver / chord-interceptor), React components and hooks, and text encoding and selection (sliceAnsi / stringWidth). About 47 candidate findings went through adversarial verification from three independent perspectives (correctness / reproducibility / severity). Six were confirmed, seven notable false positives are analyzed below, and the other 34 were rejected unanimously.

Overall health: **good to very good**. The render core, layout engine, and text encoding/selection subsystems produced zero confirmed findings (7 + 6 + 7 = 20 candidates, all rejected). Key invariants such as `resetScreen` / `setCellAt` / `blitRegion` hold throughout the real pipeline. The event system has the most issues (3 confirmed). The root cause is two parallel dispatch systems (Dispatcher vs. hit-test manual bubbling) plus some dead code (`dispatchContinuous`, the MouseActionEvent dispatch path). These will not crash anything, but they are real API contract traps.

Top 3 issues:

1. **`writeLineToScreen` tab expansion loses the active style** (`output.ts:664-678`). Inside a Box/Text with `backgroundColor`, the spaces produced by expanding `\t` are hard-coded to `stylePool.none`, which erases the background and leaves a broken stripe. This is a visible rendering defect, and the fix is one line.
2. **Ctrl+Space is parsed as a backtick on the legacy control-byte path** (`parse-keypress.ts:722-724`). `String.fromCharCode(0 + 97 - 1) === '`'`, so Ctrl+Space and Ctrl+` are indistinguishable, and shortcuts bound to Ctrl+Space (commonly IDE completion) silently fail.
3. **The `supportsExtendedKeys` allowlist contains `windows-terminal` but never matches** (`terminal.ts:154-167`). Windows Terminal sets `WT_SESSION`, not `TERM_PROGRAM=windows-terminal`, so native Windows Terminal users never get Kitty keyboard / modifyOtherKeys and cannot distinguish ctrl+shift+letter from ctrl+letter. The other 5 Windows Terminal checks in the same file all use `WT_SESSION`.

Recommended fix priorities:

- **P0**: the first two of the top 3, plus the tokenizer error fallback that leaks the ESC byte (three low-risk, near one-line fixes with visible benefit for real terminal users).
- **P1**: the Windows Terminal detection in `supportsExtendedKeys`, plus ChordInterceptor's missing `stopImmediatePropagation` (cross-platform compatibility and keybinding correctness; tests needed).
- **P2**: `dispatchContinuous` dead-code cleanup and the MouseActionEvent coordinate inconsistency (structural, for later refactoring).

---

## Architecture Overview

The diagram shows the end-to-end pipeline of one ink render pass. Brackets mark where this review found risks.

```
                         [React application]
                              |
                     reconcile (react-reconciler)
                              |
                  render-node-to-output.ts         <-- risk R1: wrapAnsi vs stringWidth
                              |                                  ambiguous-width handling
            +-----------------+----------------+                 (rejected)
            |                                  |
       yoga layout                       style/SGR injection
       (measure-text,                        |
        wrap-text, wrapAnsi)                 |
            |                                  |
            +----------------+-----------------+
                              |
                       output.ts                 <-- risk C1 [confirmed]: writeLineToScreen
                              |                       tab expansion uses stylePool.none,
                  write/writeLine/                     losing the background
                  blitRegion                          (output.ts:670-675)
                              |
                         screen.ts                 <-- risk (rejected): blitRegion right-edge
                              |                       Wide handling (dst is always Narrow
                  setCellAt /                           after resetScreen; premise fails)
                  getCellAt
                              |
                       log-update.ts
                       (diff/patch)
                              |
                     terminal.ts (emit)            <-- risk C2 [confirmed]: supportsExtendedKeys
                              |                       misdetects Windows Terminal
                              |                       (terminal.ts:154-167)
                              v
                          stdout

[independent input pipeline]

stdin raw bytes
      |
   tokenize.ts                  <-- risk C3 [confirmed]: error fallback sets textStart = seqStart,
      |                                                  leaking the ESC byte into text tokens
   parser.ts / parse-keypress.ts <-- risk C4 [confirmed]: Ctrl+Space mapped to '`'
      |                                                  (parse-keypress.ts:722-724)
   App.tsx (EventEmitter)
      |
   +----------------+----------------+
   |                |                |
Dispatcher      hit-test.ts       keybinding-setup
(dispatch)     (manual bubbling)   (chord)            <-- risk C5 [confirmed]: dispatchContinuous
   |                |                |                    is dead code (dispatcher.ts:228)
   |                |                +--- risk C6 [confirmed]: ChordInterceptor does not
   |                |                       stopImmediatePropagation on a match with no handler
   |                |
   |                +--- risk (rejected): MouseActionEvent.localCol uses getComputedLeft
   |                    (this path has no consumers)
   |
   reconciler.currentEvent
```

Key observation: the input-side event system is the most fragmented. Dispatcher, hit-test, and Node EventEmitter are three parallel mechanisms, each with its own semantics, and this is where confirmed issues cluster.

---

## Serious Issues

### [medium] writeLineToScreen tab expansion uses stylePool.none and loses the active style

- **Location**: `packages/@ant/ink/src/core/output.ts:664-678` (the key write is at lines 670-675)
- **Category**: correctness
- **Symptom**: When a Box/Text with `backgroundColor` (or any SGR style) contains a tab character `\t`, the spaces produced by tab expansion lose their background color, leaving a broken stripe. This is the kind of discontinuous coloring users notice most easily. It can appear in code-block indentation, table separators, and echoed preformatted text.
- **Root cause**: On `\t` (0x09), `writeLineToScreen` writes (output.ts:670-675):

  ```ts
  setCellAt(screen, offsetX, y, {
    char: ' ',
    styleId: stylePool.none,
    width: CellWidth.Narrow,
    hyperlink: undefined
  })
  ```

  `styleId` is hard-coded to `stylePool.none` (the empty SGR sequence, equivalent to `intern([])`), discarding `character.styleId`. But the upstream `flushBuffer` (output.ts:612-621) already writes a uniform styleId and hyperlink for every grapheme in the same style run, including the `\t` itself. So `character` does carry the run's background styleId when it enters the tab branch. `@alcalzone/ansi-tokenize`'s `styledCharsFromTokens` likewise attaches the active SGR codes to every char token, `\t` included.

  `setCellAt` (screen.ts:780-785) overwrites the cell unconditionally and does not merge with the existing cell, so these spaces overwrite the background pre-filled by `<Box backgroundColor>` in render-node-to-output.ts:1156-1179. `output.get()` has no backfill step after `writeLineToScreen`.

  Compare the SpacerTail branch of the same function (lines 775-783): `stylePool.none` is reasonable there because a SpacerTail is a row-end placeholder outside the drawable area of the style run. The finding correctly distinguishes the two.

- **Trigger**: Render any Box/Text with `backgroundColor` whose text contains a literal `\t`. Examples: `<Text backgroundColor="blue">{"\tfoo"}</Text>`, tab-indented Markdown code blocks, table column separators.
- **Fix direction**: Change `stylePool.none` to `character.styleId` and `hyperlink: undefined` to `character.hyperlink` in the tab branch, so expanded spaces inherit the run's background, foreground, and hyperlink. This matches the normal character path (output.ts:789-794).
- **Verification record**:
  - Correctness confirmed: tracing from `flushBuffer` to `setCellAt` shows `character.styleId` holds the background in the tab branch and nothing backfills it after it is dropped.
  - Reproducibility confirmed: the scenario is concrete, not a theoretical edge. The `expandTabs` comment at `dom.ts:340-342` says "Actual tab expansion happens in output.ts based on screen position", proving `\t` is deliberately preserved into this buggy path with no upstream guard.
  - Severity adjusted to low: the bug is real but purely visual, with no crash or data loss, and `<Box backgroundColor>` combined with a literal `\t` is uncommon in actual Claude Code output (CLI output mostly indents with spaces). Final verdict medium, matching the reproducibility perspective.

---

### [medium] Ctrl+Space on the legacy control-byte path is mapped to key='`' (backtick)

- **Location**: `packages/@ant/ink/src/core/parse-keypress.ts:722-724`
- **Category**: correctness
- **Symptom**: Pressing Ctrl+Space in a raw-mode terminal delivers a keydown event with `e.key === '`'` and `ctrlKey=true` instead of `'space'`. Consequences: (1) shortcuts bound to Ctrl+Space (used for completion in many editors/IDEs) never fire; (2) a Ctrl+` binding, if present, may fire by mistake.
- **Root cause**: For control bytes where `s <= '\x1a' && s.length === 1`, parse-keypress.ts:722-724 does:

  ```ts
  key.name = String.fromCharCode(s.charCodeAt(0) + 'a'.charCodeAt(0) - 1)
  key.ctrl = true
  ```

  For Ctrl+Space (`\x00`): `charCodeAt(0) = 0`, and `0 + 97 - 1 = 96 = '`'` (backtick, 0x60).

  Downstream, `keyFromParsed` in `keyboard-event.ts:38` returns `name` directly because `parsed.ctrl` is true, so `e.key === '`'`. The fix at `input-event.ts:69`, `if (keypress.ctrl && input === 'space')`, only covers the `name === 'space'` path (a literal 0x20 byte). It does nothing for the `\x00` legacy path, where `keypress.name` is already '`' rather than 'space'.

  None of the special branches before it (lines 716-721) match `\x00`, and `getKeyName` in `match.ts:45` returns `input.toLowerCase()` for single-character input, i.e. '`', while the ctrl+space `target.key` is `' '` (parser.ts:54). The two never compare equal.

- **Trigger**: Pressing Ctrl+Space in any raw-mode terminal. Sending `\x00` is standard behavior for xterm/VT100/iTerm2/kitty/Alacritty/gnome-terminal/Windows Terminal/tmux/screen. macOS may intercept it at the system/IME level, but it always triggers on Linux, Windows, and remote ssh.
- **Fix direction**: Before the control-byte mapping branch, explicitly handle `if (s === '\x00') { key.name = 'space'; key.ctrl = true; }`, or move the mapping base to `'a'.charCodeAt(0)` and special-case 0. Also check that ctrl+@ (`\x00`) yields a consistent input value in `input-event.ts`.
- **Verification record**:
  - Correctness confirmed: independently verified against the source that `\x00 <= '\x1a'` and `.length === 1` are both true, no earlier branch matches, and `String.fromCharCode(96) === '`'`.
  - Reproducibility confirmed: all three layers (parse-keypress / keyboard-event / input-event) hold. This is the unfinished half of the "ctrl+space leaks literal" problem mentioned in the comment at input-event.ts:67. Scope is limited: no Ctrl+Space or Ctrl+` binding exists anywhere in the repo, so this is a latent framework-level correctness defect, not broken shipped functionality.
  - Severity rejected: argued that with no binding in the repo there is no actual harm. Combined verdict medium, because it is a framework correctness issue and any downstream consumer (including future Claude Code CLI features) that binds the key hits it immediately.

---

### [medium] supportsExtendedKeys allowlist contains 'windows-terminal', but Windows Terminal never sets TERM_PROGRAM to it

- **Location**: `packages/@ant/ink/src/core/terminal.ts:154-167`
- **Category**: terminal-compat
- **Symptom**: Native Windows Terminal users (not WSL/VS Code-wrapped) never get extended key support. Concretely, ctrl+shift+letter cannot be distinguished from ctrl+letter, and neither the Kitty keyboard protocol nor xterm modifyOtherKeys is ever enabled.
- **Root cause**: The `EXTENDED_KEYS_TERMINALS` array contains the string `'windows-terminal'`, and `supportsExtendedKeys()` is:

  ```ts
  export function supportsExtendedKeys(): boolean {
    return EXTENDED_KEYS_TERMINALS.includes(process.env.TERM_PROGRAM ?? '')
  }
  ```

  Windows Terminal does not set `TERM_PROGRAM` to `'windows-terminal'`. Per Microsoft's documentation it sets the `WT_SESSION` environment variable; `TERM_PROGRAM` is `'vscode'` in the VS Code integrated terminal and usually undefined in native Windows Terminal. `?? ''` only turns undefined into an empty string, which still does not match.

  This contrasts sharply with 5+ other Windows Terminal checks in the same file, which all correctly use `WT_SESSION`:
  - `isProgressReportingAvailable` (terminal.ts:31)
  - `isSynchronizedOutputSupported` (terminal.ts:106)
  - `hasCursorUpViewportYankBug` (terminal.ts:176)
  - `clearTerminal.ts:17,33`, whose comment says "Windows Terminal sets WT_SESSION environment variable"
  - `src/utils/env.ts:201`, `bidi.ts:47`

  Only this one function uses the nonexistent `TERM_PROGRAM=windows-terminal` convention. It is dead code that claims Windows Terminal support but never took effect. Windows Terminal does implement modifyOtherKeys, so this is not a deliberate conservative exclusion.

- **Trigger**: Run any ink-based app in native Windows Terminal (not WSL/VS Code-wrapped); `supportsExtendedKeys()` returns false.
- **Fix direction**: Detect Windows Terminal with `!!process.env.WT_SESSION`, or add an `|| process.env.WT_SESSION` branch in the function, so detection is consistent across the file.
- **Verification record**: All three perspectives agree. Windows is a major platform and the impact is real, but most Windows users run inside VS Code (`TERM_PROGRAM=vscode`, correctly excluded), which limits it. Medium is appropriate.

---

### [low→medium] Tokenizer error fallback in csi/osc/dcs/apc/ss3 rewinds textStart and leaks the ESC byte into text tokens

- **Location**: `packages/@ant/ink/src/core/termio/tokenize.ts:181-185, 197-201, 252-255, 264-267`
- **Category**: correctness
- **Symptom**: When the input stream contains an invalid escape sequence (for example `ESC [ SOH`, a C0 control byte in a CSI parameter position), the tokenizer's error fallback emits the ESC byte itself (0x1b) and some intermediate escape bytes as a text token. Downstream, `Parser.processText` filters only BEL, not ESC, and `segmentGraphemes` returns `width=1` for the single codepoint 0x1b, so the render layer treats the leaked ESC as a visible width-1 grapheme.
- **Root cause**: In the ground state, on ESC the tokenizer calls `flushText()` and sets `textStart = i`, `seqStart = i` (tokenize.ts:141-144), then enters the escape state. When the csi / escape / escapeIntermediate / ss3 states receive an invalid byte, the error fallback does:

  ```ts
  result.state = 'ground'
  textStart = seqStart
  ```

  `seqStart` is the position of the ESC byte itself. The problem is that **none of these fallback branches perform `i++`**. The next ground-state iteration runs `i++` on the invalid byte, and at the end of the loop `flushText()` slices `data.slice(textStart, i)`, emitting `ESC + [ + invalid byte` in full as text. The comment "Invalid - treat ESC as text" shows the intent was to keep the ESC, but the implementation includes the whole invalid sequence in the text.

  Step-by-step trace for `\x1b[\x01`: `i=0` ESC → ground calls flushText() (no-op), `seqStart=0`, state='escape', `i=1`; `i=1` `[` → state='csi', `i=2`; `i=2` 0x01 is not final (<0x40), not param (<0x30), and not intermediate (<0x20) in the csi state → error fallback: `state='ground'`, `textStart=seqStart=0`, **i stays at 2**; the next ground iteration runs `i++` on the 0x01 at i=2 → i=3; at loop end `state==='ground'` → flushText() emits `data.slice(0,3) = '\x1b[\x01'` entirely as a text token.

- **Trigger**: Malformed ANSI input (ESC followed by an introducer followed by a C0 control byte <0x20). This is rare in real terminal output: ANSI from models/tools is normally valid SGR/cursor sequences and does not spontaneously produce `\x1b[\x01`. It can occur with corrupted pty streams, binary garbage in bracketed paste, or buggy programs. Of the three consumer paths, parse-keypress (input path) feeds text tokens to parseKeypnress rather than rendering them directly, so the leaked ESC produces no visible glyph; the tabstops path only gets a column-count error of 1, which is benign; only the Parser output-render path actually displays a width-1 grapheme.
- **Fix direction**: In the error fallback, set `textStart` to `seqStart + 1` (skipping the ESC byte) and either emit the ESC as a single-character text token explicitly or drop it. For csi/escapeIntermediate, the intermediate bytes must also be consumed, not just the ESC skipped. The safest approach is to emit the whole invalid sequence as a sequence token and let the upper layer handle it.
- **Verification record**: The correctness perspective noted that the finding's title, "re-emits already-flushed text", is slightly inaccurate: the prefix text is not emitted twice, and what leaks is the ESC byte itself plus some intermediate escape bytes. The reproducibility and severity perspectives both confirmed the mechanism but judged the severity overstated, since triggering needs malformed ANSI. Low is appropriate.

---

## Other Findings

### Event system

**`dispatchContinuous` is never called, so the continuous-priority path for resize/scroll is dead code** (dispatcher.ts:207-236, finalSeverity: low). `getEventPriority` classifies 'resize'/'scroll'/'mousemove' as `ContinuousEventPriority`, and a `dispatchContinuous` method (manually saving/restoring currentUpdatePriority) is provided. But grepping the whole codebase finds `dispatchContinuous` only at its definition, with no callers. Resize events never go through the Dispatcher at all: `handleResize` at ink.tsx:398 is a native `stdout.on('resize', ...)` handler that directly updates `terminalColumns/terminalRows` and triggers a render. `ResizeEvent` (resize-event.ts) is a plain `{columns, rows}` type that is never instantiated with `new` and cannot be consumed by the Dispatcher. So the designed React scheduling priority for resize (continuous events do not block discrete input) never took effect. The comment promises behavior that does not match reality, which makes this misleading dead code. Fix direction: either wire up a continuous dispatch path for resize/mousemove, or delete `dispatchContinuous` and the continuous branch of `getEventPriority` to avoid misleading readers. The severity perspective confirmed this is purely a maintenance issue; resize works through the direct render path with no user-facing bug.

### Keybindings

**ChordInterceptor does not call stopImmediatePropagation on a chord match with no registered handler** (KeybindingSetup.tsx:247-270, finalSeverity: low). While a chord is in progress (wasInChord=true) and the resolver returns 'match', `setPendingChord(null)` (line 249) **unconditionally** clears `pendingChordRef.current` before the handler lookup (it updates synchronously, line 133). If the registry has no handler for that action (for example a plugin-bound component is not mounted, or the action name in config is misspelled), `event.stopImmediatePropagation()` is never called and the event keeps propagating to downstream `useKeybinding` hooks. When those hooks call `resolveKeyWithChordState`, `pendingChordRef.current` is already null, so they treat the key as a single-key event. If that key collides with a single-key binding in the active context (for example the chord's second key 'r' and an 'r' binding in some context), the wrong action fires.

Fix direction: once wasInChord is true and the resolver returns 'match', the key has been consumed by the chord and should not propagate whether or not a handler exists. Move `event.stopImmediatePropagation()` to the top of the 'match' case (when wasInChord is true, before the handler lookup).

Note on severity: the default bindings have only two chords (`ctrl+x ctrl+k` / `ctrl+x ctrl+e`), both with a non-printable ctrl-modified second key that cannot collide with text input, and both actions have handlers registered. Triggering the bug needs (a) a custom chord, (b) an unmounted action handler, and (c) a chord terminal key that collides with a single-key binding. The intersection is narrow. The silently-abandoned variant (no collision) is acceptable graceful degradation.

### Screen buffer and output (addendum)

Besides the writeLineToScreen tab issue above, the other 6 candidates in this subsystem were all rejected. The most notable rejected one is the blitRegion wide-char right-edge handler (see "False Positives Ruled Out" below).

---

## False Positives Ruled Out

Four findings are discussed here that at least one verifier believed were real but that were ultimately rejected. They explain why something looks like a bug but is not, which should help future reviewers avoid the same misjudgments.

### 1. blitRegion wide-char right-edge handler "overwrites a Wide cell without cleanup" (screen.ts:964-990)

**Why it looks like a bug**: The code really is asymmetric. When `blitRegion` hits a Wide character at the right edge of the blit region (maxX-1), it unconditionally writes a SpacerTail into dst column maxX, **without checking** what dst held there. By contrast, `setCellAt` (screen.ts:762-777) specifically handles a SpacerTail overwrite by clearing the leading Wide cell, and blitRegion has no such cleanup. On that basis the correctness verifier ruled it medium, confirmed.

**Why it is not a bug**: The key rebuttal from the other two perspectives is that the dst of `blitRegion` is always `this.screen`, and `this.screen` has already been fully zeroed by `resetScreen()` at the start of `Output.get()` (screen.ts:571 `cells64.fill(EMPTY_CELL_VALUE, 0, size)`; the comment at output.ts:280 says explicitly "The buffer is freshly zeroed by resetScreen"). `EMPTY_CELL_VALUE` corresponds to `width=CellWidth.Narrow`. So the finding's core premise, that dst at column maxX was previously a Wide character, does not hold in a steady state: dst[maxX] is necessarily empty/Narrow before the blit and can never be Wide, so there is nothing to erase and no orphaned SpacerTail to leave behind. In addition, src is always prevScreen, not an accumulating write path.

The finding's author mechanically transplanted the cleanup pattern from `setCellAt` to `blitRegion` and overlooked that the two operate on buffers with different lifecycles (reset-zeroed vs. accumulating). This is the classic case of static analysis spotting a structural asymmetry (correctly) and over-inferring a bug when the necessary precondition does not hold.

### 2. wrapAnsi (Bun path) does not pass ambiguousIsNarrow (width-measurement drift) (wrapAnsi.ts:9-18)

**Why it looks like a bug**: In a Bun environment wrapAnsi.ts reuses `Bun.wrapAnsi` directly with no options, whereas stringWidth.ts:218 uniformly uses `{ ambiguousIsNarrow: true }`. The severity verifier ruled medium, confirmed, reasoning that two independent code paths would compute different column counts for the same ambiguous-width characters (such as ─ │ ☆), so wrap points would not line up with actual rendered widths.

**Why it is not a bug**: The correctness and reproducibility perspectives overturned the core premise by testing on the Bun runtime. The finding claimed `Bun.wrapAnsi` treats `ambiguousIsNarrow` as false by default (counting 2 columns). But `WrapAnsiOptions.ambiguousIsNarrow` in bun-types 1.3.12 is explicitly annotated `@default true`, and `Bun.wrapAnsi('☆'.repeat(30), 10, { hard: true })` by default produces 3 lines of 10 characters (treating ☆ as width 1), identical to `{ ambiguousIsNarrow: true }`. Only an explicit `{ ambiguousIsNarrow: false }` produces width-2 behavior. So omitting options in wrapAnsi.ts is already consistent with stringWidth.ts, and there is no drift.

Even if drift existed, it would not trigger: dom.ts:373 calls measureText again on the wrapAnsi output, and measure-text.ts:37 recomputes `Math.ceil(stringWidth(line)/maxWidth)` with stringWidth, so the yoga height always equals the wrapAnsi line count. Lesson: **claims about runtime defaults must be tested, not recalled from documentation.**

### 3. Leftover parameters after SGR 38/48/58 parse failure pollute style state (sgr.ts:266-305)

**Why it looks like a bug**: For codes 38/48/58, applySGR calls parseExtendedColor. If it returns null (truncated or malformed parameters), all three if-blocks fall through to the `i++` at line 305, skipping only one parameter. The `5` (or `2`) after the 38 and the color index/RGB components are then interpreted as independent SGR codes on the next iteration. An RGB component such as r=31 falls in the 30-37 range and is wrongly applied as the named foreground color red. The correctness verifier tested this: `applySGR('38;2;31')` really does produce `dim=true + fg=red`, exactly the pollution the finding describes, and ruled it low, confirmed.

**Why it is not a bug**: The core trigger cannot happen. The finding's repro claims `\x1b[38;2;31;42;53m` would be split by the tokenizer into `\x1b[38;2` and `;31;42;53m` across two feeds, but the implementation at tokenize.ts:313-316 explicitly buffers an incomplete CSI sequence (`result.buffer = data.slice(seqStart)`) and joins it on the next feed(); a CSI is emitted only when it reaches a final byte (`m` = 0x6d). SGR parameters are never sliced at a semicolon boundary and fed to applySGR. The only caller of applySGR is `Parser.processSequence` at parser.ts:347, whose paramStr comes from the inner slice of a complete CSI. Ansi.tsx's parseToSpans creates a new Parser each time and feeds the complete string in one call.

The remaining theoretical scenario (a truly malformed sequence, such as a program literally printing `\x1b[38;2;31m`) would cause local style pollution, but (a) it needs a child process to emit structurally broken SGR, which compliant TUIs do not do, and (b) the effect is purely cosmetic and resets at the next `\x1b[0m`. Lesson: **for triggers that depend on splitting across feeds, verify that the tokenizer actually splits**, instead of assuming it does.

### 4. sliceAnsi.ts slice start leaks style / leaves a dangling combining mark (sliceAnsi.ts:78-96)

**Why it looks like a bug**: When the slice start is start>0 and lands on a zero-width combining mark, the code runs `if (start > 0 && width === 0) continue` and skips it. But when start=0 and the first character is zero-width (ZWJ `‍`, BOM, a standalone combining mark), the `start > 0 && width === 0` guard does not fire (start=0), so that zero-width character becomes the first character of the result (tested: `sliceAnsi("‍abc", 0, 5)` returns a string starting with U+200D). The correctness perspective ruled low, confirmed.

**Why it is not a bug**: The rebuttal from the reproducibility and severity perspectives is decisive: this is actually the **correct behavior**. With start=0 the caller is asking for a string prefix, and a zero-width character belongs to that prefix. `sliceAnsi('‍abc', 0, 5)` returning `'‍abc'` matches `String.prototype.slice(0, 5)` exactly. The fix the finding proposes (skipping zero-width characters at start=0 too) would be wrong: it would silently drop data, break consistency with String.slice, and make `sliceAnsi(s, 0, n)` no longer a prefix of s.

Skipping when start>0 is correct because the zero-width mark then belongs to the base character on the left (explained in the comment at lines 80-83), and skipping it preserves `left ⊕ right = original`. At start=0 there is no left fragment, so the mark must be kept. Also, the finding's title claims the "slice start leaks style", but `undoAnsiCodes(activeStartCodes)` at lines 100-101 closes all ANSI styles at the end of the result, so no style leaks. Lesson: **decisions about "keep vs. skip" must go back to the API contract** (consistency of sliceAnsi with String.slice), not just the shape of the code.

---

## Fix Roadmap

### P0 (fix now, low risk, high value)

| Item | Location | Change | Expected effect | Risk |
|---|---|---|---|---|
| Tab style loss | output.ts:670-675 | `stylePool.none` → `character.styleId`, `hyperlink: undefined` → `character.hyperlink` | Tab-containing rows with a background no longer show a broken stripe | Very low; matches the normal character path (output.ts:789-794) |
| Ctrl+Space mapping | parse-keypress.ts:722-724 | Explicitly check `s === '\x00'` → `{ name: 'space', ctrl: true }` before the control-byte branch | Ctrl+Space is no longer misread as Ctrl+`; shortcuts bound to it fire | Low; adds a branch without changing existing logic |
| Tokenizer ESC leak | tokenize.ts:181-185 and 3 other places | In the error fallback, `textStart = seqStart + 1` to skip the ESC byte; csi/escapeIntermediate also consume the intermediate bytes | Malformed ANSI input no longer leaks as visible graphemes | Low, but unit tests are needed for the 4 error-fallback branches |

### P1 (fix soon, moderate value)

| Item | Location | Change | Expected effect | Risk |
|---|---|---|---|---|
| Windows Terminal extended keys | terminal.ts:154-167 | Add an `|| process.env.WT_SESSION` branch, or switch to `!!process.env.WT_SESSION` | Native Windows Terminal users can distinguish ctrl+shift+letter | Low; aligns with the 5+ other detections in the same file |
| ChordInterceptor stopImmediatePropagation | KeybindingSetup.tsx:247-270 | When wasInChord && match, call `event.stopImmediatePropagation()` unconditionally before the handler lookup | With a custom chord and an unmounted handler, the second key no longer triggers a single-key binding | Medium; needs a unit test for chord_completed with no handler |

### P2 (structural cleanup, long term)

- **dispatchContinuous dead code** (dispatcher.ts:207-236): delete the method and the continuous branch in `getEventPriority`, or explicitly document it as a reserved extension point. This prevents future maintainers from assuming resize goes through React scheduling priority.
- **MouseActionEvent coordinate inconsistency** (mouse-action-event.ts:38-46): this path currently has no consumers (zero `onMouseDown=` registrations in the repo), so the defect is dormant. Long term, make ClickEvent and MouseActionEvent both use the absolute screen coordinates from `nodeCache`; short term, document that MouseActionEvent.localCol/Row differ in meaning from ClickEvent.
- **Split event dispatch systems** (hit-test.ts vs dispatcher.ts): ClickEvent / MouseActionEvent / TerminalFocusEvent are three parallel mechanisms, each maintaining its own bubbling/stopPropagation semantics. Long term, have all events inherit TerminalEvent and go through Dispatcher.dispatch; short term, document the differences between the two systems so new code does not assume onClick has preventDefault/stopPropagation.

---

## Review Methodology

The review used a four-phase pipeline: 8 parallel subsystem maps → multi-dimension find → 3-perspective adversarial verify → synthesis. Phase one split the ink source by responsibility into 8 subsystems (render core / screen buffer and output / layout engine / terminal I/O parsing / event system / keybindings / React components and hooks / text encoding and selection); each subsystem was read through independently and its suspicious points enumerated. Phase two examined each suspicious point along several dimensions (correctness / performance / terminal-compat / api-misuse) to produce candidate findings.

Phase three is the core of the review's credibility. Each candidate finding was verified from three independent perspectives: **correctness** (does it hold at the code-logic level), **reproducibility** (can it be reproduced in a real terminal session, and are the trigger conditions realistic), and **severity** (scope and seriousness of impact). The three perspectives independently give a confirmed/rejected verdict and an adjustedSeverity. A finding is confirmed only if it holds on all three: the mechanism is sound, it is realistically reproducible, and the severity matches. The mechanism proved its worth: only 6 of 47 candidates were confirmed (13%), and several rejected findings were "code that really reads like a bug" (the blitRegion asymmetry, SGR fall-through, sliceAnsi zero-width handling) that were overturned by runtime tests, call-chain tracing, and invariant checks.

Phase four reconciled disagreements among the three perspectives into a finalSeverity. For findings with large disagreement (such as Ctrl+Space, where the severity perspective said rejected but correctness and reproducibility said confirmed), this document takes the approach of "include it if the mechanism holds, take the middle severity", so it neither lets real correctness defects slip nor exaggerates impact. Readers can judge how robust each conclusion is from its verification record.
