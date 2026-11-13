# Channels: external channel message intake

> Launch flags: `--channels` / `--dangerously-load-development-channels`
> Status: the feature flag and OAuth restrictions have been lifted; usable directly

## Overview

A channel is an MCP server that pushes external events into your running Claude Code session so Claude can react while you are away from the terminal. See these documents for detailed usage:

- **Official docs**: [Push events into a running session with channels](https://code.claude.com/docs/en/channels)
- **Feishu plugin**: [claude-code-feishu-channel](https://github.com/whobot-ai/claude-code-feishu-channel), a community Feishu channel plugin with two-way messaging, pairing authentication, group chat and file attachments

## Quick start

```bash
# Enable channel listening (plugin format)
ccb --channels plugin:feishu@claude-code-feishu-channel

# Enable channel listening (server format)
ccb --channels server:my-slack-bridge

# Enable several channels at once
ccb --channels plugin:feishu@claude-code-feishu-channel --channels server:discord-bot

# Development mode (skips the allowlist check, for testing custom channels)
ccb --dangerously-load-development-channels server:my-custom-channel
```

## Supported channels

| Channel | Description | Source |
|---------|------|------|
| **Telegram** | Official Telegram bot integration | `/plugin install telegram@claude-plugins-official` |
| **Discord** | Official Discord bot integration | `/plugin install discord@claude-plugins-official` |
| **iMessage** | Native macOS messaging | `/plugin install imessage@claude-plugins-official` |
| **Feishu (Feishu/Lark)** | Two-way messaging, group chat, file attachments | `/plugin install feishu@claude-code-feishu-channel` |

## Related files

| File | Responsibility |
|------|------|
| `src/services/mcp/channelNotification.ts` | Channel gate logic and message wrapping |
| `src/services/mcp/channelAllowlist.ts` | Channel switch (on by default) |
| `src/services/mcp/useManageMCPConnections.ts` | Channel registration within MCP connection management |
| `src/components/LogoV2/ChannelsNotice.tsx` | Channel status notice at startup |
| `src/main.tsx` | `--channels` argument parsing |
| `src/interactiveHelpers.tsx` | Dev channels confirmation dialog |

## References

- [Official Channels docs](https://code.claude.com/docs/en/channels): full usage, security, Enterprise controls
- [Feishu channel plugin](https://github.com/whobot-ai/claude-code-feishu-channel): installation guide, MCP tools, Skill command reference
