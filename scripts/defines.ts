import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

/**
 * Shared MACRO define map used by both dev.ts (runtime -d flags)
 * and build.ts (Bun.build define option).
 *
 * Each value is a JSON-stringified expression that replaces the
 * corresponding MACRO.* identifier at transpile / bundle time.
 *
 * VERSION is read from package.json to avoid version drift.
 */
export function getMacroDefines(): Record<string, string> {
  return {
    'MACRO.VERSION': JSON.stringify(pkg.version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(''),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(''),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(''),
    'MACRO.PACKAGE_URL': JSON.stringify(''),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
  }
}

/**
 * Default feature flags enabled in both Bun.build and Vite builds.
 * Additional features can be enabled via FEATURE_<NAME>=1 env vars.
 *
 * Used by:
 *   - build.ts (Bun.build)
 *   - scripts/vite-plugin-feature-flags.ts (Vite/Rollup)
 *   - scripts/dev.ts (bun run dev)
 */
export const DEFAULT_BUILD_FEATURES = [
  'BUDDY', // companion pet character (Squirtle Waddles)
  'TRANSCRIPT_CLASSIFIER', // conversation classifier, used to label session types
  'BRIDGE_MODE', // Remote Control / Bridge mode, remote-controlled sessions
  'AGENT_TRIGGERS_REMOTE', // module-level Map accumulation in sessionIngress (not the main cause of GB-level usage)
  'CHICAGO_MCP', // Chicago MCP integration (internal codename)
  'VOICE_MODE', // Push-to-Talk voice input mode
  'SHOT_STATS', // per-request statistics collection
  'PROMPT_CACHE_BREAK_DETECTION', // detects whether the prompt cache was broken (capped at 10 entries, bounded)
  'TOKEN_BUDGET', // token budget management and control
  // P0: local features
  'AGENT_TRIGGERS', // local Agent triggers (launch subagents on tool calls)
  'ULTRATHINK', // ultra-deep thinking mode, lengthens the reasoning chain
  'BUILTIN_EXPLORE_PLAN_AGENTS', // built-in Explore/Plan subagent types
  'LODESTONE', // context anchors, improve relevance retrieval in long conversations
  'EXTRACT_MEMORIES', // forks the full message history at the end of each turn (not the main cause of GB-level usage)
  'VERIFICATION_AGENT', // forks the full messages after task completion (not the main cause of GB-level usage)
  'KAIROS_BRIEF', // Kairos scheduled summaries (periodically report current status)
  'AWAY_SUMMARY', // away summary (generates a summary after the user leaves)
  'ULTRAPLAN', // super-planning mode, generates an implementation plan after deep analysis
  'DAEMON', // daemon mode, a long-running supervisor managing background workers (not the main cause of GB-level usage)
  'ACP', // ACP agent protocol, supports external agent integration
  'WORKFLOW_SCRIPTS', // workflow scripts (YAML/MD in .claude/workflows/)
  // 'HISTORY_SNIP', // disabled: the snip feature is temporarily off
  // 'CONTEXT_COLLAPSE', // disabled: the implementation is an empty stub; enabling it suppresses auto compact and breaks context management entirely
  'MONITOR_TOOL', // Monitor tool, streams background process output
  // 'FORK_SUBAGENT',            // disabled: equivalent functionality is already provided via the Agent tool, no need to enable
  'KAIROS', // core of the Kairos scheduled task system
  'COORDINATOR_MODE', // multi-worker orchestration mode (AgentSummary leak fixed in 52b61c2c)
  // 'UDS_INBOX', // inter-process communication pipes (inbox/pipe/peers commands); hangs in the Node.js environment after build
  // 'LAN_PIPES', // LAN pipes, depends on UDS_INBOX; hangs in the Node.js environment after build
  'BG_SESSIONS', // background session management (ps/logs/attach/kill)
  'TEMPLATES', // template tasks (new/list/reply subcommands)
  // 'REVIEW_ARTIFACT',          // code review artifact (API requests get no response; schema compatibility to be investigated)
  // API content block types
  'CONNECTOR_TEXT', // Connector text block type, extends the API content format
  // Attribution tracking
  'COMMIT_ATTRIBUTION', // Git commit attribution tracking (records AI-assisted contributions)
  // Server mode (claude server / claude open)
  'DIRECT_CONNECT', // direct connect mode (claude server / claude open)
  // Skill search & learning — feature flags compiled in (so the slash
  // commands /skill-* etc. exist), but the runtime "enabled" toggle
  // defaults to OFF (see featureCheck.ts). Operators turn on via the
  // slash-command toggle or env vars (SKILL_SEARCH_ENABLED=1,
  // SKILL_LEARNING_ENABLED=1). Rationale: bounded caches added on
  // this branch (see docs/agent/sur-skill-overflow-bugs.md) close the
  // overflow risk, but Haiku-on-first-Chinese-query and disk-side
  // observation accumulation remain operator-discretion concerns.
  'EXPERIMENTAL_SKILL_SEARCH', // skill search (bounded caches fixed the overflow; memory issue resolved)
  'EXPERIMENTAL_SEARCH_EXTRA_TOOLS', // tool-search prefetch pipeline (TF-IDF index + inter-turn async prefetch)
  // 'SKILL_LEARNING',
  // P3: poor mode
  'POOR', // budget mode, skips extract_memories/prompt_suggestion to cut consumption
  // Team Memory
  // 'TEAMMEM',                  // disabled: depends on COORDINATOR_MODE; the mailbox file grows without bound
  // SSH Remote
  'SSH_REMOTE', // SSH remote connection, local REPL + remote tool execution
  // Autofix PR
  'AUTOFIX_PR', // /autofix-pr command (introduced by the fork; docs/jira/AUTOFIX-PR-001.md promises it on by default)
  // Persistent thread goal command — auto-continuation, JSONL persistence,
  // strict completion/blocked audit. See src/services/goal.
  'GOAL',
] as const
