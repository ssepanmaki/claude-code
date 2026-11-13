# Pipes + LAN Pipes: Complete Feature Guide

## Overview

The Pipes system provides communication between Claude Code CLI instances, in two layers:

1. **Pipes (same machine)**: multiple CLI instances on one machine cooperate over UDS (Unix Domain Socket / Windows Named Pipe).
2. **LAN Pipes (local network)**: CLI instances on different machines cooperate over TCP + UDP multicast.

Both layers use the same protocol (NDJSON) and the same commands (`/pipes`, `/attach`, `/send`, and so on), so the difference is transparent to the user.

## Feature Flags

| Flag | Scope | Default |
|------|----------|------|
| `UDS_INBOX` | All same-machine Pipe IPC features | enabled in dev/build |
| `LAN_PIPES` | LAN TCP + beacon extensions | enabled in dev/build |

Enable manually: `FEATURE_UDS_INBOX=1 FEATURE_LAN_PIPES=1 bun run dev`

## Quick start

### Multiple instances on one machine

```bash
# Terminal 1
bun run dev
# registers itself as main on startup

# Terminal 2
bun run dev
# registers itself as sub-1 and is attached automatically by main
```

Type `/pipes` in terminal 1 to see both instances. After selecting sub-1, messages you type are forwarded to sub-1 for execution.

### Multiple machines on a LAN

```bash
# Machine A (192.168.50.22)
bun run dev

# Machine B (192.168.50.27)
bun run dev
```

After both sides start, wait 3-5 seconds (the beacon broadcast interval). LAN peers are discovered and attached automatically. Type `/pipes` to see remote instances marked `[LAN]`.

### Firewall configuration (needed on both machines)

**Windows** (administrator PowerShell):
```powershell
New-NetFirewallRule -DisplayName "Claude Code LAN Beacon (UDP)" -Direction Inbound -Protocol UDP -LocalPort 7101 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "Claude Code LAN Pipes (TCP)" -Direction Inbound -Protocol TCP -LocalPort 1024-65535 -Program (Get-Command bun).Source -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "Claude Code LAN Beacon Out (UDP)" -Direction Outbound -Protocol UDP -RemotePort 7101 -Action Allow -Profile Private
# Confirm the network is "Private": Get-NetConnectionProfile
```

**macOS** (the system shows a dialog on first run; click "Allow"):
```bash
# If you need to open the pf firewall manually:
echo "pass in proto udp from any to any port 7101" | sudo pfctl -ef -
```

**Linux** (firewalld / iptables):
```bash
# firewalld
sudo firewall-cmd --zone=trusted --add-port=7101/udp --permanent
sudo firewall-cmd --zone=trusted --add-port=1024-65535/tcp --permanent
sudo firewall-cmd --reload

# or iptables
sudo iptables -A INPUT -p udp --dport 7101 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 1024:65535 -m owner --uid-owner $(id -u) -j ACCEPT
```

Confirm that the network is a LAN (not public WiFi) and that the router does not have AP isolation turned on.

## Interactive panel and shortcuts

### Status bar

After you run `/pipes`, a single-line pipe status bar appears at the bottom of the input box:

```
pipe: cli-a91bad56 (main) 192.168.50.22  2/3 selected  selected pipes only · ←/→ or m switch · Shift+↓ edit
```

The status bar stays visible until the session ends. It shows the current pipe name, role, IP, selected/total count, and routing mode.

### Expanding the selection panel

Press **Shift+↓** (Shift + Down arrow) to expand the selection panel:

```
pipe: cli-a91bad56 (main) 192.168.50.22  ↑↓ move Space select ←/→ or m route Enter/Esc close Shift+↓ toggle
  Ordinary prompts now go to the selected subs; switching does not clear the selection
  ☑ cli-da029538 (sub-1 XC/192.168.50.22)
  ☐ cli-04d67950 (main vmwin11/192.168.50.27)
  ☑ cli-893747d3 [offline] (sub-2 vmwin11/192.168.50.27)
```

### Shortcuts in the panel

| Shortcut | When | Action |
|--------|------|------|
| **Shift+↓** | Status bar visible | Expand/collapse the selection panel |
| **↑ / ↓** | Panel expanded | Move the cursor up and down |
| **Space** | Panel expanded | Toggle the selection of the pipe under the cursor (☑ ↔ ☐) |
| **Enter** | Panel expanded | Confirm and close the panel |
| **Esc** | Panel expanded | Cancel and close the panel |
| **← / → or M** | Status bar visible and a pipe is selected | Switch the routing mode (`selected pipes only` ↔ `local main`) |

### The M key: switching routing mode

The M key (or ← / →) switches between two routing modes, **without expanding the panel**:

| Mode | Status bar display | Behavior |
|------|-----------|------|
| `selected pipes only` | Highlighted green | The prompt you type is sent **only** to the selected pipes and is not run locally |
| `local main` | Gray | The prompt you type runs on the **local main** and is not forwarded to any pipe |

Switching the routing mode **does not clear the selection**. You can keep the selection while in `local main` mode and press M at any time to switch back to `selected pipes only` and continue sending to the remote.

### Example of a complete workflow

```
1. Type /pipes                       → the status bar appears, showing discovered instances
2. Press Shift+↓                     → expand the selection panel
3. Press ↓ to move to the target     → the cursor moves to cli-04d67950
4. Press Space                       → selects ☑ cli-04d67950
5. Press Enter                       → confirm; the panel collapses
6. Type "check git status for me"    → the prompt is sent to cli-04d67950 automatically
7. Press M                           → switch to local main mode
8. Type "do something locally"       → runs locally only
9. Press M                           → switch back to selected pipes only
10. Type "continue the remote task"  → sent to cli-04d67950 again
```

## Command reference

### /pipes

Shows all discovered instances and manages the selection state. Running `/pipes` again toggles the panel open or closed.

```
/pipes                    — show all instances + toggle the selection panel
/pipes select &lt;name&gt;      — select an instance (messages are broadcast to it)
/pipes deselect &lt;name&gt;    — deselect it
/pipes all                — select all
/pipes none               — deselect all
```

Example output:
```
Your pipe:   cli-a91bad56
Role:        main
Machine ID:  205d6c3a...
IP:          192.168.50.22
Host:        XC

Main machine: 205d6c3a... (this machine)
  [main] cli-a91bad56  XC/192.168.50.22  [alive] (you)
  ☑ [sub-1] cli-da029538  XC/192.168.50.22  [alive] [connected]

LAN Peers:
  ☐ [main] cli-04d67950  vmwin11/192.168.50.27  tcp:192.168.50.27:58853  [LAN]

Selected: cli-da029538
```

### /attach &lt;name&gt;

Manually attaches to an instance, making it your slave.

```
/attach cli-04d67950      — connect to the given pipe (the LAN TCP endpoint is resolved automatically)
```

After attaching, the other side becomes a slave and you become the master. You can send prompts to it. You usually do not need to attach manually, since the heartbeat discovers and connects automatically.

### /detach &lt;name&gt;

Disconnects from a slave.

```
/detach cli-04d67950
```

### /send &lt;name&gt; &lt;message&gt;

Sends a message to a specific pipe (independent of the selection state; the target is given directly).

```
/send cli-04d67950 please check the logs for me
/send tcp:192.168.50.27:58853 hello    — send directly to a TCP address
```

### /claim-main

Forcibly declares the current machine as main (used to recover after main exits unexpectedly).

## Message routing

### Automatic routing after selecting pipes

1. Select one or more pipes with `/pipes select` or the Shift+Down panel.
2. Type messages in the input box as usual.
3. The message is sent automatically to all selected, connected pipes.
4. Each pipe executes independently, and results stream back into main's message list.

### Routing modes

| Mode | Behavior |
|------|------|
| `selected` (default) | The message is sent to the selected pipes |
| `local` | The message runs locally only and is not forwarded |

## Architecture

### Communication protocol

All communication uses NDJSON (Newline-Delimited JSON), one message per line:

```json
{"type":"ping","from":"cli-abc","ts":"2026-04-11T00:00:00.000Z"}
{"type":"prompt","data":"check git status for me","from":"cli-abc","ts":"..."}
{"type":"stream","data":"Running...","from":"cli-def","ts":"..."}
{"type":"done","data":"","from":"cli-def","ts":"..."}
```

### Message types

| Type | Direction | Description |
|------|------|------|
| `ping`/`pong` | Both | Health check |
| `attach_request`/`accept`/`reject` | M→S/S→M | Connection control |
| `detach` | M→S | Disconnect |
| `prompt` | M→S | Master sends a prompt to a slave |
| `prompt_ack` | S→M | Slave acknowledges receipt |
| `stream` | S→M | Slave streams AI output back |
| `tool_start`/`tool_result` | S→M | Tool execution notifications |
| `done` | S→M | The turn is complete |
| `error` | Both | Error notification |
| `permission_request`/`response`/`cancel` | Both | Permission approval forwarding |

### Transport layer

```
                  Local                         LAN
            ┌──────────────┐            ┌──────────────┐
            │  PipeServer  │            │  PipeServer  │
            │   UDS sock   │            │   UDS sock   │
            │   TCP :rand  │◄───TCP───►│   TCP :rand  │
            ├──────────────┤            ├──────────────┤
            │  LanBeacon   │◄──UDP────►│  LanBeacon   │
            │  224.0.71.67 │  mcast     │  224.0.71.67 │
            └──────────────┘            └──────────────┘
```

- **UDS**: communication between instances on the same machine, addressed by file system path (`~/.claude/pipes/cli-xxx.sock`).
- **TCP**: communication between LAN instances, on a dynamic port, discovered through the beacon.
- **UDP multicast**: peer discovery, with an announce packet broadcast every 3 seconds.

### Role model

| Role | Description |
|------|------|
| `main` | The first instance started; manages the registry |
| `sub` | An instance started later on the same machine (or a LAN instance that was attached) |
| `master` | An instance that has attached at least one slave |
| `slave` | An instance attached and controlled by a master |

Role transitions:
- First to start → `main`
- Later start on the same machine → `sub` (attached automatically by main → `slave`)
- LAN discovery → both sides are `main`, and the heartbeat attaches them to each other automatically
- When attached → becomes `slave` (can be restored with `/detach`)

### Discovery mechanism

**Same machine**: through the `~/.claude/pipes/registry.json` file (with a file lock), with `machineId` bound to the host identity.

**LAN**: through a UDP multicast beacon:
1. Every 3 seconds it broadcasts `{ proto, pipeName, machineId, ip, tcpPort, role }`.
2. On receiving another instance's announce, it records it in the peers Map.
3. If nothing is received for 15 seconds, the peer is marked lost.
4. The heartbeat merges the local registry and the beacon peers into one attach-target list.

### Heartbeat loop (5-second interval)

```
main/master role:
  1. cleanupStaleEntries()        — remove dead entries from the registry
  2. getAliveSubs()               — get the live local subs
  3. refreshDiscoveredPipes()     — refresh discoveredPipes (including LAN peers)
  4. merge LAN peers into state
  5. build the unified attach-target list     — local subs + LAN peers
  6. iterate over unconnected targets → attach automatically
  7. clean up disconnected slave connections  — checks both the local registry and the beacon

sub role:
  1. check whether main is alive
  2. main is dead → on the same machine, take over the main role; across machines, run independently
```

## Key files

| File | Responsibility |
|------|------|
| `src/utils/pipeTransport.ts` | PipeServer (dual-mode UDS+TCP), PipeClient, type definitions |
| `src/utils/lanBeacon.ts` | UDP multicast beacon, singleton management |
| `src/utils/pipeRegistry.ts` | Registry CRUD, role determination, machineId, LAN merge |
| `src/utils/peerAddress.ts` | Address parsing (uds:/bridge:/tcp: schemes) |
| `src/screens/REPL.tsx` | Bootstrap, heartbeat, cleanup, prompt routing |
| `src/hooks/useMasterMonitor.ts` | Slave client registry, message subscription |
| `src/hooks/useSlaveNotifications.ts` | Slave-side notification handling |
| `src/commands/pipes/pipes.ts` | The /pipes command |
| `src/commands/attach/attach.ts` | The /attach command |
| `src/commands/send/send.ts` | The /send command |
| `packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.ts` | The AI message-sending tool (includes tcp: support) |

## Future improvements

### Security (P0)

1. **TCP authentication**: exchange an HMAC-SHA256 token (based on machineId + a session secret) on first connection to keep unauthorized devices from connecting.
2. **JSON schema validation**: add Zod validation at every `JSON.parse` entry point to prevent prototype pollution.
3. **Beacon info scrubbing**: hash the machineId before broadcasting so hardware serial numbers are not exposed.

### Reliability (P1)

4. **Multi-NIC selection**: `getLocalIp()` should prefer RFC 1918 addresses and exclude VPN/Docker interfaces.
5. **TCP target validation**: `parseTcpTarget()` should restrict targets to known beacon peers or the RFC 1918 range.
6. **PipeServer close()**: switch to `Promise.allSettled` to close UDS + TCP in parallel, with a `_closing` guard.

### Features (P2)

7. **mDNS/DNS-SD**: an alternative to the beacon in environments where multicast is restricted.
8. **Fixed port configuration**: let users specify a TCP port range so firewalls can be configured precisely.
9. **TLS encryption**: encrypt TCP transport to prevent eavesdropping by a man in the middle.
10. **Bidirectional prompts**: today the direction is only master → slave; consider letting a slave proactively send results/requests to the master.
