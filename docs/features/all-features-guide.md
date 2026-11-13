# Claude Code Best (CCB) — Complete Feature Guide

This document covers **all features** restored or added in this fork, organized by category. Each feature includes a description, usage, and examples.

---

## Contents

1. [Buddy companion system](#1-buddy-companion-system)
2. [Remote Control](#2-remote-control)
3. [Scheduled tasks /triggers](#3-scheduled-tasks-triggers)
4. [Voice Mode](#4-voice-mode)
5. [Chrome browser control](#5-chrome-browser-control)
6. [Computer Use](#6-computer-use)
7. [Feature Flags and GrowthBook](#7-feature-flags-and-growthbook)
8. [/ultraplan advanced planning](#8-ultraplan-advanced-planning)
9. [Daemon](#9-daemon)
10. [Pipe IPC multi-instance collaboration](#10-pipe-ipc-multi-instance-collaboration)
11. [LAN Pipes](#11-lan-pipes)
12. [Monitor background monitoring](#12-monitor-background-monitoring)
13. [Workflow scripts](#13-workflow-scripts)
14. [Coordinator multi-worker orchestration](#14-coordinator-multi-worker-orchestration)
15. [Proactive mode](#15-proactive-mode)
16. [History / Snip](#16-history--snip)
17. [Fork sub-agent](#17-fork-sub-agent)
18. [Other restored tools](#18-other-restored-tools)

---

## 1. Buddy companion system

**Feature Flag**: `BUDDY`

### Description
Buddy is a companion AI that runs in the background. While your main conversation continues, it asynchronously observes the session and offers suggestions.

### Usage
```bash
# Loaded automatically at startup (the feature is on by default)
bun run dev

# During a conversation, Buddy offers suggestions at suitable moments
# For example, while you are debugging, Buddy may suggest checking the logs
```

---

## 2. Remote Control

**Feature Flag**: `BRIDGE_MODE`

### Description
Control a Claude Code session remotely over WebSocket. Self-hosted private deployment is supported.

### Usage
```bash
# Start remote control mode
bun run dev -- remote-control

# Use a self-hosted server
CLAUDE_BRIDGE_BASE_URL=https://your-server.com CLAUDE_BRIDGE_OAUTH_TOKEN=your-token bun run dev --remote-control

# Or start it from within a session with the /remote-control command
/remote-control
```

### Commands
- `claude remote-control` / `claude rc` — start the remote control client
- `claude bridge` — same as above (alias)

---

## 3. Scheduled tasks /triggers

**Feature Flag**: `AGENT_TRIGGERS_REMOTE`

> The command was renamed from `/schedule` to `/triggers` to avoid a conflict with the bundled skill `schedule`. `/cron` is an alias.

### Description
Create remote agent tasks that run on a schedule, with cron expression support.

### Usage
```
/triggers create "Check dependency updates daily" --cron "0 9 * * *" --prompt "Check package.json for outdated dependencies and open an update PR"
/triggers list          — list all scheduled tasks
/triggers delete <id>   — delete a task
```

---

## 4. Voice Mode

**Feature Flag**: `VOICE_MODE`

### Description
Push-to-talk voice input. Audio is streamed over WebSocket to Anthropic STT (Nova 3). Requires Anthropic OAuth authentication (not an API key).

### Usage
```bash
# Make sure you are logged in via OAuth
claude auth login

# In a session, hold the configured key and speak
# On release, the speech is transcribed into text input
```

### Prerequisites
- Anthropic OAuth authentication (API key mode is not supported)
- System microphone permission

---

## 5. Chrome browser control

**Feature Flag**: `CHICAGO_MCP`

### Description
Control the browser through a Chrome extension: navigate, click, fill forms, take screenshots, and run JS.

### Usage
```bash
# Start with Chrome control
bun run dev -- --chrome

# Once the Chrome extension is installed, the AI can:
# - Open web pages and click buttons
# - Fill in forms
# - Capture page content
# - Execute JavaScript
```

### Tools available to the AI
- `navigate` — navigate to a URL
- `click` / `find` / `form_input` — page interaction
- `get_page_text` / `read_page` — read content
- `javascript_tool` — run JS
- `gif_creator` — record an action GIF

---

## 6. Computer Use

**Feature Flag**: `CHICAGO_MCP`

### Description
Cross-platform screen control: screenshots, keyboard and mouse simulation, and app management. Supports macOS and Windows; the Linux backend is still to be completed.

### Usage
```bash
# After startup the AI can call the screen control tools automatically
bun run dev

# The AI can:
# - Take screenshots of the screen or a window
# - Simulate keyboard input and mouse actions
# - List running applications
# - Use the clipboard
```

### Platform support
| Platform | Screenshot | Keyboard/mouse | App management |
|------|------|------|----------|
| macOS | ✅ | ✅ | ✅ |
| Windows | ✅ | ✅ | ✅ |
| Linux | ⏳ | ⏳ | ⏳ |

---

## 7. Feature Flags and GrowthBook

**Feature Flags**: `SHOT_STATS`, `PROMPT_CACHE_BREAK_DETECTION`, `TOKEN_BUDGET`

### Description
A local GrowthBook gate defaults mechanism that bypasses the remote feature flag service, so features stay available without network access.

### Usage
```bash
# Enable any feature through an environment variable
FEATURE_PROACTIVE=1 bun run dev

# dev and build modes each have their own default-enabled list
# See DEFAULT_FEATURES in scripts/dev.ts
```

### Key feature flags
| Flag | Description |
|------|------|
| `SHOT_STATS` | API call statistics |
| `TOKEN_BUDGET` | Token budget control |
| `PROMPT_CACHE_BREAK_DETECTION` | Prompt cache hit detection |

---

## 8. /ultraplan advanced planning

**Feature Flag**: `ULTRAPLAN`

### Description
An advanced multi-agent planning mode. It breaks a complex task into phases, and each phase can be assigned to a different agent and run in parallel.

### Usage
```
/ultraplan Implement a complete user authentication system, including registration, login, password reset, and OAuth integration
```

The AI will produce:
1. A task breakdown (multiple phases)
2. Agent assignment for each phase
3. A dependency graph
4. A parallel execution plan

---

## 9. Daemon

**Feature Flag**: `DAEMON`

### Description
Daemon mode lets Claude Code run as a long-lived background process that manages multiple workers.

### Usage
```bash
# Start the daemon
claude daemon start

# Check status
claude daemon status

# Stop
claude daemon stop

# Start the remote control server
bun run rcs
```

---

## 10. Pipe IPC multi-instance collaboration

**Feature Flag**: `UDS_INBOX`

### Description
Multiple Claude Code instances on the same machine discover each other and collaborate automatically over UDS (Unix Domain Socket / Windows Named Pipe). The first instance to start becomes main; later ones register as sub automatically.

### Usage

**Starting multiple instances**:
```bash
# Terminal 1
bun run dev
# → becomes main automatically

# Terminal 2
bun run dev
# → becomes sub-1 automatically and is attached by main
```

**Managing instances**:
```
/pipes                — show all instances; Shift+↓ expands the selection panel
/pipes select <name>  — select an instance
/pipes all            — select all
/pipes none           — deselect all
/attach <name>        — manually attach an instance
/detach <name>        — disconnect
/send <name> <msg>    — send a message to the given instance
/claim-main           — force this instance to claim main
/pipe-status          — show detailed status
/peers                — list all discovered peers
```

**Selection panel controls**:
1. Press `Shift+↓` to expand the panel
2. `↑/↓` moves the cursor
3. `Space` selects/deselects a pipe
4. `Enter` confirms and closes
5. `←/→` switches the routing mode (selected pipes ↔ local main)

**Message broadcast**:
After selecting pipes, messages you type are routed to all selected slaves for execution, and results stream back to main.

**Permission forwarding**:
When a slave runs a tool that needs permission (such as BashTool), the permission request is forwarded to main's confirmation queue.

---

## 11. LAN Pipes

**Feature Flag**: `LAN_PIPES`

### Description
Adds a TCP transport layer and UDP multicast discovery on top of Pipe IPC, enabling zero-configuration collaboration across machines.

### Usage

**Multiple machines on a LAN**:
```bash
# Machine A (192.168.50.22)
bun run dev

# Machine B (192.168.50.27)
bun run dev

# After both start, they discover and attach to each other within 3-5 seconds
# /pipes shows remote instances marked [LAN]
```

**Firewall configuration** (needed on every machine):

Windows (administrator PowerShell):
```powershell
New-NetFirewallRule -DisplayName "CCB LAN Beacon (UDP)" -Direction Inbound -Protocol UDP -LocalPort 7101 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "CCB LAN Pipes (TCP)" -Direction Inbound -Protocol TCP -LocalPort 1024-65535 -Program (Get-Command bun).Source -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "CCB LAN Beacon Out (UDP)" -Direction Outbound -Protocol UDP -RemotePort 7101 -Action Allow -Profile Private
```

macOS:
```bash
# On first run the system shows a dialog; click "Allow"
```

Linux:
```bash
sudo firewall-cmd --zone=trusted --add-port=7101/udp --permanent
sudo firewall-cmd --zone=trusted --add-port=1024-65535/tcp --permanent
sudo firewall-cmd --reload
```

**Notification format**:
```
# Local sub
Routed to [sub-1]; main can continue other tasks

# LAN peer
Routed to [main] vmwin11/192.168.50.27; main can continue other tasks
```

---

## 12. Monitor background monitoring

**Feature Flag**: `MONITOR_TOOL`

### Description
Runs a shell command in the background and continuously monitors its output (similar to the `watch` command). The AI can also call MonitorTool on its own.

### Usage

**User commands**:
```
/monitor tail -f /var/log/syslog
/monitor watch -n 5 docker ps
/monitor "while true; do curl -s localhost:3000/health; sleep 10; done"
```

**Viewing monitors**:
- Press `Shift+Down` to expand the background task panel
- Check the monitor output and status

**Windows compatibility**:
`watch -n <sec> <cmd>` is converted automatically to a PowerShell loop:
```powershell
while($true){ <cmd>; Start-Sleep -Seconds <sec> }
```

**AI invocation**:
The AI can call `MonitorTool` during a conversation to monitor logs, build output, and so on.

---

## 13. Workflow scripts

**Feature Flag**: `WORKFLOW_SCRIPTS`

### Description
Runs user-defined workflow scripts from the `.claude/workflows/` directory.

### Usage

**Creating a workflow**:
```bash
mkdir -p .claude/workflows
cat > .claude/workflows/deploy.sh << 'EOS'
#!/bin/bash
echo "Running tests..."
bun test
echo "Building..."
bun run build
echo "Deploying..."
EOS
chmod +x .claude/workflows/deploy.sh
```

**Listing available workflows**:
```
/workflows
```

**AI invocation**:
The AI can run workflows automatically through `WorkflowTool`:
```
Please run the deploy workflow
```

---

## 14. Coordinator multi-worker orchestration

**Feature Flag**: `COORDINATOR_MODE`

### Description
With coordinator mode on, the AI can automatically assign tasks to multiple workers that run in parallel.

### Usage
```
/coordinator       — toggle coordinator mode on/off
```

Once enabled, for complex tasks the AI will:
1. Analyze which parts of the task can run in parallel
2. Create worker branches automatically
3. Assign subtasks
4. Aggregate the results

---

## 15. Proactive mode

**Feature Flag**: `PROACTIVE` / `KAIROS`

### Description
When enabled, the AI initiates actions on its own (rather than only responding to user input), for example detecting file changes automatically or proposing optimizations.

### Usage
```
/proactive         — toggle proactive mode on/off
```

---

## 16. History / Snip

**Feature Flag**: `HISTORY_SNIP`

### Description
View and manage conversation history, with manual truncation to free up context window space.

### Usage
```
/history           — show a summary of the conversation history
/force-snip        — force-truncate the history at the current position
```

The AI can also truncate an overly long conversation automatically through `SnipTool`:
```
The conversation is too long, please snip the history
```

---

## 17. Fork sub-agent

**Feature Flag**: `FORK_SUBAGENT`

### Description
Forks an independent sub-agent from the current conversation context. It inherits the full session state and runs on its own.

### Usage
```
/fork              — fork a sub-agent from the current context
```

The sub-agent will:
- Inherit the entire current conversation history
- Run in an isolated execution environment
- Leave the main session state unaffected

---

## 18. Other restored tools

The following tools were restored from stubs to full implementations:

| Tool | Description | Usage |
|------|------|------|
| `SleepTool` | Pause execution for a given time | Called automatically by the AI in polling scenarios |
| `WebBrowserTool` | In-terminal web interaction | Called when the AI needs to view a web page |
| `SubscribePRTool` | Subscribe to GitHub PR changes | `/subscribe-pr` or called by the AI |
| `PushNotificationTool` | Send desktop notifications | Called by the AI when a long task finishes |
| `CtxInspectTool` | Inspect context window usage | The AI checks the remaining context space |
| `TerminalCaptureTool` | Capture the terminal screen | Called when the AI needs to see terminal output |
| `SendUserFileTool` | Send a file to the user | Called when the AI exports a file |
| `REPLTool` | Start a sub-REPL session | Called when the AI needs an independent interactive environment |
| `VerifyPlanExecutionTool` | Verify plan completion | Runs automatically after the AI finishes a plan |
| `SuggestBackgroundPRTool` | Suggest creating a background PR | Proposed when the AI finds a self-contained change |
| `ListPeersTool` | List discovered peers | Called when the AI queries multi-instance state |

---

## Appendix: All feature flags

| Flag | Default | Description |
|------|------|------|
| `BUDDY` | ✅ dev only | Companion system |
| `BRIDGE_MODE` | ✅ dev only | Remote control |
| `VOICE_MODE` | ✅ dev+build | Voice mode |
| `CHICAGO_MCP` | ✅ dev+build | Computer Use + Chrome |
| `AGENT_TRIGGERS_REMOTE` | ✅ dev+build | Scheduled tasks |
| `SHOT_STATS` | ✅ dev+build | API statistics |
| `TOKEN_BUDGET` | ✅ dev+build | Token budget |
| `PROMPT_CACHE_BREAK_DETECTION` | ✅ dev+build | Cache detection |
| `ULTRAPLAN` | ✅ dev+build | Advanced planning |
| `DAEMON` | ✅ dev+build | Background daemon |
| `UDS_INBOX` | ✅ dev only | Pipe IPC |
| `LAN_PIPES` | ✅ dev only | LAN control |
| `MONITOR_TOOL` | ✅ dev+build | Background monitoring |
| `WORKFLOW_SCRIPTS` | ✅ dev+build | Workflow scripts |
| `FORK_SUBAGENT` | ✅ dev+build | Sub-agent |
| `KAIROS` | ✅ dev+build | Kairos scheduling |
| `COORDINATOR_MODE` | ✅ dev+build | Multi-worker |
| `HISTORY_SNIP` | ✅ dev+build | History management |
| `CONTEXT_COLLAPSE` | ✅ dev+build | Context collapse |
| `ULTRATHINK` | ✅ dev+build | Extended thinking |
| `EXTRACT_MEMORIES` | ✅ dev+build | Automatic memory extraction |
| `VERIFICATION_AGENT` | ✅ dev+build | Verification agent |
| `KAIROS_BRIEF` | ✅ dev+build | Brief mode |
| `AWAY_SUMMARY` | ✅ dev+build | Away summary |
| `ACP` | ✅ dev+build | ACP protocol |
| `LODESTONE` | ✅ dev+build | Deep links |
| `BUILTIN_EXPLORE_PLAN_AGENTS` | ✅ dev+build | Built-in Explore/Plan agents |
| `AGENT_TRIGGERS` | ✅ dev+build | Local scheduled tasks |
| `BG_SESSIONS` | ✅ dev only | Background sessions |
| `TEMPLATES` | ✅ dev only | Template system |
| `TRANSCRIPT_CLASSIFIER` | ✅ dev only | Transcript classification |

Enable any flag manually:
```bash
FEATURE_FLAG_NAME=1 bun run dev
```
