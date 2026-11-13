# Background Agent Selector — Unified Bottom Switcher for Background Agents

> Feature Flag: none (enabled directly)
> Implementation status: fully usable
> Depends on: the existing `viewingAgentTaskId` / `enterTeammateView` / `exitTeammateView` mechanisms

## 1. Overview

The Background Agent Selector is a persistent status bar rendered below the PromptInput. It lists all **backgrounded local_agent tasks**, including fork agents spawned by `/fork` and sub-agents spawned by Task/AgentTool calls with `run_in_background: true`. The user can press ↑/↓ to move focus between `main` and the individual agents, and press Enter to replace the REPL main view with the selected agent's live transcript. Selecting `main` and pressing Enter returns to the main conversation.

The whole mechanism reuses the existing teammate transcript viewing infrastructure. It introduces no new view layer or data flow, and only adds one footer pill type.

### Core features

- **Unified entry**: `/fork`, Task-spawned subagents, and every agent with `run_in_background: true` appear in the same bar
- **In-place switching**: with an empty prompt, pressing ↓ overflows into the bottom selector, ↑↓ selects a row, and Enter switches the main view
- **Live status**: each row shows agent type + description + elapsed time + tokens consumed; the dot is green while running
- **Keep-alive view**: after an agent finishes it is kept for a grace window (`evictAfter`) so the user can look back
- **Zero UI intrusion**: when there are 0 tasks the selector is not rendered at all and takes no screen height
- **Coexists with the old Dialog**: the existing behavior of `BackgroundTasksDialog` (opened with Shift+↓) is preserved; the selector is only a display + quick-switch surface

## 2. User interaction

### How it appears

When any background agent exists, the selector appears automatically below the `bypass permissions on` line:

```
  claude-code | Opus 4.7 (1M context) | ctx:4%
  ▶▶ bypass permissions on (shift+tab to cycle)

  ○ main                                    ↑/↓ to select · Enter to view
  ● Explore  Research src/hooks              23s · ↓ 10.9k tokens
  ○ Explore  Research src/components         22s · ↓  9.5k tokens
  ○ Explore  Research src/utils              21s · ↓ 13.6k tokens
```

### Keyboard routing

| Location / state | Key | Behavior |
|---|---|---|
| PromptInput non-empty | ↑↓ | Cursor movement / history navigation (unchanged) |
| PromptInput empty + at bottom of history | ↓ | Focus moves down into the selector, highlighting `● main` |
| Selector focused (`footerSelection === 'bg_agent'`) | ↓ | Highlight moves down, -1 → 0 → ... → N-1 |
| Selector focused | ↑ | Highlight moves up; pressing ↑ again on `main` returns focus to PromptInput |
| Selector focused | Enter | `-1` → `exitTeammateView`; `>=0` → `enterTeammateView(agentId)`. Focus stays on the pill |
| Selector focused | Esc | `footer:clearSelection`, focus returns to PromptInput |

### Visual rules

- `● main` / `● <agent>`: the row currently being **viewed** (pointed to by viewingAgentTaskId) or **focused by the cursor** (when the pill is focused, the cursor wins)
- Running agents: the dot is rendered in the `success` color (green), matching the status semantics of `BackgroundTasksDialog`
- The hint at the top right changes with state:
  - Pill focused: `↑/↓ to select · Enter to view`
  - A running agent is selected: `shift+↓ to manage · x to stop`
  - A terminal agent is selected: `shift+↓ to manage · x to clear`
  - No agent selected: `shift+↓ to manage background agents`

## 3. Implementation architecture

### 3.1 Data layer: `useBackgroundAgentTasks`

File: `src/hooks/useBackgroundAgentTasks.ts`

Wraps the filtering of `useAppState(s => s.tasks)`:

```ts
export function useBackgroundAgentTasks(): LocalAgentTaskState[] {
  const tasks = useAppState(s => s.tasks)
  return useMemo(() => {
    const now = Date.now()
    return Object.values(tasks)
      .filter(isLocalAgentTask)
      .filter(t => t.agentType !== 'main-session')
      .filter(t => t.isBackgrounded !== false)
      .filter(t => t.evictAfter === undefined || t.evictAfter > now)
      .sort((a, b) => a.startTime - b.startTime)
  }, [tasks])
}
```

Both `/fork` and `AgentTool` with `run_in_background: true` go through `registerAsyncAgent → runAsyncAgentLifecycle` and end up writing to the same `appState.tasks` Map. This hook is the single data source, and both the Selector and PromptInput's `bgAgentList` consume it.

### 3.2 State layer: two new fields

File: `src/state/AppStateStore.ts`

```ts
export type FooterItem =
  | 'tasks' | 'tmux' | 'bagel' | 'teams' | 'bridge' | 'companion'
  | 'bg_agent'   // ← new

export type AppState = DeepImmutable<{
  // ...
  selectedBgAgentIndex: number  // -1 = main, 0..N-1 = selected agent
}>
```

- `'bg_agent'` joins the footer pill system as a `FooterItem`, so it gets the existing `footer:up` / `footer:down` / `footer:openSelected` keybinding routing
- `selectedBgAgentIndex` records the selector's cursor position and is independent of `viewingAgentTaskId` ("what is being viewed"); it cannot be derived from `viewingAgentTaskId`, because after Enter the cursor stays on the pill for further navigation and only the viewing target changes

### 3.3 Keyboard routing: the PromptInput footer pill branch

File: `src/components/PromptInput/PromptInput.tsx`

1. **`bg_agent` goes in footerItems[0]**: this ensures that when ↓ overflows from the prompt (`handleHistoryDown` → `selectFooterItem(footerItems[0])`) it goes straight into the selector rather than another pill such as `tasks`
2. **`footer:up` branch**: when `bgAgentSelected`, decrement `selectedBgAgentIndex` if it is > -1; at -1 call `selectFooterItem(null)` to leave the pill
3. **`footer:down` branch**: increment if `selectedBgAgentIndex < bgAgentList.length - 1`, clamping at the bottom
4. **`footer:openSelected` branch**: index === -1 → `exitTeammateView`; otherwise `enterTeammateView(bgAgentList[i].agentId)`. **Pill focus is not cleared**, so the cursor stays on the selector for continued navigation
5. **`selectFooterItem('bg_agent')`**: resets `selectedBgAgentIndex = -1` on entering the pill (the cursor lands on `main`)

### 3.4 Rendering layer: `BackgroundAgentSelector`

File: `src/components/tasks/BackgroundAgentSelector.tsx`

A purely presentational component that does not subscribe to the keyboard:

```tsx
const tasks = useBackgroundAgentTasks()
const viewingId = useAppState(s => s.viewingAgentTaskId)
const footerSelection = useAppState(s => s.footerSelection)
const selectedBgIndex = useAppState(s => s.selectedBgAgentIndex)

if (tasks.length === 0) return null

const pillFocused = footerSelection === 'bg_agent'
const highlightedId = pillFocused
  ? (selectedBgIndex === -1 ? null : tasks[selectedBgIndex]?.agentId ?? null)
  : (viewingId ?? null)
```

**Highlight derivation rule**: when the pill is focused, follow `selectedBgAgentIndex`; when unfocused, mirror `viewingAgentTaskId`. This way, when the user switches views through the Shift+↓ Dialog or any other route to `enterTeammateView`, the selector reflects it correctly.

### 3.5 Main view switching: reusing `viewingAgentTaskId`

The REPL.tsx body still reuses the original viewing logic:

```ts
const viewedTask = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined
const viewedAgentTask = ... (isLocalAgentTask(viewedTask) ? viewedTask : undefined)
const displayedMessages = viewedAgentTask ? displayedAgentMessages : messages
```

When `enterTeammateView(agentId)` sets `viewingAgentTaskId` to a local_agent's id:

- `viewedAgentTask` resolves to that agent
- `displayedMessages` switches to the agent's messages
- The message list, spinner, unseen divider and the rest re-render automatically with the agent transcript
- The main conversation stream is "paused" (not destroyed, and picks up where it left off when you return to `main`)

`enterTeammateView` is also responsible for: setting `retain: true` to block eviction, clearing `evictAfter`, and triggering a disk bootstrap that loads the full transcript from `agent-<id>.jsonl` into `task.messages`.

#### Fork agent prompt normalization

A `/fork` agent's transcript differs from a normal subagent's: it inherits the main agent's context, and its real initial message shape is:

```text
...parent messages
assistant([...tool_use])
user([tool_result..., text("<fork-boilerplate>...Your directive: <prompt>")])
...fork live messages
```

The prompt text is mixed into a multi-block `[tool_result..., text]` user message. The message rendering pipeline treats this user message as tool-result plumbing first, so the user prompt inside `<fork-boilerplate>` is not reliably visible. To make sure the user-initiated fork prompt is always visible when switching to a fork agent, REPL.tsx applies a display-layer normalization to the fork view:

1. Enabled only when `viewedAgentTask.agentType === 'fork'`, so ordinary Explore / Task subagents are unaffected.
2. Identify the carrier message containing `<fork-boilerplate>` in the raw messages.
3. Strip the boilerplate text block from the carrier message but keep the `tool_result` blocks, so the link to the parent assistant `tool_use` is not broken.
4. Force-insert a separate `createUserMessage({ content: viewedAgentTask.prompt })` as the visible user prompt.
5. The insertion point is preferably right after the boilerplate carrier; if the sidechain bootstrap has not yet read the carrier, insert after the last inherited `assistant tool_use`, so the prompt follows the main context instead of ending up at the top of the view.

This normalization only affects the `displayedAgentMessages` used for UI display. It does not write back to `task.messages` and does not change the fork transcript sent to the model.

### 3.6 Lifecycle

Fully reuses the existing mechanisms:

- **Running**: the `isBackgroundTask()` predicate is true, and the selector lists it
- **Completed / failed / aborted**: `completeAgentTask` / `failAgentTask` / `killAsyncAgent` set `status` to a terminal value
- **Exit after revisit**: `exitTeammateView` calls `release(task)`, which clears `retain`, clears `messages`, and in a terminal state sets `evictAfter = now + PANEL_GRACE_MS (30s)`
- **evictAfter expires**: `useBackgroundAgentTasks` naturally filters it out and the selector row disappears
- **Manual dismissal**: `stopOrDismissAgent(taskId)` sets `evictAfter = 0`, and it disappears immediately

## 4. Design decisions

1. **Single data source**: `useBackgroundAgentTasks` is the only filtering point, and PromptInput reuses it too, so filter conditions are not scattered
2. **Pill focus retained**: after Enter switches the view, focus is not released, so ↑↓ can keep navigating, which is close to the official experience
3. **`bg_agent` in footerItems[0]**: ensures ↓ overflow goes straight into the selector rather than another pill
4. **The selector does not subscribe to the keyboard**: all key routing is centralized in PromptInput's `footer:*` branches, avoiding conflicts from double `useInput` in the selector component and PromptInput
5. **`selectedBgAgentIndex` lives in AppState rather than local state**: the selector and PromptInput are in two different subtrees and need a global field to coordinate; the value cannot be derived from `viewingAgentTaskId`
6. **Coexists with `BackgroundTasksDialog`**: Shift+↓ behavior is completely unchanged and the selector is a supplementary quick entry; the Dialog still manages task types the selector does not show, such as shell / workflow / monitor_mcp
7. **Display-layer fallback for the fork prompt**: the fork prompt does not rely on the boilerplate rendering itself; a separate user message is synthesized in `displayedAgentMessages`. Ordinary subagents do not take this branch, avoiding a duplicated prompt

## 5. Key API reuse

| Existing capability | How the selector uses it |
|---|---|
| `AppState.tasks` | Single data source, no file watcher / output JSONL subscription needed |
| `registerAsyncAgent` | Shared by `/fork` and AgentTool; the selector does not distinguish the source |
| `enterTeammateView(id)` | Called on Enter; handles retain + disk bootstrap |
| `exitTeammateView` | Called when Enter selects `main` |
| `release(task)` + `PANEL_GRACE_MS` | 30s keep-alive, applied to the selector automatically |
| `useElapsedTime` | Per-row elapsed time; the interval stops automatically when not running |
| `formatTokens` (`utils/format.ts`) | Abbreviates token counts to 1k |
| `footer:up` / `footer:down` / `footer:openSelected` keybindings | Keyboard routing reuses the Footer context |

## 6. File index

| File | Responsibility |
|------|------|
| `src/hooks/useBackgroundAgentTasks.ts` | Data filtering hook (backgrounded local_agent + evictAfter filter + startTime sort) |
| `src/components/tasks/BackgroundAgentSelector.tsx` | Bottom selector UI, purely presentational |
| `src/components/PromptInput/PromptInput.tsx` | Adds the `'bg_agent'` footer pill + the matching `footer:up/down/openSelected` branches |
| `src/state/AppStateStore.ts` | Adds `'bg_agent'` to `FooterItem`; adds the `selectedBgAgentIndex` field |
| `src/main.tsx` | `getDefaultAppState` also initializes `selectedBgAgentIndex: -1` |
| `src/screens/REPL.tsx` | Mounts `<BackgroundAgentSelector />` after PromptInput + SessionBackgroundHint; switches the agent main view; normalizes the prompt in fork transcripts |
| `src/components/messages/AssistantToolUseMessage.tsx` | Adds a `defaultCollapsed?: boolean` prop, reserved for collapsing tool blocks by default in a future detail view |
| `src/components/messages/UserTextMessage.tsx` | Recognizes `<fork-boilerplate>` and hands it to the fork-specific renderer |
| `src/components/messages/UserForkBoilerplateMessage.tsx` | Collapses the fork boilerplate text into the plain user prompt; a compatibility path for in-place rendering in the transcript |

## 7. Known limitations

- `Date.now()` in the useMemo of `useBackgroundAgentTasks` is frozen at the moment `[tasks]` triggers: if no task change event arrives for a long time, a terminal agent whose grace period has expired will not disappear from the selector immediately and only refreshes on the next tasks change. In typical use (the main conversation keeps producing messages) this is not noticeable, so no extra interval has been added.
- The selector currently does not handle Shell Task / Workflow / Monitor MCP and similar types; those are still managed through `BackgroundTasksDialog` (Shift+↓).
- The `defaultCollapsed` prop of `AssistantToolUseMessage` currently has no caller passing a value; it is kept as an extension point for a future "collapse tool blocks by default in the agent detail view".
