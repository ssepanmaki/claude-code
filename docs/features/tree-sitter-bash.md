# TREE_SITTER_BASH — Bash AST parsing

> Feature Flag: `FEATURE_TREE_SITTER_BASH=1`
> Implementation status: fully usable (pure TypeScript implementation, ~7000+ lines)
> References: 3

## 1. Overview

TREE_SITTER_BASH enables a complete Bash AST parser used to security-check Bash commands. It replaces the old regex-based shell-quote parser with a full tree-walking security analyzer. The key property is **fail-closed**: anything not recognized is classified as `too-complex` and requires user approval.

### Related features

| Feature | Description |
|---------|------|
| `TREE_SITTER_BASH` | Activates the AST parser for permission checks |
| `TREE_SITTER_BASH_SHADOW` | Shadow/observation mode: runs the parser but discards the result, only logging telemetry |

## 2. Security architecture

### 2.1 Fail-closed design

The core design uses an **allowlist** walk pattern:

- `walkArgument()` only handles known-safe node types (`word`, `number`, `raw_string`, `string`, `concatenation`, `arithmetic_expansion`, `simple_expansion`)
- Any unknown node type → `tooComplex()` → user approval required
- A parser that loads but fails (timeout / node budget / panic) → returns the `PARSE_ABORTED` symbol (distinct from "module not loaded")

### 2.2 Parse results

```ts
parseForSecurity(cmd) returns:
  { kind: 'simple', commands: SimpleCommand[] }     // can be statically analyzed
  { kind: 'too-complex', reason, nodeType }          // needs user approval
  { kind: 'parse-unavailable' }                      // parser not loaded
```

### 2.3 Layers of security checks

```
parseForSecurity(cmd)
      │
      ▼
parseCommandRaw(cmd) → AST root node
      │
      ▼
Pre-checks: control characters, Unicode whitespace, backslash+whitespace,
            zsh ~[ ] syntax, zsh =cmd expansion, brace+quote obfuscation
      │
      ▼
walkProgram(root) → collectCommands(root, commands, varScope)
      │
      ├── 'command'         → walkCommand()
      ├── 'pipeline'/'list' → structural, recurse into children
      ├── 'for_statement'   → track the loop variable as VAR_PLACEHOLDER
      ├── 'if/while'        → scope-isolated branches
      ├── 'subshell'        → scope copy
      ├── 'variable_assignment' → walkVariableAssignment()
      ├── 'declaration_command' → validate declare/export flags
      ├── 'test_command'    → walk test expressions
      └── anything else     → tooComplex()
      │
      ▼
checkSemantics(commands)
  ├── EVAL_LIKE_BUILTINS (eval, source, exec, trap...)
  ├── ZSH_DANGEROUS_BUILTINS (zmodload, emulate...)
  ├── SUBSCRIPT_EVAL_FLAGS (test -v, printf -v, read -a)
  ├── Shell keywords as argv[0] (misparse detection)
  ├── /proc/*/environ access
  ├── jq system() and dangerous flags
  └── Wrapper stripping (time, nohup, timeout, nice, env, stdbuf)
```

## 3. Implementation architecture

### 3.1 Core modules

| Module | File | Lines | Responsibility |
|------|------|------|------|
| Gated entry | `src/utils/bash/parser.ts` | ~110 | `parseCommand()`, `parseCommandRaw()`, `ensureInitialized()` |
| Bash parser | `src/utils/bash/bashParser.ts` | 4437 | Pure TS lexer + recursive-descent parser |
| Security analyzer | `src/utils/bash/ast.ts` | 2680 | Tree-walking security analysis + `parseForSecurity()` |
| AST analysis helpers | `src/utils/bash/treeSitterAnalysis.ts` | 507 | Quote context, compound structures, dangerous pattern extraction |
| Permission check entry | `src/tools/BashTool/bashPermissions.ts` | — | Integrates AST results into permission decisions |

### 3.2 Bash parser

File: `src/utils/bash/bashParser.ts` (4437 lines)

- Pure TypeScript implementation (no native dependencies)
- Produces an AST compatible with tree-sitter-bash
- Key type: `TsNode` (type, text, startIndex, endIndex, children)
- Safety limits: `PARSE_TIMEOUT_MS = 50`, `MAX_NODES = 50_000`, to prevent adversarial input from causing OOM

### 3.3 Security analyzer

File: `src/utils/bash/ast.ts` (2680 lines)

Core functions:

| Function | Responsibility |
|------|------|
| `parseForSecurity(cmd)` | Top-level entry, returns `simple/too-complex/parse-unavailable` |
| `parseForSecurityFromAst(cmd, root)` | Accepts a pre-parsed AST |
| `checkSemantics(commands)` | Post-parse semantic checks |
| `walkCommand()` | Extracts argv, envVars, redirects |
| `walkArgument()` | Allowlist argument walk |
| `collectCommands()` | Recursively collects all commands |

### 3.4 AST analysis helpers

File: `src/utils/bash/treeSitterAnalysis.ts` (507 lines)

| Function | Responsibility |
|------|------|
| `extractQuoteContext()` | Identifies single quotes, double quotes, ANSI-C strings, heredocs |
| `extractCompoundStructure()` | Detects pipelines, subshells, command groups |
| `hasActualOperatorNodes()` | Distinguishes real `;`/`&&`/`||` from escaped forms |
| `extractDangerousPatterns()` | Detects command substitution, parameter expansion, heredocs |
| `analyzeCommand()` | Single-pass extraction |

### 3.5 Shadow mode

`TREE_SITTER_BASH_SHADOW` runs the parser but **never affects permission decisions**:

```ts
// Shadow mode: log telemetry, then force the legacy path
astResult = { kind: 'parse-unavailable' }
astRoot = null
// Logs: available, astTooComplex, astSemanticFail, subsDiffer, ...
```

It logs a `tengu_tree_sitter_shadow` event containing a comparison with the legacy `splitCommand()`. This is used to collect telemetry without affecting behavior.

## 4. Key design decisions

1. **Allowlist walk**: only known-safe node types are handled; unknown types go straight to `tooComplex()`
2. **PARSE_ABORTED symbol**: distinguishes "parser not loaded" from "parser loaded but failed". The latter blocks the fallback to the legacy path (which lacks the `EVAL_LIKE_BUILTINS` check)
3. **Variable scope tracking**: the `VAR=value && cmd $VAR` pattern. Static values resolve to real strings, and `$()` output uses `VAR_PLACEHOLDER`
4. **PS4/IFS allowlist**: PS4 assignments use a strict character allowlist `[A-Za-z0-9 _+:.\/=\[\]-]`, allowing only `${VAR}` references
5. **Wrapper stripping**: strips `time/nohup/timeout/nice/env/stdbuf` from the front of argv; unknown flags → fail-closed
6. **Shadow safety**: shadow mode **always** forces `astResult = { kind: 'parse-unavailable' }` and never affects permissions

## 5. Usage

```bash
# Activate AST parsing for permission checks
FEATURE_TREE_SITTER_BASH=1 bun run dev

# Shadow mode (telemetry only, no behavior change)
FEATURE_TREE_SITTER_BASH_SHADOW=1 bun run dev
```

## 6. File index

| File | Lines | Responsibility |
|------|------|------|
| `src/utils/bash/parser.ts` | ~110 | Gated entry point |
| `src/utils/bash/bashParser.ts` | 4437 | Pure TS bash parser |
| `src/utils/bash/ast.ts` | 2680 | Security analyzer (core) |
| `src/utils/bash/treeSitterAnalysis.ts` | 507 | AST analysis helpers |
| `packages/builtin-tools/src/tools/BashTool/bashPermissions.ts` | ~140 | Permission integration + shadow telemetry |
