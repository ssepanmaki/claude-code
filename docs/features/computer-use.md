# Computer Use — macOS / Windows / Linux Cross-Platform Implementation Plan

Updated: 2026-04-03
Reference project: the upstream reference project

## 1. Current State

The reference project's Computer Use **supports only macOS** — everything from the entry point to the lowest layer is hardcoded to darwin. In Phases 1-3 our project has already completed:

- ✅ The `@ant/computer-use-mcp` stub was replaced with a full implementation (12 files)
- ✅ `@ant/computer-use-input` was split into a dispatcher + backends (darwin + win32)
- ✅ `@ant/computer-use-swift` was split into a dispatcher + backends (darwin + win32)
- ✅ The `CHICAGO_MCP` build switch is on
- ✅ The macOS hardcoding in the `src/` layer was removed (Phase 2 is done)

## 2. Blocking Points Overview

### 2.1 Entry Layer

| # | File:line | Blocking code | Impact |
|---|-----------|---------------|--------|
| 1 | `src/main.tsx:2366` | `feature("CHICAGO_MCP")` gate | CU initialization entry |

### 2.2 Loading Layer

| # | File:line | Blocking code | Impact |
|---|-----------|---------------|--------|
| 2 | `src/utils/computerUse/swiftLoader.ts` | macOS-only loader (now loads only on darwin) | Non-darwin uses platforms/ instead |
| 3 | `src/utils/computerUse/executor.ts:302` | `process.platform !== 'darwin'` → cross-platform executor | Non-darwin takes the cross-platform path |

### 2.3 macOS-Specific Dependencies

| # | File:line | Dependency | macOS implementation | Replacement needed |
|---|-----------|------------|----------------------|--------------------|
| 4 | `executor.ts:72-96` | Clipboard | `pbcopy`/`pbpaste` / PowerShell / xclip | Win: PowerShell `Get/Set-Clipboard`; Linux: `xclip`/`wl-copy` |
| 5 | `drainRunLoop.ts` | CFRunLoop pump | `cu._drainMainRunLoop()` | Non-darwin: run fn() directly, no pump needed |
| 6 | `escHotkey.ts` | ESC hotkey | CGEventTap | Non-darwin: return false (Ctrl+C fallback already exists) |
| 7 | `hostAdapter.ts` | System permissions | TCC accessibility + screenRecording | Win: always granted; Linux: check xdotool |
| 8 | `common.ts:55-58` | Platform identifier | Obtained dynamically | Now dispatched on `process.platform` |
| 9 | `executor.ts:232` | Paste shortcut | `command`/`ctrl` dispatch | Paste shortcut now dispatched per platform |

### 2.4 Missing Linux Backends

| Package | macOS | Windows | Linux |
|---------|-------|---------|-------|
| `computer-use-input/backends/` | ✅ darwin.ts | ✅ win32.ts | ❌ linux.ts needs to be created |
| `computer-use-swift/backends/` | ✅ darwin.ts | ✅ win32.ts | ❌ linux.ts needs to be created |

## 3. Capability Dependencies Per Platform

### 3.1 computer-use-input (keyboard and mouse)

| Function | macOS | Windows | Linux |
|----------|-------|---------|-------|
| Mouse move | CGEvent JXA | SetCursorPos P/Invoke | xdotool mousemove |
| Mouse click | CGEvent JXA | SendInput P/Invoke | xdotool click |
| Mouse wheel | CGEvent JXA | SendInput MOUSEEVENTF_WHEEL | xdotool scroll |
| Key press | System Events osascript | keybd_event P/Invoke | xdotool key |
| Key combination | System Events osascript | keybd_event combination | xdotool key combo |
| Text input | System Events keystroke | SendKeys.SendWait | xdotool type |
| Foreground app | System Events osascript | GetForegroundWindow P/Invoke | xdotool getactivewindow + /proc |
| Tool dependency | osascript (built in) | powershell (built in) | xdotool (must be installed) |

### 3.2 computer-use-swift (screenshots + app management)

| Function | macOS | Windows | Linux |
|----------|-------|---------|-------|
| Full-screen screenshot | screencapture | CopyFromScreen | gnome-screenshot / scrot / grim |
| Region screenshot | screencapture -R | CopyFromScreen(rect) | gnome-screenshot -a / scrot -a / grim -g |
| Display list | CGGetActiveDisplayList JXA | Screen.AllScreens | xrandr --query |
| Running apps | System Events JXA | Get-Process | wmctrl -l / ps |
| Open app | osascript activate | Start-Process | xdg-open / gtk-launch |
| Hide/show | System Events visibility | ShowWindow/SetForegroundWindow | wmctrl -c / xdotool |
| Tool dependency | screencapture + osascript | powershell | xdotool + scrot/grim + wmctrl |

### 3.3 Executor Layer

| Function | macOS | Windows | Linux |
|----------|-------|---------|-------|
| drainRunLoop | CFRunLoop pump | Not needed | Not needed |
| ESC hotkey | CGEventTap | Skipped (Ctrl+C fallback) | Skipped (Ctrl+C fallback) |
| Clipboard read | pbpaste | `powershell Get-Clipboard` | xclip -o / wl-paste |
| Clipboard write | pbcopy | `powershell Set-Clipboard` | xclip / wl-copy |
| Paste shortcut | command+v | ctrl+v | ctrl+v |
| Terminal detection | __CFBundleIdentifier | WT_SESSION / TERM_PROGRAM | TERM_PROGRAM |
| System permissions | TCC check | Always granted | Check that xdotool is installed |

## 4. Execution Steps

### Phase 1: Done ✅

- [x] `@ant/computer-use-mcp` stub → full implementation
- [x] `@ant/computer-use-input` dispatcher + darwin/win32 backends
- [x] `@ant/computer-use-swift` dispatcher + darwin/win32 backends
- [x] `CHICAGO_MCP` build switch

### Phase 2: Remove the 6 macOS hardcodings (unlocks macOS + Windows)

**Change principle: the macOS code path stays the same; only add win32/linux branches after each darwin guard.**

| Step | File | Change |
|------|------|--------|
| 2.1 | `src/main.tsx:2366` | `feature("CHICAGO_MCP")` → is already the cross-platform entry |
| 2.2 | `src/utils/computerUse/swiftLoader.ts` | Now loads only on darwin; non-darwin uses platforms/ |
| 2.3 | `src/utils/computerUse/executor.ts:302-309` | Now cross-platform dispatch (non-darwin → createCrossPlatformExecutor) |
| 2.4 | `src/utils/computerUse/executor.ts:72-96` | Clipboard now dispatched per platform: darwin→pbcopy/pbpaste, win32→PowerShell, linux→xclip |
| 2.5 | `src/utils/computerUse/executor.ts:232` | Paste shortcut now dispatched per platform: darwin→command, others→ctrl |
| 2.6 | `src/utils/computerUse/executor.ts:302-309` | Non-darwin now uses `createCrossPlatformExecutor()` |
| 2.7 | `src/utils/computerUse/drainRunLoop.ts` | Non-darwin needs no pump (runs fn directly) |
| 2.8 | `src/utils/computerUse/escHotkey.ts` | Non-darwin returns false (Ctrl+C fallback already exists) |
| 2.9 | `src/utils/computerUse/hostAdapter.ts` | Non-darwin permission check logic is implemented |
| 2.10 | `src/utils/computerUse/common.ts:58` | Now dispatched dynamically on `process.platform` |
| 2.11 | `src/utils/computerUse/common.ts:55` | Now darwin→'native', others→'none' |
| 2.12 | `src/utils/computerUse/gates.ts:55` | Updated (the enabled default needs verification) |
| 2.13 | `src/utils/computerUse/gates.ts:39` | `hasRequiredSubscription()` updated |

### Phase 3: Add the Linux backends

| Step | File | Content |
|------|------|---------|
| 3.1 | `packages/@ant/computer-use-input/src/backends/linux.ts` | xdotool keyboard and mouse (mousemove/click/key/type/getactivewindow) |
| 3.2 | `packages/@ant/computer-use-swift/src/backends/linux.ts` | scrot/grim screenshots + xrandr displays + wmctrl window management |
| 3.3 | `packages/@ant/computer-use-input/src/index.ts` | Add `case 'linux'` to the dispatcher |
| 3.4 | `packages/@ant/computer-use-swift/src/index.ts` | Add `case 'linux'` to the dispatcher |

### Phase 4: Verification

| Test item | macOS | Windows | Linux |
|-----------|-------|---------|-------|
| Build succeeds | ✅ | Verify | Verify |
| MCP tool list is non-empty | Verify | Verify | Verify |
| Mouse move | Verify | ✅ Passed | Verify |
| Screenshot | Verify | ✅ Passed | Verify |
| Keyboard input | Verify | Verify | Verify |
| Foreground window | Verify | ✅ Passed | Verify |
| Clipboard | Verify | Verify | Verify |

## 5. File Change Overview

### Files left untouched (14)

`cleanup.ts`, `computerUseLock.ts`, `wrapper.tsx`, `toolRendering.tsx`, `mcpServer.ts`, `setup.ts`, `appNames.ts`, `inputLoader.ts`, `src/services/mcp/client.ts`, `@ant/computer-use-mcp/src/*` (done in Phase 1), `backends/darwin.ts` (untouched in both packages)

### Files changed in src/ (8)

| File | Size of change | Risk |
|------|----------------|------|
| `main.tsx` | 1 line | Low |
| `swiftLoader.ts` | 2 lines | Low |
| `executor.ts` | ~40 lines (clipboard dispatch + platform guard + paste shortcut) | **Medium** |
| `drainRunLoop.ts` | 1 line | Low |
| `escHotkey.ts` | 3 lines | Low |
| `hostAdapter.ts` | 5 lines | Low |
| `common.ts` | 3 lines | Low |
| `gates.ts` | 3 lines | Low |

### New files (2)

| File | Estimated lines |
|------|-----------------|
| `packages/@ant/computer-use-input/src/backends/linux.ts` | ~150 lines |
| `packages/@ant/computer-use-swift/src/backends/linux.ts` | ~200 lines |

## 6. Linux Dependency Tools

| Tool | Purpose | Install command (Ubuntu) |
|------|---------|--------------------------|
| `xdotool` | Keyboard/mouse simulation + window management | `sudo apt install xdotool` |
| `scrot` or `gnome-screenshot` | Screenshots | `sudo apt install scrot` |
| `xrandr` | Display information | Usually preinstalled |
| `xclip` | Clipboard | `sudo apt install xclip` |
| `wmctrl` | Window listing/switching | `sudo apt install wmctrl` |

Wayland environments need alternative tools: `ydotool` (instead of xdotool), `grim` (instead of scrot), `wl-clipboard` (instead of xclip). Initially only X11 can be supported, with Wayland marked as a todo.

## 7. Suggested Execution Order

```
Phase 2 (unlock macOS + Windows)
  ├── 2.1-2.3  Remove the 3 hardcoded throw/skip spots
  ├── 2.4-2.5  Clipboard + paste shortcut platform dispatch
  ├── 2.6      swiftLoader → instantiate directly
  ├── 2.7-2.9  drainRunLoop / escHotkey / permissions platform branches
  ├── 2.10-2.11 Make the common.ts platform identifier dynamic
  ├── 2.12-2.13 gates.ts defaults
  └── Verify Windows

Phase 3 (Linux backends)
  ├── 3.1  input/backends/linux.ts
  ├── 3.2  swift/backends/linux.ts
  ├── 3.3-3.4  Add linux case to the dispatchers
  └── Verify Linux

Phase 4 (integration verification + PR)
```

Each phase can be verified and committed independently. After Phase 2, macOS + Windows work; after Phase 3, all three platforms work.
