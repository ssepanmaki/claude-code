# Computer Use Tools Reference

## Overview

Computer Use provides 38 tools in three categories:

| Category | Platform | Tools | Description |
|------|------|--------|------|
| General tools | All platforms | 24 | Standard official Computer Use capabilities |
| Windows-specific tools | Win32 | 11 | Enhanced capabilities in bound-window mode |
| Teaching tools | All platforms | 3 | Step-by-step guided mode (requires `teachMode`) |

---

## 1. General tools (24)

Available on all platforms. When no window is bound, the target of every operation is the whole screen.

### Permissions and session

| Tool | Parameters | Description |
|------|------|------|
| `request_access` | `apps[]`, `reason`, `clipboardRead?`, `clipboardWrite?`, `systemKeyCombos?` | Request permission to operate apps. A prerequisite for all other tools |
| `list_granted_applications` | — | List the apps authorized in the current session |

### Screenshots and display

| Tool | Parameters | Description |
|------|------|------|
| `screenshot` | `save_to_disk?` | Capture the current screen. When a window is bound, captures the bound window (PrintWindow). Returns an image plus a GUI element list (Windows) |
| `zoom` | `region: [x1,y1,x2,y2]` | Capture a high-resolution image of the given region. Coordinates are based on the most recent full-screen screenshot |
| `switch_display` | `display` | Switch the target display for screenshots |

### Mouse operations

| Tool | Parameters | Description |
|------|------|------|
| `left_click` | `coordinate: [x,y]`, `text?` (modifier key) | Left click. `text` can be "shift"/"ctrl"/"alt" for modified clicks |
| `double_click` | `coordinate`, `text?` | Double click |
| `triple_click` | `coordinate`, `text?` | Triple click (selects a whole line) |
| `right_click` | `coordinate`, `text?` | Right click |
| `middle_click` | `coordinate`, `text?` | Middle click |
| `mouse_move` | `coordinate` | Move the mouse (no click) |
| `left_click_drag` | `coordinate` (end point), `start_coordinate?` (start point) | Drag |
| `left_mouse_down` | — | Press and hold the left button |
| `left_mouse_up` | — | Release the left button |
| `cursor_position` | — | Get the current mouse position |

### Keyboard operations

| Tool | Parameters | Description |
|------|------|------|
| `type` | `text` | Type text |
| `key` | `text` (e.g. "ctrl+s"), `repeat?` | Press a key or key combination |
| `hold_key` | `text`, `duration` (seconds) | Hold a key for the given duration |

### Scrolling

| Tool | Parameters | Description |
|------|------|------|
| `scroll` | `coordinate`, `scroll_direction`, `scroll_amount` | Scroll. Directions: up/down/left/right |

### Application management

| Tool | Parameters | Description |
|------|------|------|
| `open_application` | `app` | Open an app. On Windows the window is bound automatically |

### Clipboard

| Tool | Parameters | Description |
|------|------|------|
| `read_clipboard` | — | Read clipboard text |
| `write_clipboard` | `text` | Write to the clipboard |

### Other

| Tool | Parameters | Description |
|------|------|------|
| `wait` | `duration` (seconds) | Wait |
| `computer_batch` | `actions[]` | Run several actions in one batch (fewer API round trips) |

---

## 2. Windows-specific tools (12)

Visible only on Windows. Core capability: **independent operation after binding a window, without taking over the user's mouse and keyboard**.

### Working modes

```
┌──────────────────────────────────────────────────┐
│                  Unbound mode                     │
│  Uses the general tools (left_click/type/key/scroll) │
│  Target: the whole screen                         │
│  Input: global SendInput (moves the real mouse)   │
└──────────────────────────────────────────────────┘
                        │
                  bind_window / open_application
                        ▼
┌──────────────────────────────────────────────────┐
│                Bound-window mode                  │
│  Uses Win32 tools (virtual_mouse/virtual_keyboard)│
│  Target: the bound window                         │
│  Input: SendMessageW (real mouse/keyboard untouched) │
│  Visuals: DWM green border + virtual cursor + status indicator │
└──────────────────────────────────────────────────┘
```

### Window binding

| Tool | Parameters | Description |
|------|------|------|
| `bind_window` | `action`: list/bind/unbind/status | Window binding management |

**Action details:**

| action | Parameters | Description |
|--------|------|------|
| `list` | — | List all visible windows (hwnd, pid, title) |
| `bind` | `title?`, `hwnd?`, `pid?` | Bind to the given window. Sets the DWM green border, starts the virtual cursor and the status indicator, and briefly activates the window so it can receive input |
| `unbind` | — | Unbind and restore full-screen mode |
| `status` | — | Show the current binding state (hwnd, title, pid, window rectangle) |

### Window management

| Tool | Parameters | Description |
|------|------|------|
| `window_management` | `action`, `x?`, `y?`, `width?`, `height?` | Window operations (Win32 API, no global hotkeys) |

**Action details:**

| action | Description |
|--------|------|
| `minimize` | ShowWindow(SW_MINIMIZE) |
| `maximize` | ShowWindow(SW_MAXIMIZE) |
| `restore` | ShowWindow(SW_RESTORE) — restore from minimized/maximized |
| `close` | SendMessage(WM_CLOSE) — graceful close |
| `focus` | SetForegroundWindow + BringWindowToTop — activate the window |
| `move_offscreen` | SetWindowPos(-32000,-32000) — move off-screen (SendMessage/PrintWindow still work) |
| `move_resize` | SetWindowPos — move/resize to the given position and size |
| `get_rect` | GetWindowRect — get the current position and size |

### Virtual mouse

| Tool | Parameters | Description |
|------|------|------|
| `virtual_mouse` | `action`, `coordinate: [x,y]`, `start_coordinate?` | Operate a virtual mouse inside the bound window |

**Action details:**

| action | Description |
|--------|------|
| `click` | Left click. The virtual cursor moves to the coordinate with a blink animation |
| `double_click` | Double click |
| `right_click` | Right click |
| `move` | Move the virtual cursor (no click) |
| `drag` | Press, move, release. Needs `start_coordinate` for the start point |
| `down` | Press and hold the left button |
| `up` | Release the left button |

**Difference from the general mouse tools:**

| | General (`left_click` etc.) | `virtual_mouse` |
|---|---|---|
| Input method | SendInput (global) | SendMessageW (window-level) |
| Real mouse | Moves | **Does not move** |
| User interference | Yes | **None** |
| Use when | Unbound | **Bound** |

### Virtual keyboard

| Tool | Parameters | Description |
|------|------|------|
| `virtual_keyboard` | `action`, `text`, `duration?`, `repeat?` | Operate a virtual keyboard inside the bound window |

**Action details:**

| action | Meaning of text | Description |
|--------|----------|------|
| `type` | Text to type | SendMessageW(WM_CHAR), supports Unicode (CJK/emoji) |
| `combo` | Key combination (e.g. "ctrl+s") | WM_KEYDOWN/UP sequence |
| `press` | A single key name | Press and hold (use with release) |
| `release` | A single key name | Release the key |
| `hold` | Key name or combination | Hold for the given number of seconds, then release |

**Difference from the general keyboard tools:**

| | General (`type`/`key`) | `virtual_keyboard` |
|---|---|---|
| Input method | SendInput (global) | SendMessageW (window-level) |
| Physical keyboard | Conflicts | **No conflict** |
| Use when | Unbound | **Bound** |

**Note:** SendMessageW has no effect on modern apps such as Windows Terminal (ConPTY). For those apps, use the general tools plus window activation.

### Mouse wheel

| Tool | Parameters | Description |
|------|------|------|
| `mouse_wheel` | `coordinate: [x,y]`, `delta`, `direction?` | WM_MOUSEWHEEL mouse wheel scrolling |

**Parameters:**
- `delta`: positive = up, negative = down. Each unit ≈ 3 lines
- `direction`: "vertical" (default) or "horizontal"
- `coordinate`: where the wheel acts, which decides which pane/region receives the scroll

**Difference from the general `scroll`:**

| | `scroll` | `mouse_wheel` |
|---|---|---|
| Mechanism | WM_VSCROLL/WM_HSCROLL | **WM_MOUSEWHEEL** |
| Excel | ❌ | ✅ |
| Browsers | ❌ | ✅ |
| Code editors | ❌ | ✅ |

### Element-level operations

| Tool | Parameters | Description |
|------|------|------|
| `click_element` | `name?`, `role?`, `automationId?` | Click a GUI element by accessibility name/role |
| `type_into_element` | `name?`, `role?`, `automationId?`, `text` | Type text into an element by name |

**How it works:**
1. Find the matching element in the bound window through UI Automation
2. `click_element`: tries InvokePattern first (buttons/menus), and on failure sends a SendMessage click at the center of the BoundingRect
3. `type_into_element`: tries ValuePattern to set the value directly, and on failure clicks to focus and types with WM_CHAR

**Use when:**
- You can see an element's name in the screenshot but the coordinates are imprecise
- The Accessibility Snapshot lists the element's name/automationId
- It is more reliable than coordinate clicks (not affected by window scaling/DPI)

### Terminal interaction

| Tool | Parameters | Description |
|------|------|------|
| `open_terminal` | `agent`, `command?` | Open a new terminal window and start an AI agent (claude/codex/gemini/custom). Binds the window automatically and verifies with a screenshot |
| `activate_window` | `click_x?`, `click_y?` | Activate the bound window: SetForegroundWindow + BringWindowToTop + a click to ensure focus |
| `prompt_respond` | `response_type`, `arrow_direction?`, `arrow_count?`, `text?` | Handle terminal Yes/No/selection prompts |

**open_terminal agent types:**

| agent | Command | Description |
|-------|------|------|
| `claude` | `claude` | Start Claude Code |
| `codex` | `codex` | Start Codex |
| `gemini` | `gemini` | Start Gemini |
| `custom` | User-specified | Custom command |

**response_type details:**

| response_type | Action | Scenario |
|---------------|------|------|
| `yes` | Send 'y' + Enter | npm "Continue? (y/n)" |
| `no` | Send 'n' + Enter | Decline a confirmation |
| `enter` | Send Enter | Accept the default option |
| `escape` | Send Escape | Cancel the operation |
| `select` | ↑/↓ arrow × N + Enter | inquirer selection menu |
| `type` | Type text + Enter | Text input prompt |

### Status indicator

| Tool | Parameters | Description |
|------|------|------|
| `status_indicator` | `action`: show/hide/status, `message?` | Control the floating status label at the bottom of the bound window |

---

## 3. Teaching tools (3)

Require `teachMode` to be enabled.

| Tool | Description |
|------|------|
| `request_teach_access` | Request permission for guided teaching mode |
| `teach_step` | Show one guidance tip and wait for the user to click Next |
| `teach_batch` | Queue several guidance steps in one batch |

---

## Workflows

### Flow 1: full-screen operation (unbound)

```
request_access(apps=["Notepad"])
open_application(app="Notepad")          ← binds the window automatically
screenshot                               ← PrintWindow screenshot + GUI element list
left_click(coordinate=[500, 300])        ← global SendInput
type(text="hello world")                 ← global SendInput
key(text="ctrl+s")                       ← global SendInput
```

### Flow 2: bound-window operation (recommended, does not disturb the user)

```
request_access(apps=["Notepad"])
bind_window(action="list")               ← list all windows
bind_window(action="bind", title="Notepad") ← bind + green border + virtual cursor
screenshot                               ← PrintWindow captures the bound window
virtual_mouse(action="click", coordinate=[500, 300])   ← SendMessageW, real mouse untouched
virtual_keyboard(action="type", text="hello world")    ← SendMessageW, physical keyboard untouched
virtual_keyboard(action="combo", text="ctrl+s")        ← save
mouse_wheel(coordinate=[500, 400], delta=-5)           ← scroll down
bind_window(action="unbind")             ← unbind
```

### Flow 3: operate by element name

```
bind_window(action="bind", title="Notepad")
screenshot                               ← returns screenshot + GUI elements list
click_element(name="Save", role="Button") ← UI Automation finds and clicks
type_into_element(role="Edit", text="new content")
```

### Flow 4: terminal interaction

```
bind_window(action="bind", title="PowerShell")
screenshot
prompt_respond(response_type="yes")      ← answers y + Enter
prompt_respond(response_type="select", arrow_direction="down", arrow_count=2)  ← pick the 3rd item
```

### Flow 5: Excel/browser scrolling

```
bind_window(action="bind", title="Excel")
screenshot
mouse_wheel(coordinate=[600, 400], delta=-10)            ← scroll down 10 notches
mouse_wheel(coordinate=[600, 400], delta=5, direction="horizontal")  ← scroll right
```

---

## App compatibility

| App type | SendMessageW (virtual_*) | Element operations (click_element) | Notes |
|---------|--------------------------|------------------------|------|
| Classic Win32 (Notepad/WordPad) | ✅ | ✅ | Fully supported |
| Office (Excel/Word) | ✅ (COM automation) | ✅ | Through the COM API |
| WPF apps | ✅ | ✅ | Standard UIA support |
| Electron/Chrome | ⚠️ Partial | ⚠️ Partial | Internal rendering does not use Win32 messages |
| UWP/WinUI (Windows Terminal) | ❌ | ❌ | ConPTY does not accept SendMessageW |
| Web page content in browsers | ❌ | ❌ | Needs global SendInput |

**For apps that do not support SendMessageW**, use the general tools (`left_click`/`type`/`key`) and first activate the window with `window_management(action="focus")`.

---

## Visuals while a window is bound

Binding a window automatically starts three layers of visuals:

1. **DWM green border** — the window's own border turns green, with zero offset
2. **Virtual mouse cursor** — a red arrow icon that follows virtual_mouse operations and blinks on click
3. **Status indicator** — a floating label at the bottom of the window showing the current operation (controlled through status_indicator)

---

## Accessibility Snapshot

On every `screenshot`, if a window is bound, a GUI element list is attached automatically:

```
GUI elements in this window:
[Button] "Save" (120,50 80x30) enabled
[Edit] "" (200,80 400x25) enabled value="hello" id=textBox1
[MenuItem] "File" (10,0 40x25) enabled
[MenuItem] "Edit" (50,0 40x25) enabled
[CheckBox] "Auto-save" (300,50 100x20) enabled id=chkAutoSave
```

The model receives both the **screenshot image and a structured element list**, and can choose to:
- Operate by coordinates: `virtual_mouse(action="click", coordinate=[120, 50])`
- Operate by name: `click_element(name="Save")`

---

## UI Automation Control Patterns reference

`click_element` / `type_into_element` use UI Automation Control Patterns underneath. What is implemented now and what could be added:

| Pattern | Purpose | Status | Used for |
|---------|------|---------|--------|
| `InvokePattern` | Trigger a click | ✅ Implemented (`click_element`) | Buttons, menu items, links |
| `ValuePattern` | Read/write text values | ✅ Implemented (`type_into_element`) | Text boxes, combo boxes |
| `TogglePattern` | Toggle state | ❌ Not implemented | Checkboxes, switches |
| `SelectionPattern` | Select items | ❌ Not implemented | Dropdown menus, lists |
| `ScrollPattern` | Programmatic scrolling | ❌ Not implemented (`mouse_wheel` is used instead) | Lists, trees, panes |
| `ExpandCollapsePattern` | Expand/collapse | ❌ Not implemented | Tree nodes, collapsible panels |
| `WindowPattern` | Window operations | ❌ Not implemented (`window_management` is used instead) | Maximize/close windows |
| `TextPattern` | Read document text | ❌ Not implemented | Documents, rich text |
| `GridPattern` | Table operations | ❌ Not implemented | Excel cells, data grids |
| `TablePattern` | Table structure | ❌ Not implemented | Headers, row/column relationships |
| `RangeValuePattern` | Range value operations | ❌ Not implemented | Sliders, progress bars |
| `TransformPattern` | Move/resize | ❌ Not implemented | Draggable elements |

**Extension roadmap:** implement `TogglePattern` (checkboxes) and `SelectionPattern` (dropdown menus) first, since they are the most common in form automation.

---

## Screen capture approaches compared

Screenshots currently go through the Python bridge (mss), which uses GDI BitBlt underneath. The three approaches compared:

| Approach | API | Status | Performance | Strengths | Limits |
|------|-----|---------|------|------|------|
| **GDI BitBlt** | `BitBlt` / `PrintWindow` | ✅ In use (mss/bridge.py) | ~300ms | Simple and stable, supports background windows (PrintWindow) | No hardware-accelerated content, awkward DPI handling |
| **DXGI Desktop Duplication** | `IDXGIOutputDuplication` | ❌ Not implemented | ~16ms (60fps) | Hardware accelerated, supports HDR, direct GPU reads | No single-window capture, needs D3D11 |
| **Windows.Graphics.Capture** | `GraphicsCaptureItem` | ❌ Not implemented | ~16ms | Newest API, supports single window/single display, system-level permission management | Win10 1903+, needs user confirmation the first time |

### Recommended upgrade path

```
Now: GDI BitBlt (mss) ─── full screen ~300ms, window ~300ms (PrintWindow)
  │
  ├─ Near term: DXGI Desktop Duplication ─── full screen ~16ms, but no single-window support
  │
  └─ Long term: Windows.Graphics.Capture ─── both full screen and single window ~16ms
```

### DXGI Desktop Duplication implementation notes

```python
# DXGI capture can be added in bridge.py (via the d3dshot or dxcam library)
import dxcam  # pip install dxcam

camera = dxcam.create()
frame = camera.grab()  # numpy array, ~5ms
# Convert to JPEG base64 and send
```

### Windows.Graphics.Capture implementation notes

```python
# Needs the WinRT Python bindings
# pip install winrt-Windows.Graphics.Capture winrt-Windows.Graphics.DirectX
# Limitation: the first call needs the user to confirm permission in a system dialog
```

---

## Input method matrix

Different app types need different input methods:

| Input method | API | Strengths | Limits | Suitable apps |
|---------|-----|------|------|---------|
| **SendMessageW** | `WM_CHAR` / `WM_KEYDOWN` | Does not steal focus, real mouse/keyboard untouched | Not supported by modern apps | Classic Win32 apps (Notepad/Office/WPF) |
| **SendInput** | `INPUT` struct | Works with every app | **Needs foreground focus**, disturbs the user | All apps (general fallback) |
| **WriteConsoleInput** | Console API | Writes directly into the console buffer | Needs AttachConsole (may be refused) | cmd/PowerShell (not Windows Terminal) |
| **UI Automation** | `InvokePattern` / `ValuePattern` | Semantic-level operation, most reliable | Some apps do not expose UIA | Apps that support UIA |
| **COM Automation** | Excel/Word COM | Full programmatic control | Office apps only | Excel / Word |
| **Clipboard + paste** | `SetClipboardData` + `Ctrl+V` | Bypasses input restrictions | Overwrites the user's clipboard | General fallback |

### Recommended input strategy by app type

| App type | First choice | Fallback | Notes |
|---------|------|------|------|
| Classic Win32 (Notepad/WordPad) | SendMessageW | UIA ValuePattern | Virtual input works perfectly |
| Office (Excel/Word) | COM Automation | SendMessageW | COM provides structured operations |
| WPF apps | SendMessageW | UIA | Standard Win32 message loop |
| Electron/Chrome apps | UIA | Clipboard paste | Internal rendering does not use Win32 |
| Windows Terminal (ConPTY) | SendInput (needs foreground) | Clipboard paste | ConPTY does not accept external messages |
| UWP/WinUI apps | SendInput (needs foreground) | UIA | XAML rendering does not use Win32 messages |

---

## Known limitations and open items

| Limitation | Impact | Plan |
|------|------|------|
| Windows Terminal does not accept SendMessageW | Virtual keyboard/mouse have no effect on terminals | Detect the app type automatically and switch terminal-class apps to SendInput + brief activation |
| PrintWindow cannot capture the alternate screen buffer | The Ink REPL screen cannot be captured | Switch to Windows.Graphics.Capture |
| Accessibility Snapshot is slow for large apps (>30s) | Complex apps such as Excel time out | Limit traversal depth + timeout protection |
| DWM border may not work for apps with custom title bars | The border is not visible in some Electron apps | Detect and fall back to an overlay window approach |
| The virtual cursor is a PowerShell WinForms process | Slow startup (~1s) and resource usage | Consider replacing it with a native Win32 window |

---

## Technical roadmap

### Phase 1 (current): basic functionality
- ✅ SendMessageW virtual input
- ✅ PrintWindow/mss screenshots
- ✅ UI Automation (InvokePattern + ValuePattern)
- ✅ Accessibility Snapshot
- ✅ DWM border indicator
- ✅ Python bridge

### Phase 2 (near term): compatibility improvements
- ⬜ Automatic app type detection (Win32 vs Terminal vs UWP)
- ⬜ Automatic switch to SendInput + brief activation for terminal-class apps
- ⬜ TogglePattern / SelectionPattern support
- ⬜ High-speed DXGI Desktop Duplication screenshots
- ⬜ Accessibility Snapshot timeout protection

### Phase 3 (long term): advanced capabilities
- ⬜ Windows.Graphics.Capture (real-time single-window screenshots)
- ⬜ Screenshot element annotation (marking ID numbers on the screenshot)
- ⬜ Browser DOM extraction (extract the page structure when a browser is bound)
- ⬜ GridPattern / TablePattern (cell-level Excel operations)
- ⬜ TextPattern (reading document content)
- ⬜ Multi-window coordinated operation
