# WEB_BROWSER_TOOL — Browser Tool

> Feature Flag: `FEATURE_WEB_BROWSER_TOOL=1`
> Implementation status: the core tool is implemented, the panel is a stub, wiring is complete
> References: 4

## 1. Overview

WEB_BROWSER_TOOL lets the model launch a browser instance, navigate web pages and interact with page elements. It uses Bun's built-in WebView API to provide headless/headed browser capability.

## 2. Implementation architecture

### 2.1 Module status

| Module | File | Status |
|--------|------|--------|
| Browser panel | `packages/builtin-tools/src/tools/WebBrowserTool/WebBrowserPanel.ts` | **Stub** — returns null |
| Browser tool | `packages/builtin-tools/src/tools/WebBrowserTool/WebBrowserTool.ts` | **Implemented** |
| REPL integration | `src/screens/REPL.tsx` | **Wired** — renders WebBrowserPanel |
| Tool registration | `src/tools.ts` | **Wired** — dynamic loading |
| WebView detection | `src/main.tsx` | **Wired** — `'WebView' in Bun` check |

### 2.2 Expected data flow

```
Model calls WebBrowserTool
         │
         ▼
Bun WebView creates a browser instance
         │
         ├── navigate(url) — go to a URL
         ├── click(selector) — click an element
         ├── screenshot() — take a page screenshot
         └── extract(selector) — extract page content
         │
         ▼
Result is returned to the model
         │
         ▼
WebBrowserPanel shows the browser state beside the REPL
```

## 3. What still needs to be completed

| Module | Effort | Description |
|--------|--------|-------------|
| `WebBrowserTool.ts` | ✅ Implemented | Tool schema + execution through the Bun WebView API |
| `WebBrowserPanel.tsx` | Medium | Browser-state side panel for the REPL (still a stub) |

## 4. Key design decisions

1. **Bun WebView API**: uses Bun's built-in WebView rather than an external browser driver (Puppeteer/Playwright)
2. **REPL side panel**: the browser state is rendered independently in the REPL layout
3. **Bun feature detection**: `'WebView' in Bun` checks whether the runtime supports it

## 5. Usage

```bash
FEATURE_WEB_BROWSER_TOOL=1 bun run dev
```

## 6. File index

| File | Responsibility |
|------|----------------|
| `packages/builtin-tools/src/tools/WebBrowserTool/WebBrowserPanel.ts` | Panel component (stub) |
| `packages/builtin-tools/src/tools/WebBrowserTool/WebBrowserTool.ts` | Tool implementation (implemented) |
| `src/screens/REPL.tsx:471,5676` | Panel rendering |
| `src/tools.ts:115-116` | Tool registration |
