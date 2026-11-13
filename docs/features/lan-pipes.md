# LAN Pipes — a guide to controlling multiple machines over a LAN

## What LAN Pipes is

LAN Pipes lets Claude Code instances on several machines discover each other and cooperate automatically over the local network. From one machine (main) you can drive Claude Code on others (sub): send prompts, view results, and approve permission requests, with zero configuration.

It extends the local Pipe IPC (`UDS_INBOX`) with a TCP transport layer and UDP multicast discovery.

## Prerequisites

- Two or more machines on the same LAN
- CCB installed on each machine, able to run `bun run dev`
- Feature flag `LAN_PIPES` (on by default in dev/build)
- The firewall allows UDP 7101 + dynamic TCP ports (see the configuration below)

## Quick start

### Step 1: configure the firewall

**Run this on every machine.**

**Windows** (administrator PowerShell):
```powershell
New-NetFirewallRule -DisplayName "CCB LAN Beacon (UDP)" -Direction Inbound -Protocol UDP -LocalPort 7101 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "CCB LAN Pipes (TCP)" -Direction Inbound -Protocol TCP -LocalPort 1024-65535 -Program (Get-Command bun).Source -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "CCB LAN Beacon Out (UDP)" -Direction Outbound -Protocol UDP -RemotePort 7101 -Action Allow -Profile Private
```

Verify the network is "Private" (not Public): `Get-NetConnectionProfile`

**macOS**:
On first run the system shows an "allow incoming connections" dialog; click "Allow".

If you use the pf firewall:
```bash
echo "pass in proto udp from any to any port 7101" | sudo pfctl -ef -
```

**Linux** (firewalld):
```bash
sudo firewall-cmd --zone=trusted --add-port=7101/udp --permanent
sudo firewall-cmd --zone=trusted --add-port=1024-65535/tcp --permanent
sudo firewall-cmd --reload
```

**Linux** (iptables):
```bash
sudo iptables -A INPUT -p udp --dport 7101 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 1024:65535 -m owner --uid-owner $(id -u) -j ACCEPT
```

### Step 2: start

```bash
# Machine A (for example 192.168.50.22)
bun run dev

# Machine B (for example 192.168.50.27)
bun run dev
```

After starting, wait 3-5 seconds (the beacon broadcast interval); both sides discover each other and connect automatically.

### Step 3: view and operate

On either machine:
```
/pipes
```

Example output:
```
pipe: cli-a91bad56 (main) 192.168.50.22  2/3 selected

Main machine: 205d6c3a... (this machine)
  [main] cli-a91bad56  XC/192.168.50.22  [alive] (you)
  ☑ [sub-1] cli-da029538  XC/192.168.50.22  [alive] [connected]

LAN Peers:
  ☐ [main] cli-04d67950  vmwin11/192.168.50.27  tcp:192.168.50.27:58853  [LAN]
```

### Step 4: select a target and send a task

1. Press `Shift+↓` to expand the selection panel
2. Use `↑↓` to move to the LAN peer
3. `Space` to select
4. `Enter` to confirm
5. Type a prompt; it is routed to the remote machine automatically

Remote results are streamed back into your message list:
```
[main vmwin11/192.168.50.27 / cli-04d67950] Checking git status...
[main vmwin11/192.168.50.27 / cli-04d67950] Completed
```

## Full command reference

| Command | Description |
|------|------|
| `/pipes` | Show all instances (local + LAN); Shift+↓ expands the selection panel |
| `/pipes select <name>` | Select an instance |
| `/pipes all` | Select all |
| `/pipes none` | Deselect all |
| `/attach <name>` | Attach manually (LAN peers are recognized and connected over TCP automatically) |
| `/detach <name>` | Disconnect |
| `/send <name> <msg>` | Send a message to the given pipe |
| `/send tcp:host:port <msg>` | Send directly to a TCP address |
| `/claim-main` | Force this instance to claim the main role |
| `/pipe-status` | Show detailed status |
| `/peers` | List all discovered peers |

## Keyboard shortcuts

| Shortcut | Context | Action |
|--------|------|------|
| `Shift+↓` | Status bar visible | Expand/collapse the selection panel |
| `↑ / ↓` | Panel expanded | Move the cursor |
| `Space` | Panel expanded | Select/deselect |
| `Enter` | Panel expanded | Confirm and close |
| `Esc` | Panel expanded | Cancel and close |
| `← / →` | A pipe is selected | Switch routing mode |
| `M` | Panel expanded | Same as ←/→, switches routing mode |

## Routing modes

| Mode | Display | Behavior |
|------|------|------|
| `selected pipes only` | Green | Prompts go only to selected pipes and do not run locally |
| `local main` | Gray | Prompts run only locally and are not forwarded |

Switching routing mode does not clear the selection.

## Permission forwarding

When a remote slave runs a tool that needs permission (such as BashTool):
1. The slave sends a `permission_request` to main
2. Main shows a permission dialog labeled `[role hostname/ip / pipeName]`
3. The user approves or denies
4. The result is sent back to the slave, which continues or aborts

## How it works

### Discovery

- Each machine creates a UDP multicast beacon at startup
- Group address `224.0.71.67`, port `7101`, TTL=1 (does not cross routers)
- It broadcasts its own information (pipeName, IP, TCP port, role) every 3 seconds
- A peer is marked lost after 15 seconds without a broadcast

### Communication

- Same-machine instances: UDS (Unix Domain Socket / Named Pipe)
- Across machines: TCP (dynamic port, discovered through the beacon)
- Protocol: NDJSON (one JSON object per line)
- Message types: ping/pong, attach/detach, prompt/stream/done/error, permission

### Role model

| Role | Description |
|------|------|
| `main` | The first instance to start |
| `sub` | Instances started later on the same machine |
| `master` | An instance that has attached at least one slave |
| `slave` | An instance attached by a master |

For cross-machine attach, either side can be main; the other side does not have to be a sub.

## FAQ

### Cannot see LAN peers

1. Check that the firewall allows UDP 7101
2. On Windows, run `Get-NetConnectionProfile` to confirm the network is "Private"
3. Confirm both machines are on the same subnet (`ping` works)
4. Make sure AP isolation is off on the router

### Connection timeout

1. Check the inbound TCP firewall rule
2. Make sure no VPN is hijacking traffic
3. Try `/send tcp:ip:port hello` to test directly

### Beacon bound to the wrong network adapter

On Windows, WSL/Docker virtual adapters can hijack multicast. The beacon automatically picks a non-internal IPv4 interface. If it picks the wrong one, check the return value of `getLocalIp()`.

## Security notes

- TCP connections currently have **no authentication**: anyone on the same LAN who knows the port can connect
- Multicast TTL=1, so traffic does not cross routers
- When the AI sends a `tcp:` message through `SendMessageTool`, **explicit user confirmation** is required
- Use it only on trusted LANs
