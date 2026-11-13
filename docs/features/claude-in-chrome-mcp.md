# Claude in Chrome — User guide

## 1. Overview

Claude in Chrome lets Claude Code control your Chrome browser directly. You can ask Claude in natural language to:

- Open web pages, navigate, go back and forward
- Fill in forms and upload images
- Take screenshots and record GIFs
- Read page content (DOM, plain text)
- Run JavaScript
- Monitor network requests and console logs
- Manage tabs

## 2. Prerequisites

| Requirement | Description |
|-------------|-------------|
| Claude Code subscription | A Claude Pro, Max or Team subscription is required; the browser extension is not available to free users |
| Chrome browser | Google Chrome must be installed |
| Claude in Chrome extension | Install from the Chrome Web Store (`claude.ai/chrome`) |
| Claude Code CLI | Running via `bun run dev` or a build artifact |

## 3. How to enable

### Dev mode

```bash
bun run dev -- --chrome
```

After startup, Claude automatically detects whether the Chrome extension is installed and registers the browser-control tools.

### Build artifact

```bash
node dist/cli.js --chrome
```

### Disable

```bash
bun run dev -- --no-chrome
```

Or toggle the enabled/disabled state with the `/chrome` command in the REPL.

### Enable by default through configuration

Set `claudeInChromeDefaultEnabled` to `true` in the Claude Code settings, and you no longer need the `--chrome` argument on later launches.

## 4. Workflow

1. **Start the CLI** — launch Claude Code with the `--chrome` argument
2. **Confirm the connection** — type `/chrome` in the REPL and check that the extension status shows "Installed / Connected"
3. **Start talking** — chat with Claude normally; when you need the browser, just say so, for example:
   - "Open https://example.com and take a screenshot"
   - "Search the current page for the keyword xxx"
   - "Fill in the login form with username admin"
   - "Record a GIF of what you are doing"
4. **Permission approval** — the first time a browser action runs, Claude asks for your confirmation
5. **Done** — after finishing, Claude returns the result (screenshot, text, execution result, etc.)

## 5. Available actions

### Page interaction

| Action | Description |
|--------|-------------|
| `navigate` | Navigate to a URL, or go forward/back |
| `computer` | Mouse click, move, drag, keyboard input, screenshots, etc. (13 actions) |
| `form_input` | Fill in form fields |
| `upload_image` | Upload an image to a file input or drop zone |
| `javascript_tool` | Run JavaScript in the page context |

### Page reading

| Action | Description |
|--------|-------------|
| `read_page` | Get the page accessibility tree (DOM structure) |
| `get_page_text` | Extract the page's plain text |
| `find` | Search for page elements in natural language |

### Tab management

| Action | Description |
|--------|-------------|
| `tabs_context_mcp` | Get information about the current tab group |
| `tabs_create_mcp` | Create a new tab |

### Monitoring and debugging

| Action | Description |
|--------|-------------|
| `read_console_messages` | Read the browser console log |
| `read_network_requests` | Read the network request records |

### Other

| Action | Description |
|--------|-------------|
| `resize_window` | Resize the browser window |
| `gif_creator` | Record a GIF and export it |
| `shortcuts_list` | List the available shortcuts |
| `shortcuts_execute` | Run a shortcut |
| `update_plan` | Submit an action plan to you for approval |
| `switch_browser` | Switch to another Chrome browser (Bridge mode only) |

## 6. Communication modes

Claude in Chrome supports two ways of talking to the browser:

### Local socket (default)

The Chrome extension establishes a Unix socket connection to the CLI through the Native Messaging Host. Suited to local development; no extra configuration is needed.

### Bridge WebSocket

Relayed through Anthropic's bridge service, supporting remote browser control. Requires a claude.ai OAuth login.

## 7. FAQ

### The extension shows as not installed

Make sure the "Claude in Chrome" extension was installed from the Chrome Web Store, and restart the browser after installing.

### The tools do not appear in the tool list

Check whether the `--chrome` argument was added at startup, or confirm the status with the `/chrome` command.

### Connection timeout

Make sure Chrome is running and the extension is enabled. The Native Messaging Host is registered automatically when the extension is installed; if you reinstalled the extension, restart the browser.

### When you do not use the Chrome features

Just start normally without the `--chrome` argument. No browser-related modules are loaded and other features are unaffected.
