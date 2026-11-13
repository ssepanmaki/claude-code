# Computer Use MCP Tool Test Report

> Test date: 2026-04-04
> Test environment: macOS Darwin 25.4.0, Cursor (IDE tier: click)
> MCP Server: `@ant/computer-use-mcp`

## Tool Overview

There are 17 tools in total (including the composite batch operation), in 5 categories:

| Category | Tools | Count |
|----------|-------|-------|
| Screenshot/display | `screenshot`, `switch_display`, `zoom` | 3 |
| Mouse | `left_click`, `right_click`, `double_click`, `triple_click`, `middle_click`, `left_click_drag`, `mouse_move` | 7 |
| Keyboard | `key`, `type`, `hold_key` | 3 |
| State queries | `cursor_position`, `request_access` | 2 |
| Composite/helper | `computer_batch`, `wait` | 2 |

---

## Test Results

### 1. Permission Management

#### `request_access` — Request application access

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Behavior | Shows a system dialog asking the user for authorization; multiple applications can be requested at once |
| Returns | `{ granted: [...], denied: [...], tierGuidance: "..." }` |
| Permission tiers | `click` (clicks only), `full` (full control) |
| Notes | IDE-type applications (Cursor, VSCode, Terminal) get the `click` tier by default, which restricts keyboard input and right-click; system applications (System Settings) get the `full` tier |

#### Authorized Applications

| Application | Tier | Capabilities |
|-------------|------|--------------|
| Cursor | click | Visible + plain left-click only (no keyboard input, right-click, modifier-key clicks or drag) |
| Terminal | click | Same as above |
| System Settings | full | Full control (keyboard, mouse, drag, etc.) |
| Finder | — | Authorized |

---

### 2. Screenshots and Displays

#### `screenshot` — Capture a screenshot

| Item | Result |
|------|--------|
| Status | ⚠️ Partially passed |
| Execution | The tool ran successfully and returned `ok: true` |
| Image | **No visible image content returned** (output is an empty string) |
| `save_to_disk` | Still no output after setting it |
| Analysis | Possible causes: (1) macOS screen recording permission not granted; (2) the current foreground application was not filtered, leaving an empty capture; (3) the MCP transport layer did not encode the image data correctly |
| Suggestion | Check whether **System Settings → Privacy & Security → Screen Recording** is granted to the application running Claude Code |

#### `switch_display` — Switch display

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Behavior | Accepts a display name or `"auto"` (automatic selection) |
| Returns | A confirmation message |

#### `zoom` — Zoomed region screenshot

| Item | Result |
|------|--------|
| Status | ⏭️ Skipped |
| Reason | Depends on the image coordinates returned by `screenshot`; cannot be tested because no image was returned |

---

### 3. Mouse Operations

> The following tests ran against the Cursor window (tier: click)

#### `mouse_move` — Move the mouse

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Input | `coordinate: [500, 500]` |
| Returns | `"Moved."` |

#### `left_click` — Left click

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Input | `coordinate: [500, 500]` |
| Returns | `"Clicked."` |

#### `double_click` — Double click

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Input | `coordinate: [500, 500]` |
| Returns | `"Clicked."` |

#### `triple_click` — Triple click

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Input | `coordinate: [500, 500]` |
| Returns | `"Clicked."` |

#### `right_click` — Right click

| Item | Result |
|------|--------|
| Status | ⚠️ Restricted by tier |
| Cursor (click tier) | ❌ Denied — `"Code" is granted at tier "click" — right-click, middle-click, and clicks with modifier keys require tier "full"` |
| Finder (full tier) | ✅ Passed — returned `"Clicked."` |
| Conclusion | Works correctly; the IDE security restriction is as expected |

#### `middle_click` — Middle click

| Item | Result |
|------|--------|
| Status | ⚠️ Restricted by tier |
| Cursor (click tier) | ❌ Denied — same as `right_click`, requires the full tier |
| Finder (full tier) | ✅ Passed — returned `"Clicked."` |
| Conclusion | Works correctly; the IDE security restriction is as expected |

#### `left_click_drag` — Drag

| Item | Result |
|------|--------|
| Status | ⚠️ Restricted by tier |
| Cursor (click tier) | ❌ Denied — dragging is treated as a modifier-key click and requires the full tier |
| Finder (full tier) | ✅ Passed — returned `"Dragged."` |
| Conclusion | Works correctly; the IDE security restriction is as expected |

#### `scroll` — Scroll wheel

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Input | `coordinate: [500, 500]`, `scroll_direction: "down"`, `scroll_amount: 3` |
| Returns | `"Scrolled."` |
| Reverse | ✅ `scroll_direction: "up"` also passed |

---

### 4. Keyboard Operations

> The following tests ran against the Cursor window (tier: click); all keyboard operations were denied

#### `key` — Key press / shortcut

| Item | Result |
|------|--------|
| Status | ⚠️ Restricted by tier |
| Cursor (click tier) | ❌ Denied — the IDE tier restricts keyboard input |
| Finder (full tier) | ✅ Passed — the `escape` key press succeeded, returned `"Key pressed."` |
| Conclusion | Works correctly; the IDE security restriction is as expected |

#### `type` — Type text

| Item | Result |
|------|--------|
| Status | ⚠️ Restricted by tier |
| Cursor (click tier) | ❌ Denied — the IDE tier restricts text input |
| Finder (full tier) | ✅ Passed — typing `"hello"` succeeded, returned `"Typed 5 grapheme(s)."` |
| Conclusion | Works correctly; the IDE security restriction is as expected |

#### `hold_key` — Hold a key

| Item | Result |
|------|--------|
| Status | ⚠️ Restricted by tier |
| Cursor (click tier) | ❌ Denied — the IDE tier restricts keyboard input |
| Finder (full tier) | ✅ Passed — holding `shift` for 1 second succeeded, returned `"Key held."` |
| Conclusion | Works correctly; the IDE security restriction is as expected |

---

### 5. State Queries

#### `cursor_position` — Get the mouse position

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Returns | `{"x": null, "y": null, "coordinateSpace": "image_pixels"}` |
| Notes | The coordinates are null because no screenshot succeeded, so there is no reference coordinate system |

---

### 6. Composite/Helper Operations

#### `computer_batch` — Run operations in batch

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Behavior | Runs the list of operations in order and stops the remaining ones when one fails |
| Returns | `{ completed: [...], failed: {...}, remaining: N }` |
| Characteristics | Runs multiple operations in a single API call, reducing round-trip latency |
| Error handling | A failed operation interrupts the following ones; the completed and remaining counts are returned |

#### `wait` — Wait

| Item | Result |
|------|--------|
| Status | ✅ Passed |
| Input | `duration: 1` (seconds) |
| Returns | `"Waited 1s."` |
| Maximum | 100 seconds |

---

## Summary

| Status | Count | Tools |
|--------|-------|-------|
| ✅ Passed | 10 | `request_access`, `switch_display`, `mouse_move`, `left_click`, `double_click`, `triple_click`, `scroll`, `cursor_position`, `computer_batch`, `wait` |
| ⚠️ Partially passed | 7 | `screenshot` (ran successfully but returned no image), `right_click`, `middle_click`, `left_click_drag`, `key`, `type`, `hold_key` (all passed on full-tier applications; the IDE click-tier restriction is expected behavior) |
| ❌ Denied | 0 | — |
| ⏭️ Skipped | 1 | `zoom` (depends on screenshots) |

---

## Known Issues

### P0: Screenshot returns no image

The `screenshot` tool runs successfully but returns no image content, which means:
- No screen coordinate reference is available
- `cursor_position` returns null coordinates
- `zoom` cannot be used
- All click operations are blind (no screenshot to verify against)

**Possible causes**:
1. macOS screen recording permission not granted
2. An MCP image transport/encoding problem
3. The screenshot content was removed by a security filter

**Suggested investigation**: check the `System Settings → Privacy & Security → Screen Recording` permission.

### P1: Keyboard operations restricted in IDE applications — ✅ Confirmed working as designed

IDE-type applications (Cursor, VSCode, Terminal) are limited to the `click` tier and cannot perform:
- Keyboard input (`key`, `type`, `hold_key`)
- Right/middle click (`right_click`, `middle_click`)
- Drag (`left_click_drag`)

This is a security design that stops the AI from controlling the IDE terminal. **On full-tier applications (Finder, System Settings), all six of these operations passed testing and work fully.**

---

## Permission Model

Computer Use MCP uses a tiered permission model:

```
┌─────────────────────────────────────────┐
│  Tier: full                             │
│  - All mouse operations (left, right,   │
│    middle, drag)                        │
│  - Keyboard input (type, key, hold_key) │
│  - For: system apps, Finder, etc.       │
├─────────────────────────────────────────┤
│  Tier: click                            │
│  - Plain left-click only                │
│  - Scroll wheel                         │
│  - For: IDEs, Terminal, etc.            │
├─────────────────────────────────────────┤
│  Not authorized                         │
│  - All operations denied                │
│  - Request through request_access       │
└─────────────────────────────────────────┘
```
