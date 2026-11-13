#!/bin/bash
# Global Claude config for every cloud session. Never fails.
C=~/.claude; H=$C/hooks; mkdir -p $H $C/output-styles $C/agents ~/.githooks
cat > $C/settings.json <<'EOF'
{"model":"sonnet","fallbackModel":"sonnet","effortLevel":"medium","outputStyle":"Terse",
 "idleCompaction":false,"autoCompactWindow":200000,
 "attribution":{"commit":"","pr":""},"includeCoAuthoredBy":false,
 "env":{"CLAUDE_CODE_SUBAGENT_MODEL":"haiku","CLAUDE_CODE_DISABLE_1M_CONTEXT":"1",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC":"1","DISABLE_TELEMETRY":"1",
  "DISABLE_ERROR_REPORTING":"1","CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY":"1",
  "BASH_MAX_OUTPUT_LENGTH":"20000","CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS":"15000"},
 "permissions":{"allow":["Bash(git status:*)","Bash(git diff:*)","Bash(git log:*)",
  "Bash(bun test:*)","Bash(bun run:*)","Bash(npm test:*)","Bash(npm run:*)"],
  "deny":["Read(./**/node_modules/**)","Read(./**/dist/**)","Read(./**/*.lock)",
  "Read(./**/package-lock.json)","Read(./**/coverage/**)"]},
 "hooks":{
  "SessionStart":[{"matcher":"startup","hooks":[{"type":"command","command":"bash ~/.claude/hooks/issues.sh"}]}],
  "PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"bash ~/.claude/hooks/guard.sh"}]}],
  "PostToolUse":[{"matcher":"Edit|Write|MultiEdit","hooks":[{"type":"command","command":"bash ~/.claude/hooks/format.sh"}]}]}}
EOF
cat > $H/guard.sh <<'EOF'
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
cat > $H/issues.sh <<'EOF'
#!/bin/bash
r=$(git remote get-url origin 2>/dev/null | sed -E 's#\.git$##; s#.*[/:]([^/:]+/[^/]+)$#\1#')
[ -n "$r" ] || exit 0
q="repo:$r is:issue is:open assignee:@me"
out=$(timeout 10 gh api -X GET search/issues -f q="$q" -f sort=updated -f per_page=5 \
  --jq '"\(.total_count) open issues assigned to you; latest:", (.items[]|"#\(.number) \(.title)")' 2>/dev/null)
[[ "$out" == 0\ * || -z "$out" ]] || printf 'Task list (%s):\n%s\n' "$r" "$out"
exit 0
EOF
cat > $H/format.sh <<'EOF'
#!/bin/bash
f=$(jq -r '.tool_input.file_path // empty'); [ -f "$f" ] || exit 0
d=$(git -C "$(dirname "$f")" rev-parse --show-toplevel 2>/dev/null) || exit 0
if [ -x "$d/node_modules/.bin/biome" ]; then "$d/node_modules/.bin/biome" format --write "$f" >/dev/null 2>&1
elif [ -x "$d/node_modules/.bin/prettier" ]; then "$d/node_modules/.bin/prettier" --write "$f" >/dev/null 2>&1; fi
exit 0
EOF
cat > ~/.githooks/commit-msg <<'EOF'
#!/bin/bash
sed -i -E '/^(Co-Authored-By:|Claude-Session:|🤖 Generated with|Generated with \[?Claude)/Id' "$1"
sed -i -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$1"
EOF
chmod +x $H/*.sh ~/.githooks/commit-msg
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
sk() { mkdir -p $C/skills/$1; printf -- '---\nname: %s\ndescription: %s\n---\n%s\n' "$1" "$2" "$3" > $C/skills/$1/SKILL.md; }
sk ship "Check, commit and push following the owner's rules. Use for ship, commit and push, open a PR." \
$'1. Run the repo check script (precheck/test/lint in package.json); fix failures.\n2. On main, master or claude/*: create a <type>/<short-topic> branch.\n'\
$'3. Commit: one short Conventional Commit line, no trailers.\n4. git push -u origin <branch>. Open a PR only if asked: summary + how tested, no footer.'
sk review "Review the current branch diff for real problems. Use for review, check my changes." \
$'Diff against the default branch. Report bugs, missing tests and security issues by severity with file:line. No style nitpicks. Do not edit files.'
sk fix-ci "Fix failing CI on the current branch's PR. Use for fix CI, checks failing." \
$'Find the failing job with the GitHub MCP tools, read its log, reproduce locally, fix the cause (never skip or disable tests), then commit and push per owner rules.'
sk issue "Record a problem or unfinished work as a GitHub issue. Use for make an issue, track this, todo." \
$'Create the issue with the GitHub MCP tools: short title; body with context, steps and acceptance criteria. Reply with the issue number only.'
for d in */; do
  d=${d%/}; [ -f "$d/package.json" ] || continue
  if [ -f "$d/bun.lock" ] || [ -f "$d/bun.lockb" ]; then (cd "$d" && bun install) || true
  elif [ -f "$d/pnpm-lock.yaml" ]; then (cd "$d" && corepack enable && pnpm install --frozen-lockfile) || true
  elif [ -f "$d/package-lock.json" ]; then (cd "$d" && npm ci) || true
  fi
done
exit 0
