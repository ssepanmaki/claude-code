# Computer Use Architecture Revision v2

Updated: 2026-04-04

## 1. Problems with the current architecture

### Problem A: platform code lives in the wrong packages

`@ant/computer-use-swift` is a wrapper around a macOS Swift native module, but we put the Windows (`backends/win32.ts`) and Linux (`backends/linux.ts`) screenshot and app-management code into it. "Swift" in the name implies macOS, so later maintainers cannot tell what belongs where.

`@ant/computer-use-input` has the same problem: it was originally the macOS enigo Rust module, and we also put win32/linux backends into it.

### Problem B: wrong input method

The current Windows backend (`packages/@ant/computer-use-input/src/backends/win32.ts`) uses `SetCursorPos` + `SendInput` + `keybd_event`. This is **global input**:

- The mouse really moves on screen
- Keystrokes really go to the current foreground window
- **It interferes with what the user is currently doing**

Once a window handle is bound, we should use `SendMessage`/`PostMessage` to send messages to the target HWND:

- `WM_CHAR` — send characters without moving the cursor
- `WM_KEYDOWN`/`WM_KEYUP` — send key presses
- `WM_LBUTTONDOWN`/`WM_LBUTTONUP` — send mouse clicks (client-area-relative coordinates)
- `PrintWindow` — capture window content without the window being in the foreground
- **No focus stealing, no interference with the user's current work**

Verified: `SendMessage(WM_CHAR)` to Notepad successfully wrote text while Notepad stayed in the background and the terminal kept the foreground.

### Problem C: screenshots are a shared capability and do not belong in swift

Screenshots, display enumeration, and app management are capabilities every platform needs. They should not live in `@ant/computer-use-swift` (a macOS-specific package name).

## 2. Revised architecture

### 2.1 Layering principle

```
packages/@ant/                     ← macOS native module wrappers (no other platform code)
├── computer-use-input/             ← macOS: enigo .node keyboard/mouse (darwin only)
├── computer-use-swift/             ← macOS: Swift .node screenshots/apps (darwin only)
└── computer-use-mcp/               ← cross-platform: MCP server + tool definitions (unchanged)

src/utils/computerUse/
├── platforms/                     ← new: cross-platform abstraction layer
│   ├── types.ts                    ← shared interfaces: InputPlatform, ScreenshotPlatform, AppsPlatform, DisplayPlatform
│   ├── index.ts                    ← platform dispatcher: loads a backend by process.platform
│   ├── darwin.ts                   ← macOS: delegates to @ant/computer-use-{input,swift}
│   ├── win32.ts                    ← Windows: SendMessage input + PrintWindow screenshots + EnumWindows + UIA + OCR
│   └── linux.ts                    ← Linux: xdotool + scrot + xrandr + wmctrl
│
├── win32/                         ← Windows-specific enhancements (not part of the shared interface)
│   ├── windowCapture.ts            ← PrintWindow window-bound screenshots
│   ├── windowEnum.ts               ← EnumWindows window enumeration
│   ├── windowMessage.ts            ← SendMessage/PostMessage focus-free input (new)
│   ├── uiAutomation.ts             ← IUIAutomation UI element operations
│   └── ocr.ts                      ← Windows.Media.Ocr text recognition
│
├── executor.ts                    ← changed: gets the platform implementation via platforms/, no direct @ant calls
├── swiftLoader.ts                 ← changed: darwin only
├── inputLoader.ts                 ← changed: darwin only
└── ...other files unchanged
```

### 2.2 Shared interfaces (`platforms/types.ts`)

```typescript
/** Window identifier — cross-platform */
export interface WindowHandle {
  id: string           // macOS: bundleId, Windows: HWND string, Linux: window ID
  pid: number
  title: string
  exePath?: string     // Windows/Linux: process path
}

/** Input platform interface — two modes */
export interface InputPlatform {
  // Mode A: global input (default on macOS/Linux, sent to the foreground window)
  moveMouse(x: number, y: number): Promise<void>
  click(x: number, y: number, button: 'left' | 'right' | 'middle'): Promise<void>
  typeText(text: string): Promise<void>
  key(name: string, action: 'press' | 'release'): Promise<void>
  keys(combo: string[]): Promise<void>
  scroll(amount: number, direction: 'vertical' | 'horizontal'): Promise<void>
  mouseLocation(): Promise<{ x: number; y: number }>
  
  // Mode B: window-bound input (Windows SendMessage, does not steal focus)
  sendChar?(hwnd: string, char: string): Promise<void>
  sendKey?(hwnd: string, vk: number, action: 'down' | 'up'): Promise<void>
  sendClick?(hwnd: string, x: number, y: number, button: 'left' | 'right'): Promise<void>
  sendText?(hwnd: string, text: string): Promise<void>
}

/** Screenshot platform interface */
export interface ScreenshotPlatform {
  // Full-screen capture
  captureScreen(displayId?: number): Promise<ScreenshotResult>
  // Region capture
  captureRegion(x: number, y: number, w: number, h: number): Promise<ScreenshotResult>
  // Window capture (Windows: PrintWindow, macOS: SCContentFilter, Linux: xdotool+import)
  captureWindow?(hwnd: string): Promise<ScreenshotResult | null>
}

/** Display platform interface */
export interface DisplayPlatform {
  listAll(): DisplayInfo[]
  getSize(displayId?: number): DisplayInfo
}

/** App management platform interface */
export interface AppsPlatform {
  listRunning(): WindowHandle[]
  listInstalled(): Promise<InstalledApp[]>
  open(name: string): Promise<void>
  getFrontmostApp(): FrontmostAppInfo | null
  findWindowByTitle(title: string): WindowHandle | null
}

export interface ScreenshotResult {
  base64: string
  width: number
  height: number
}

export interface DisplayInfo {
  width: number
  height: number
  scaleFactor: number
  displayId: number
}

export interface InstalledApp {
  id: string       // macOS: bundleId, Windows: exe path, Linux: .desktop name
  displayName: string
  path: string
}

export interface FrontmostAppInfo {
  id: string
  appName: string
}
```

### 2.3 Platform dispatcher (`platforms/index.ts`)

```typescript
import type { InputPlatform, ScreenshotPlatform, DisplayPlatform, AppsPlatform } from './types.js'

export interface Platform {
  input: InputPlatform
  screenshot: ScreenshotPlatform
  display: DisplayPlatform
  apps: AppsPlatform
}

export function loadPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return require('./darwin.js').platform
    case 'win32':
      return require('./win32.js').platform
    case 'linux':
      return require('./linux.js').platform
    default:
      throw new Error(`Computer Use not supported on ${process.platform}`)
  }
}
```

### 2.4 Per-platform implementations

**`platforms/darwin.ts`** — delegates to the @ant packages (keeps compatibility):
```typescript
// macOS: via @ant/computer-use-input and @ant/computer-use-swift
// The darwin backends of these two packages stay untouched
import { requireComputerUseInput } from '../inputLoader.js'
import { requireComputerUseSwift } from '../swiftLoader.js'

export const platform = {
  input: { /* delegates to requireComputerUseInput() */ },
  screenshot: { /* delegates to requireComputerUseSwift().screenshot */ },
  display: { /* delegates to requireComputerUseSwift().display */ },
  apps: { /* delegates to requireComputerUseSwift().apps */ },
}
```

**`platforms/win32.ts`** — uses the `src/utils/computerUse/win32/` modules:
```typescript
// Windows: SendMessage input + PrintWindow screenshots + EnumWindows apps
import { sendChar, sendKey, sendClick, sendText } from '../win32/windowMessage.js'
import { captureWindow } from '../win32/windowCapture.js'
import { listWindows } from '../win32/windowEnum.js'
// ... PowerShell P/Invoke global input as a fallback

export const platform = {
  input: {
    // Global mode: PowerShell SetCursorPos/SendInput (fallback)
    // Window mode: SendMessage (preferred)
    sendChar, sendKey, sendClick, sendText,  // window-bound
    moveMouse, click, typeText, ...           // global fallback
  },
  screenshot: {
    captureScreen,     // CopyFromScreen
    captureRegion,     // CopyFromScreen(rect)
    captureWindow,     // PrintWindow (no focus stealing)
  },
  display: { /* Screen.AllScreens */ },
  apps: { /* EnumWindows */ },
}
```

**`platforms/linux.ts`** — uses xdotool/scrot:
```typescript
// Linux: xdotool + scrot + xrandr + wmctrl
export const platform = {
  input: { /* xdotool mousemove/click/key/type */ },
  screenshot: { /* scrot */ },
  display: { /* xrandr */ },
  apps: { /* wmctrl + ps */ },
}
```

### 2.5 executor.ts changes

```typescript
// Before: called requireComputerUseSwift() and requireComputerUseInput() directly
// After: everything goes through platforms/

import { loadPlatform } from './platforms/index.js'

const platform = loadPlatform()

// Screenshots
platform.screenshot.captureScreen()
platform.screenshot.captureWindow(hwnd)  // window-bound

// Input (window-bound mode, no focus stealing)
platform.input.sendText?.(hwnd, 'Hello')
platform.input.sendClick?.(hwnd, 100, 200, 'left')

// Input (global mode, fallback)
platform.input.moveMouse(500, 500)
platform.input.click(500, 500, 'left')
```

## 3. Windows input mode comparison

| Method | API | Steals focus | Moves mouse | Window can be minimized | Use case |
|------|-----|--------|--------|-------------|---------|
| **Global input** | `SetCursorPos` + `SendInput` | ✅ Yes | ✅ Yes | ❌ No | Coordinate clicks (fallback) |
| **Window message** | `SendMessage(WM_CHAR/WM_KEYDOWN)` | ❌ No | ❌ No | ✅ Yes | Typing, key presses (preferred) |
| **Window message** | `SendMessage(WM_LBUTTONDOWN)` | ❌ No | ❌ No | ⚠️ Partly | Clicks inside a window |
| **Window capture** | `PrintWindow(hwnd, PW_RENDERFULLCONTENT)` | ❌ No | ❌ No | ✅ Yes | Window screenshots |
| **UI operations** | `UIAutomation InvokePattern` | ❌ No | ❌ No | ✅ Yes | Button clicks, text entry |

**Strategy**: prefer window messages + UIAutomation (no interference with the user), with global input as a fallback.

## 4. Files to add

| File | Description |
|------|------|
| `src/utils/computerUse/platforms/types.ts` | Shared interface definitions |
| `src/utils/computerUse/platforms/index.ts` | Platform dispatcher |
| `src/utils/computerUse/platforms/darwin.ts` | macOS: delegates to the @ant packages |
| `src/utils/computerUse/platforms/win32.ts` | Windows: composes the modules under win32/ |
| `src/utils/computerUse/platforms/linux.ts` | Linux: xdotool/scrot |
| `src/utils/computerUse/win32/windowMessage.ts` | **New**: SendMessage focus-free input |

## 5. Files to remove/clean up

| File | Action | Reason |
|------|------|------|
| `packages/@ant/computer-use-input/src/backends/win32.ts` | Delete | Windows code does not belong in the macOS package |
| `packages/@ant/computer-use-input/src/backends/linux.ts` | Delete | Linux code does not belong in the macOS package |
| `packages/@ant/computer-use-swift/src/backends/win32.ts` | Delete | Same as above |
| `packages/@ant/computer-use-swift/src/backends/linux.ts` | Delete | Same as above |
| `packages/@ant/computer-use-input/src/types.ts` | Delete | Moved to platforms/types.ts |
| `packages/@ant/computer-use-swift/src/types.ts` | Delete | Moved to platforms/types.ts |

## 6. Files to modify

| File | Change |
|------|------|
| `packages/@ant/computer-use-input/src/index.ts` | Restore to a darwin-only dispatcher (drop the win32/linux cases) |
| `packages/@ant/computer-use-swift/src/index.ts` | Restore to a darwin-only dispatcher (drop the win32/linux cases) |
| `src/utils/computerUse/executor.ts` | Get platform implementations via `platforms/`, no direct @ant calls |
| `src/utils/computerUse/swiftLoader.ts` | Load on darwin only |
| `src/utils/computerUse/inputLoader.ts` | Load on darwin only |

## 7. Role of the @ant packages (after the revision)

| Package | Responsibility | Platform |
|---|------|------|
| `@ant/computer-use-input` | Wrapper for the macOS enigo keyboard/mouse native module | **darwin only** |
| `@ant/computer-use-swift` | Wrapper for the macOS Swift screenshot/app native module | **darwin only** |
| `@ant/computer-use-mcp` | MCP server + tool definitions + call routing | **Cross-platform** (no platform code) |

All Windows/Linux platform implementations live in `src/utils/computerUse/platforms/` and `src/utils/computerUse/win32/`.

## 8. Execution order

```
Phase 1: Create the platforms/ abstraction layer
  ├── platforms/types.ts (shared interfaces)
  ├── platforms/index.ts (dispatcher)
  └── platforms/darwin.ts (delegates to the @ant packages)

Phase 2: Create the Windows platform implementation
  ├── win32/windowMessage.ts (SendMessage focus-free input)
  └── platforms/win32.ts (composes the win32/ modules)

Phase 3: Create the Linux platform implementation
  └── platforms/linux.ts (xdotool/scrot)

Phase 4: Refactor executor.ts
  └── Get implementations via platforms/, no direct @ant calls

Phase 5: Clean up the @ant packages
  ├── Delete @ant/computer-use-input/src/backends/{win32,linux}.ts
  ├── Delete @ant/computer-use-swift/src/backends/{win32,linux}.ts
  └── Restore index.ts to darwin-only

Phase 6: Verify + PR
```
