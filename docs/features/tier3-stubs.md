# Tier 3 — Pure stub / N/A low-priority feature overview

> This document collects all Tier 3 features. They are either pure stubs (every function returns an empty value),
> Anthropic-internal infrastructure (N/A), or auxiliary features with very few references.

## Overview

| Feature | Refs | Status | Category | Short description |
|---------|------|--------|----------|-------------------|
| CHICAGO_MCP | 16 | Implemented | Tools | Computer Use + Chrome MCP control (enabled by default in build) |
| MONITOR_TOOL | 13 | Implemented | Tools | Background monitor tool that keeps watching shell output (enabled by default in build) |
| BG_SESSIONS | 11 | Partially implemented | Session management | Background session register/cleanup implemented; task summary is a stub (enabled by default in dev) |
| SHOT_STATS | 10 | Implemented | Stats | API call statistics panel (enabled by default in build) |
| EXTRACT_MEMORIES | 7 | Implemented | Memory | Automatic memory extraction (enabled by default in build, gated by GrowthBook) |
| TEMPLATES | 6 | Partially implemented | Project management | Project/prompt template system (enabled by default in dev) |
| LODESTONE | 6 | Implemented | Deep links | URL protocol handler (enabled by default in build) |

## Single-reference features (40+)

Each of the following features has only one reference, and most are internal markers or experimental features:

UNATTENDED_RETRY, ULTRATHINK, TORCH, SLOW_OPERATION_LOGGING, SKILL_IMPROVEMENT,
SELF_HOSTED_RUNNER, RUN_SKILL_GENERATOR, PERFETTO_TRACING, NATIVE_CLIENT_ATTESTATION,
KAIROS_DREAM (see kairos.md), IS_LIBC_MUSL, IS_LIBC_GLIBC, DUMP_SYSTEM_PROMPT,
COMPACTION_REMINDERS, CCR_REMOTE_SETUP, BYOC_ENVIRONMENT_RUNNER, BUILTIN_EXPLORE_PLAN_AGENTS,
BUILDING_CLAUDE_APPS, ANTI_DISTILLATION_CC, AGENT_TRIGGERS, ABLATION_BASELINE

## Why they are Tier 3

These features are listed as Tier 3 for the following reasons:

1. **Implemented but limited in scope** (CHICAGO_MCP, LODESTONE, SHOT_STATS, EXTRACT_MEMORIES, MONITOR_TOOL): already enabled by default in build/dev, mainly serving as infrastructure for other features
2. **Partially implemented** (BG_SESSIONS, TEMPLATES): the core registration is implemented, but some functions such as the task summary are still stubs
3. **Auxiliary features** (STREAMLINED_OUTPUT, HOOK_PROMPTS): small scope of impact
4. **The CCR family**: depends on the remote-control infrastructure and needs BRIDGE_MODE to be completed first

To dig into a particular Tier 3 feature, search the codebase for `feature('FEATURE_NAME')` to see how it is used.
