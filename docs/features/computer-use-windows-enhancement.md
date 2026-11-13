# Computer Use Windows Enhancement Implementation Plan

Updated: 2026-04-03
Depends on: `docs/features/windows-ai-desktop-control.md`, `docs/features/computer-use.md`

## 1. Goals

On top of the existing PowerShell child-process approach, use native Windows APIs to strengthen the Windows implementation of Computer Use and solve 3 core problems:

1. **Window-bound screenshots**: `CopyFromScreen` can only capture the full screen and cannot capture a specific window (especially an occluded or minimized one)
2. **UI structure awareness**: today we can only click by coordinates and cannot understand the UI element tree the way macOS Accessibility does
3. **Performance**: each PowerShell launch takes about 273ms, so high-frequency operations such as clipboard access and window enumeration need a faster path

## 2. Verified Windows API capabilities

All of the following APIs were tested successfully through PowerShell P/Invoke:

| Capability | API | Result |
|------|-----|---------|
| Window-bound screenshot | `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` | ✅ VS Code 342KB, Chrome 273KB |
| Enumerate windows + HWND | `EnumWindows` + `GetWindowText` + `GetWindowThreadProcessId` | ✅ 38 windows, with HWND/PID/title |
| UI element tree | `System.Windows.Automation.AutomationElement` | ✅ 39 elements in Notepad |
| Write UI values | `ValuePattern.SetValue()` | ✅ Wrote text into Notepad |
| Click UI elements | `InvokePattern.Invoke()` | ✅ Buttons can be clicked programmatically |
| Identify element at a point | `AutomationElement.FromPoint(x, y)` | ✅ Returns element type + name |
| OCR | `Windows.Media.Ocr.OcrEngine` | ✅ English + Chinese engines available |
| Global hotkey | `RegisterHotKey` | ✅ API callable |
| Direct clipboard access | `System.Windows.Forms.Clipboard` | ✅ Read/write/image detection |
| Shell launch | `ShellExecute` | ✅ Opens files/URLs/apps |

## 3. Architecture design

### 3.1 File structure

Add Windows-specific modules on top of the existing `backends/win32.ts`:

```
packages/@ant/computer-use-input/src/
├── backends/
│   ├── darwin.ts          ← unchanged
│   ├── win32.ts           ← enhanced: direct Win32 APIs replace some PowerShell
│   └── linux.ts           ← unchanged

packages/@ant/computer-use-swift/src/
├── backends/
│   ├── darwin.ts          ← unchanged
│   ├── win32.ts           ← enhanced: PrintWindow window capture + EnumWindows
│   └── linux.ts           ← unchanged

packages/@ant/computer-use-mcp/src/
│   └── tools.ts           ← add Windows-specific tool definitions (UI Automation, OCR)

src/utils/computerUse/
│   └── win32/              ← new directory: Windows-specific capabilities
│       ├── uiAutomation.ts  ← UI element tree, clicks, value writes
│       ├── ocr.ts           ← screenshot + OCR text recognition
│       ├── windowCapture.ts ← PrintWindow window-bound screenshots
│       └── windowEnum.ts    ← EnumWindows window enumeration
```

### 3.2 Layers

```
┌──────────────────────────────────────────────┐
│           Computer Use MCP Tools             │
│  screenshot / click / type / request_access  │
│  + Windows-specific: ui_tree / ocr / window_cap │
├──────────────────────────────────────────────┤
│           src/utils/computerUse/             │
│  executor.ts → dispatch by platform          │
│  win32/ → Windows-specific capability modules │
├──────────────────────────────────────────────┤
│     packages/@ant/computer-use-{input,swift}  │
│  backends/win32.ts → PowerShell + Win32 API  │
├──────────────────────────────────────────────┤
│           Windows Native API                 │
│  PrintWindow / EnumWindows / UI Automation   │
│  SendInput / Clipboard / OCR / ShellExecute  │
└──────────────────────────────────────────────┘
```

## 4. Implementation plan

### Phase A: window-bound screenshots (the core problem)

**Problem**: `CopyFromScreen` can only capture the full screen and cannot capture a specific window.
**Approach**: use `PrintWindow` + `FindWindow` for window-level screenshots.

| Step | File | Change |
|------|------|------|
| A.1 | `src/utils/computerUse/win32/windowCapture.ts` | New: `captureWindow(title)` captures a specific window with PrintWindow |
| A.2 | `src/utils/computerUse/win32/windowEnum.ts` | New: `listWindows()` returns {hwnd, pid, title}[] using EnumWindows |
| A.3 | `packages/@ant/computer-use-swift/src/backends/win32.ts` | `screenshot.captureExcluding` gains per-window capture |
| A.4 | `packages/@ant/computer-use-swift/src/backends/win32.ts` | `apps.listRunning` uses EnumWindows instead of Get-Process (returns HWND) |

**Core of the PowerShell script**:

```powershell
# PrintWindow captures a specific window
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Runtime.InteropServices; using System.Drawing; using System.Drawing.Imaging;
public class WinCap {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern IntPtr FindWindow(string c, string t);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int L, T, R, B; }
    // ... CaptureByTitle(string title) → base64
}
'@
```

**Acceptance criteria**:
- Can capture by window title
- Occluded windows can also be captured
- Returns base64 + width + height

### Phase B: UI Automation (new Windows-specific capability)

**Problem**: macOS has the Accessibility API to read/operate UI elements, while Windows currently can only click by coordinates.
**Approach**: use `System.Windows.Automation` to read the UI tree and operate on elements.

| Step | File | Change |
|------|------|------|
| B.1 | `src/utils/computerUse/win32/uiAutomation.ts` | New: core UIA operation wrappers |
| B.2 | `packages/@ant/computer-use-mcp/src/tools.ts` | Add Windows-specific tool definitions |

**Functions exported by uiAutomation.ts**:

```typescript
// Get a window's UI element tree
getUITree(windowTitle: string, depth: number): UIElement[]

// Find an element by name/type/AutomationId
findElement(windowTitle: string, query: {name?, controlType?, automationId?}): UIElement | null

// Click an element (InvokePattern)
clickElement(windowTitle: string, automationId: string): boolean

// Set an element's value (ValuePattern)
setValue(windowTitle: string, automationId: string, value: string): boolean

// Get the element at a point
elementAtPoint(x: number, y: number): UIElement | null
```

**UIElement type**:
```typescript
interface UIElement {
  name: string
  controlType: string    // Button, Edit, Text, List, etc.
  automationId: string
  boundingRect: { x: number, y: number, w: number, h: number }
  isEnabled: boolean
  value?: string         // when ValuePattern is available
  children?: UIElement[]
}
```

**Core of the PowerShell script**:
```powershell
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Read the UI tree
$root = [AutomationElement]::RootElement
$window = $root.FindFirst([TreeScope]::Children, 
  [PropertyCondition]::new([AutomationElement]::NameProperty, $title))
$elements = $window.FindAll([TreeScope]::Descendants, [Condition]::TrueCondition)

# Write text
$element.GetCurrentPattern([ValuePattern]::Pattern).SetValue($text)

# Click a button
$element.GetCurrentPattern([InvokePattern]::Pattern).Invoke()
```

**Acceptance criteria**:
- Can read Notepad's UI tree (buttons, text boxes, menus)
- Can write content into a text box
- Can click a button
- Can identify the element at a point

### Phase C: OCR screen text recognition

**Problem**: after a screenshot, the AI only sees an image and cannot read the text directly.
**Approach**: use `Windows.Media.Ocr` to run text recognition on the screenshot.

| Step | File | Change |
|------|------|------|
| C.1 | `src/utils/computerUse/win32/ocr.ts` | New: screenshot + OCR recognition |
| C.2 | `packages/@ant/computer-use-mcp/src/tools.ts` | Add the `screen_ocr` tool definition |

**Functions exported by ocr.ts**:
```typescript
// OCR a screen region
ocrRegion(x: number, y: number, w: number, h: number, lang?: string): OcrResult

// OCR a specific window
ocrWindow(windowTitle: string, lang?: string): OcrResult

interface OcrResult {
  text: string
  lines: { text: string, bounds: {x,y,w,h} }[]
  language: string
}
```

**Confirmed available languages**: English (en-US) + Chinese (zh-Hans-CN)

**Acceptance criteria**:
- Can recognize English and Chinese text in a screen region
- Returns the text content + position info for each line

### Phase D: performance optimization for high-frequency operations

**Problem**: each PowerShell launch takes 273ms, which is too slow for high-frequency operations such as mouse moves.
**Approach**: replace PowerShell child processes with direct .NET APIs such as `System.Windows.Forms.Clipboard`.

| Step | File | Change |
|------|------|------|
| D.1 | `src/utils/computerUse/executor.ts` | Clipboard operations use direct APIs instead of PowerShell |
| D.2 | Consider a resident PowerShell process | Interact over stdin/stdout to amortize the startup cost |

**Direct clipboard API** (no PowerShell child process needed):
```powershell
# Read: 50ms → <1ms
[System.Windows.Forms.Clipboard]::GetText()

# Write: 50ms → <1ms  
[System.Windows.Forms.Clipboard]::SetText($text)

# Image detection
[System.Windows.Forms.Clipboard]::ContainsImage()
```

### Phase E: `request_access` Windows adaptation

**Problem**: `request_access` relies on the macOS bundleId to identify apps, and Windows has no such concept.
**Approach**: on Windows, use the exe path + window title in place of bundleId.

| Step | File | Change |
|------|------|------|
| E.1 | `packages/@ant/computer-use-mcp/src/toolCalls.ts` | `resolveRequestedApps` matches by exe path on Windows |
| E.2 | `packages/@ant/computer-use-mcp/src/sentinelApps.ts` | Add a list of dangerous Windows apps (cmd.exe, powershell.exe, etc.) |
| E.3 | `packages/@ant/computer-use-mcp/src/deniedApps.ts` | Add Windows browser/terminal recognition rules |
| E.4 | `src/utils/computerUse/hostAdapter.ts` | `ensureOsPermissions` checks UAC state on Windows |

**Windows app identifier mapping**:
```
macOS bundleId          →  Windows equivalent
com.apple.Safari        →  C:\Program Files\...\msedge.exe (or window title match)
com.google.Chrome       →  chrome.exe
com.apple.Terminal      →  WindowsTerminal.exe / cmd.exe
```

### Phase F: global hotkey (ESC interception)

**Problem**: non-darwin platforms currently skip the ESC hotkey and use Ctrl+C instead.
**Approach**: implement it with `RegisterHotKey` or `SetWindowsHookEx(WH_KEYBOARD_LL)`.

| Step | File | Change |
|------|------|------|
| F.1 | `src/utils/computerUse/escHotkey.ts` | Windows branch: register ESC via RegisterHotKey |

**Low priority**: the Ctrl+C fallback works today, and the ESC hotkey is an experience optimization.

## 5. Execution priority

```
Phase A: window-bound screenshots   ← P0 core need, solves "operate other windows"
Phase B: UI Automation              ← P0 core capability, lets the AI understand UI structure
Phase C: OCR                        ← P1 value-add, lets the AI read on-screen text
Phase D: performance optimization   ← P1 experience, speeds up high-frequency operations
Phase E: request_access adaptation  ← P1 completeness, adapts the permission model
Phase F: ESC hotkey                 ← P2 experience, can come later
```

## 6. Estimated change size per phase

| Phase | New files | Modified files | New lines of code | Risk |
|-------|---------|---------|-----------|------|
| A window screenshots | 2 | 1 | ~200 | Low |
| B UI Automation | 1 | 1 | ~300 | Medium |
| C OCR | 1 | 1 | ~150 | Low |
| D performance | 0 | 2 | ~50 | Low |
| E request_access | 0 | 3 | ~100 | Medium |
| F ESC hotkey | 0 | 1 | ~50 | Low |
| **Total** | **4** | **9** | **~850** | — |

## 7. Files left untouched

- `backends/darwin.ts` (untouched in both packages)
- `backends/linux.ts` (untouched in both packages)
- macOS-related code paths in `src/utils/computerUse/` stay unchanged
- Code already copied from the reference project in `packages/@ant/computer-use-mcp/src/` stays unchanged (Windows tools are only appended)

## 8. Comparison with the macOS/Linux approaches

| Capability | macOS | Windows (after enhancement) | Linux |
|------|-------|-----------------|-------|
| Screenshot method | SCContentFilter (per-app) | **PrintWindow (per-window)** | scrot (full screen/region) |
| UI structure | Accessibility API | **UI Automation** | None |
| OCR | None built in | **Windows.Media.Ocr** | None built in |
| Keyboard/mouse | CGEvent + enigo | SendInput + keybd_event | xdotool |
| Window management | NSWorkspace | **EnumWindows + Win32** | wmctrl |
| Clipboard | pbcopy/pbpaste | **Direct Clipboard API** | xclip |
| ESC hotkey | CGEventTap | RegisterHotKey | None |
| App identifier | bundleId | exe path + window title | /proc + wmctrl |

**After the enhancements, Windows will surpass the macOS approach in UI Automation and OCR**, neither of which the original macOS implementation has (Anthropic uses screenshots + Claude's visual understanding, with no structured UI data).
