# SSH Remote — Running Claude Code on a Remote Host

## Overview

SSH Remote provides two ways to run Claude Code on a remote Linux host:

1. **SSH Remote module** (`ccb ssh <host>`) — local REPL + remote tool execution, with automatic binary deployment + an authentication tunnel
2. **Direct SSH run** (`ssh <host> -t ccb`) — ccb is already installed remotely, and an interactive session is started directly

## Architecture

### Mode 1: SSH Remote module (full mode)

Use case: the remote host has no API credentials or no ccb installed.

```
┌──────────────── Local Windows/Mac/Linux ──────────┐
│                                                    │
│  ccb ssh <host> [dir]                              │
│     │                                              │
│     ├── 1. SSHProbe: probe remote platform/arch/existing binary │
│     ├── 2. SSHDeploy: deploy dist/ to the remote   │
│     ├── 3. SSHAuthProxy: start a local auth proxy  │
│     │      ├─ Unix Socket (Linux/Mac)              │
│     │      └─ TCP 127.0.0.1:<port> (Windows)       │
│     │                                              │
│     └── 4. SSH -R reverse tunnel + start remote CLI │
│            ssh -R <remote>:<local> <host> \         │
│                ANTHROPIC_BASE_URL=... \             │
│                ANTHROPIC_AUTH_NONCE=... \            │
│                ccb --output-format stream-json      │
│                                                    │
│  ┌─────── Local REPL (Ink TUI) ───────┐            │
│  │ User input → NDJSON → SSH stdin    │            │
│  │ SSH stdout → NDJSON → render messages │         │
│  │ Tool permission request → approve locally → send back │
│  └────────────────────────────────────┘             │
└────────────────────────────────────────────────────┘
                        │
                        │ SSH connection (encrypted channel)
                        │
┌───────────────── Remote Linux ────────────────────┐
│                                                    │
│  ccb (auto-deployed or already present)            │
│     ├── --output-format stream-json                │
│     ├── --input-format stream-json                 │
│     ├── --verbose -p                               │
│     │                                              │
│     ├── API request → ANTHROPIC_BASE_URL           │
│     │   → SSH reverse tunnel → local AuthProxy     │
│     │   → inject real credentials → api.anthropic.com │
│     │                                              │
│     └── Tool execution (Bash/Read/Write/...)       │
│         operates directly on the remote filesystem │
└────────────────────────────────────────────────────┘
```

### Mode 2: Direct SSH run (simple mode)

Use case: ccb is already installed on the remote host and it already has API credentials (a subscription or API key).

```
┌─────── Local terminal ──┐          ┌──────── Remote Linux ──────┐
│                         │   SSH    │                             │
│  ssh <host> -t ccb      │ ──────→  │  ccb (globally installed)   │
│                         │          │    ├── uses the remote's own credentials │
│  Terminal shows the remote TUI directly │  ←────── │    ├── operates on the remote filesystem │
│                         │   TTY    │    └── API direct to Anthropic │
└─────────────────────────┘          └─────────────────────────────┘
```

### Use case comparison

| | SSH Remote module | Direct SSH run |
|---|---|---|
| ccb must be installed remotely | No (auto-deployed) | Yes |
| Remote needs API credentials | No (local tunnel) | Yes |
| ccb must be installed locally | Yes | No (any terminal) |
| Slash commands | Handled locally | Handled remotely |
| Sensitive to network latency | High (two-way NDJSON) | Low (TTY only) |
| Recommended for | Remote has no credentials/no install | Remote is fully configured |

---

## Prerequisite: SSH key setup

Both modes rely on passwordless SSH. Here are the complete key setup steps.

### 1. Generate an SSH key pair (local)

```bash
# Generate an Ed25519 key (recommended)
ssh-keygen -t ed25519 -C "your-email@example.com" -f ~/.ssh/id_remote

# Or RSA 4096-bit
ssh-keygen -t rsa -b 4096 -C "your-email@example.com" -f ~/.ssh/id_remote
```

This generates two files:
- `~/.ssh/id_remote` — the private key (must not be leaked)
- `~/.ssh/id_remote.pub` — the public key (deployed to the remote)

### 2. Deploy the public key to the remote

```bash
# Option A: ssh-copy-id (recommended)
ssh-copy-id -i ~/.ssh/id_remote.pub user@remote-host

# Option B: copy manually
cat ~/.ssh/id_remote.pub | ssh user@remote-host "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

### 3. Configure SSH Config (local)

Edit `~/.ssh/config` (create it if it does not exist):

```
Host my-server
    HostName 192.168.1.100       # Remote IP or domain name
    User root                     # Remote username
    IdentityFile ~/.ssh/id_remote # Private key path
    ServerAliveInterval 60        # Prevent idle-timeout disconnects
    ServerAliveCountMax 3
```

After configuring, you can connect with the alias:

```bash
ssh my-server          # Equivalent to ssh -i ~/.ssh/id_remote root@192.168.1.100
```

### 4. File permission settings

#### Linux / macOS

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/config
chmod 600 ~/.ssh/id_remote
chmod 644 ~/.ssh/id_remote.pub
```

#### Windows (OpenSSH enforces ACL checks)

```powershell
# Reset .ssh directory permissions: allow only the current user + SYSTEM
icacls "$env:USERPROFILE\.ssh" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F"

# Fix config file permissions
icacls "$env:USERPROFILE\.ssh\config" /inheritance:r /grant:r "$($env:USERNAME):F" /grant "SYSTEM:F"

# Fix private key permissions
icacls "$env:USERPROFILE\.ssh\id_remote" /inheritance:r /grant:r "$($env:USERNAME):F" /grant "SYSTEM:F"
```

> **Common Windows error**: if `icacls` shows `UNKNOWN\UNKNOWN` ACL entries, remove them first and then grant permissions again. A permissions error makes SSH refuse to use the key.

### 5. Verify passwordless connection

```bash
ssh my-server "echo 'SSH connection OK'"
# Should print "SSH connection OK" directly, without asking for a password
```

---

## Usage

### Mode 1: SSH Remote module

```bash
# Basic usage — automatically probes, deploys, and starts
ccb ssh user@remote-host

# Use an SSH Config alias
ccb ssh my-server

# Specify the remote working directory
ccb ssh my-server /home/user/project

# Use a custom remote binary (skips probe/deploy)
ccb ssh my-server --remote-bin "bun /opt/ccb/dist/cli.js"

# Permission control
ccb ssh my-server --permission-mode auto
ccb ssh my-server --dangerously-skip-permissions

# Resume a remote session
ccb ssh my-server --continue
ccb ssh my-server --resume <session-uuid>

# Choose a model
ccb ssh my-server --model claude-sonnet-4-6-20250514

# Local test mode (does not connect remotely, tests the auth proxy pipeline)
ccb ssh localhost --local
```

### Mode 2: Direct SSH run

```bash
# Start an interactive session
ssh my-server -t ccb

# Specify the working directory
ssh my-server -t "ccb --cwd /home/user/project"

# Use a specific model
ssh my-server -t "ccb --model claude-sonnet-4-6-20250514"
```

---

## Build and deployment

### Build output

```bash
# Install dependencies
bun install

# Build (outputs to dist/)
bun run build
```

Output description:

| File | Description |
|------|------|
| `dist/cli.js` | Bun entry (`#!/usr/bin/env bun`) |
| `dist/cli-node.js` | Node.js entry (`#!/usr/bin/env node` → `import ./cli.js`) |
| `dist/cli-bun.js` | Bun-specific entry |
| `dist/chunk-*.js` | Code-splitting chunk files (about 668) |

### Ways to run

```bash
# Option A: run directly through bun (development/debugging)
bun run dev

# Option B: run the build output (bun runtime)
bun dist/cli.js

# Option C: run the build output (node runtime)
node dist/cli-node.js

# Option D: use the command name after global install
ccb
```

### Global install

From the project root:

```bash
# bun global install (recommended)
bun install -g .

# Commands created:
#   ccb            → dist/cli-node.js
#   ccb-bun        → dist/cli-bun.js
#   claude-code-best → dist/cli-node.js

# Install location: ~/.bun/bin/ccb
```

Or with npm:

```bash
npm install -g .
```

Verify:

```bash
ccb --version
# → x.x.x (Claude Code)
```

### Remote deployment (full flow)

```bash
# 1. Log in to the remote
ssh my-server

# 2. Clone or sync the project code
git clone <repo-url> ~/ccb-project
cd ~/ccb-project

# 3. Install the runtime (if bun is missing)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# 4. Install dependencies + build
bun install
bun run build

# 5. Global install
bun install -g .

# 6. Make sure non-interactive SSH can reach the ccb command
#    bun install -g installs to ~/.bun/bin/, but non-interactive SSH does not load .bashrc,
#    so ~/.bun/bin/ is not in PATH
#    Fix (pick one):

# Option A: symlink into the system PATH (recommended)
ln -sf ~/.bun/bin/ccb /usr/local/bin/ccb

# Option B: add to /etc/profile.d/ (applies to all users)
echo 'export PATH="$HOME/.bun/bin:$PATH"' > /etc/profile.d/bun-path.sh

# Option C: add to ~/.bash_profile (current user, applies with ssh -t)
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bash_profile

# 7. Verify
ccb --version

# 8. Test from the local machine
# (in a local terminal)
ssh my-server -t ccb
```

### SSH Remote automatic deployment

When using `ccb ssh <host>`, the module handles the following automatically:

1. **SSHProbe** probes the remote for `~/.local/bin/claude` or `command -v claude`
2. If the binary is missing or the version does not match, **SSHDeploy** transfers the `dist/` directory via `scp`
3. A wrapper script (`~/.local/bin/claude`) is created on the remote
4. No manual installation is needed

---

## Module structure

```
src/ssh/
├── createSSHSession.ts     — Session factory: orchestrates probe → deploy → proxy → spawn
├── SSHSessionManager.ts    — Two-way NDJSON communication management + permission forwarding + reconnection
├── SSHAuthProxy.ts         — Local auth proxy (API credential tunnel)
├── SSHProbe.ts             — Remote host probe (platform/arch/existing binary)
├── SSHDeploy.ts            — Remote binary deployment (scp + wrapper script)
└── __tests__/
    └── SSHSessionManager.test.ts  — 17 unit tests
```

## Key technical details

### Authentication tunnel

- **AuthProxy** listens locally (Unix socket or TCP) and receives API requests from the remote CLI
- It is tunneled to the remote through SSH `-R` reverse port forwarding
- AuthProxy injects the real local credentials (API key or OAuth token) and forwards to `api.anthropic.com`
- The `ANTHROPIC_AUTH_NONCE` header prevents unauthorized access (the nonce is passed to the remote CLI through an environment variable, and the remote CLI carries this header on every API request)

### waitForInit vs liveness check

- **Standard mode**: `waitForInit` waits for the remote CLI to send a `{type:'system', subtype:'init'}` JSON message
- **`--remote-bin` mode**: skips `waitForInit` (in print+stream-json mode init is only sent after the first query) and uses a 3-second process liveness check instead

### Reconnection mechanism

- `SSHSessionManager` reconnects automatically after detecting that the SSH connection dropped
- On reconnect, `--continue` is appended to the remote CLI command to resume the session
- Exponential backoff retries (up to 5 times, with intervals 1s → 2s → 4s → 8s → 16s)

## Feature Flag

The SSH Remote feature is controlled by the `SSH_REMOTE` feature flag:

- **Dev mode**: enabled by default
- **Build mode**: add `'SSH_REMOTE'` to `DEFAULT_BUILD_FEATURES` in `build.ts`
- **Runtime**: the `FEATURE_SSH_REMOTE=1` environment variable

---

## FAQ

### `ccb: command not found` (during SSH remote execution)

Non-interactive SSH does not load `.bashrc`, so `~/.bun/bin` is not in PATH.

```bash
# Fix: create a symlink
ln -sf ~/.bun/bin/ccb /usr/local/bin/ccb
```

### SSH key rejected

```
Permission denied (publickey)
```

1. Confirm the public key was added to the remote `~/.ssh/authorized_keys`
2. Confirm the local private key file permissions are correct (`chmod 600`)
3. Confirm the `IdentityFile` path in `~/.ssh/config` is correct
4. Windows users should check ACL permissions (see the Windows permission settings above)

### SSH connection timeout

```
ssh: connect to host x.x.x.x port 22: Connection timed out
```

1. Confirm the remote SSH service is running: `systemctl status sshd`
2. Confirm the firewall allows port 22
3. Confirm the IP address/domain name is correct
4. Add `ConnectTimeout 10` to `~/.ssh/config`

### 403 Forbidden (SSH Remote module)

AuthProxy's nonce validation failed. Confirm:
1. The remote CLI version includes the nonce header injection fix
2. The `ANTHROPIC_AUTH_NONCE` environment variable is passed to the remote correctly
3. The `x-auth-nonce` header is enabled in `src/services/api/client.ts`

### The remote CLI exits immediately after starting

```
Remote process exited immediately (code 1)
```

1. Confirm the remote `bun` / `node` runtime is available
2. Run `ccb --version` on the remote manually to verify the installation
3. Check that the `--remote-bin` path is correct
4. Check the stderr output for detailed error information
