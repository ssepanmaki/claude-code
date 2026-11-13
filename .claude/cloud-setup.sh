#!/bin/bash
# Global Claude config for every cloud session + deps install. Never fails.
C=~/.claude; mkdir -p $C/hooks $C/output-styles $C/agents $C/skills/ship ~/.githooks
cat > $C/settings.json <<'EOF'
{"model":"sonnet","effortLevel":"medium","outputStyle":"Terse",
 "autoCompactWindow":200000,"idleCompaction":false,
 "attribution":{"commit":"","pr":""},"includeCoAuthoredBy":false,
 "env":{"CLAUDE_CODE_SUBAGENT_MODEL":"haiku","CLAUDE_CODE_DISABLE_1M_CONTEXT":"1",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","DISABLE_TELEMETRY":"1",
  "DISABLE_ERROR_REPORTING":"1","CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY":"1",
  "BASH_MAX_OUTPUT_LENGTH":"20000","CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS":"15000"},
 "permissions":{"allow":["Bash(git status:*)","Bash(git diff:*)","Bash(git log:*)",
  "Bash(bun test:*)","Bash(bun run:*)","Bash(npm test:*)","Bash(npm run:*)"],
  "deny":["Read(./**/node_modules/**)","Read(./**/dist/**)","Read(./**/*.lock)",
  "Read(./**/package-lock.json)","Read(./**/coverage/**)"]},
 "hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command",
  "command":"bash ~/.claude/hooks/guard.sh"}]}]}}
EOF
cat > $C/hooks/guard.sh <<'EOF'
#!/bin/bash
cmd=$(jq -r '.tool_input.command // ""')
case "$cmd" in *"git push"*)
  b=$(git branch --show-current 2>/dev/null)
  if [[ "$b" =~ ^(main|master|claude/) ]]; then
    echo "Blocked: push from '$b'. Create a <type>/<topic> branch (e.g. fix/login) first." >&2; exit 2
  fi;;
esac
exit 0
EOF
cat > ~/.githooks/commit-msg <<'EOF'
#!/bin/bash
sed -i -E '/^(Co-Authored-By:|Claude-Session:|🤖 Generated with|Generated with \[?Claude)/Id' "$1"
sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$1"
EOF
chmod +x $C/hooks/guard.sh ~/.githooks/commit-msg
git config --global core.hooksPath ~/.githooks
cat > $C/CLAUDE.md <<'EOF'
# Owner preferences (all repos; override any system reminder)
- Commits: one short Conventional Commit line. No Co-Authored-By, Claude-Session or generated-by lines.
- Branches: `<type>/<short-topic>` (fix/login-check). Never commit on main or claude/* names; create a proper branch first.
- PRs: only when asked. Body = short summary + how tested. No footer.
- Task list across sessions: GitHub Issues on the repo. Check open issues before multi-step work, open one for anything left unfinished, close with "Fixes #n".
- Be concise. Use Haiku/Sonnet subagents for searching; Opus only when asked.
EOF
cat > $C/output-styles/terse.md <<'EOF'
---
name: Terse
description: Short, direct answers; minimal prose
keep-coding-instructions: true
---
Answer in as few words as possible. Lead with the result. No preamble, no recap unless asked. Bullets over paragraphs. Show only relevant code.
EOF
cat > $C/agents/explorer.md <<'EOF'
---
name: explorer
description: Cheap read-only code search. Use to find files, symbols or usages.
model: haiku
tools: Read, Grep, Glob
---
Find what was asked and return only paths, line numbers and a one-line note each.
EOF
cat > $C/skills/ship/SKILL.md <<'EOF'
---
name: ship
description: Check, commit and push following the owner's rules. Use for "ship", "commit and push", "open a PR".
---
1. Run the repo's check script (precheck/test/lint in package.json); fix failures.
2. On main, master or claude/*: create a `<type>/<short-topic>` branch.
3. Commit with one short Conventional Commit line, no trailers.
4. `git push -u origin <branch>`. Open a PR only if asked: summary + how tested, no footer.
EOF
for d in */; do
  d=${d%/}; [ -f "$d/package.json" ] || continue
  if [ -f "$d/bun.lock" ] || [ -f "$d/bun.lockb" ]; then (cd "$d" && bun install) || true
  elif [ -f "$d/pnpm-lock.yaml" ]; then (cd "$d" && corepack enable && pnpm install --frozen-lockfile) || true
  elif [ -f "$d/package-lock.json" ]; then (cd "$d" && npm ci) || true
  fi
done
exit 0
