# BASH_CLASSIFIER — Bash command classifier

> Feature Flag: `FEATURE_BASH_CLASSIFIER=1`
> Implementation status: bashClassifier.ts is entirely a stub; yoloClassifier.ts is fully implemented and can serve as a reference
> References: 45

## 1. Overview

BASH_CLASSIFIER uses an LLM to classify the intent of bash commands (allow/deny/ask), enabling automatic permission decisions. Users do not need to approve bash commands one by one; the classifier judges safety from the command content and context.

### Core characteristics

- **LLM-driven classification**: uses an Opus model to assess command safety
- **Two-stage classification**: quick block/allow → deep chain of thought
- **Auto-approval**: commands the classifier judges safe pass automatically
- **UI integration**: the permission dialog shows the classifier status and review options

## 2. Implementation architecture

### 2.1 Module status

| Module | File | Status | Description |
|--------|------|--------|-------------|
| Bash classifier | `src/utils/permissions/bashClassifier.ts` | **Stub** | All functions are no-ops. Comment: "ANT-ONLY" |
| YOLO classifier | `src/utils/permissions/yoloClassifier.ts` | **Complete** | 1496 lines, two-stage XML classifier |
| Approval signals | `src/utils/classifierApprovals.ts` | **Complete** | Map + signals that manage classifier decisions |
| Permission UI | `src/components/permissions/BashPermissionRequest.tsx` | **Wired** | Classifier status display, review options |
| Permission pipeline | `src/hooks/toolPermission/handlers/*.ts` | **Wired** | Classifier results are routed into decisions |
| API beta header | `src/services/api/withRetry.ts` | **Wired** | Sends the `bash_classifier` beta when enabled |

### 2.2 Reference implementation: yoloClassifier.ts

File: `src/utils/permissions/yoloClassifier.ts` (1496 lines)

This is the complete classifier that is already implemented, and it can serve as a reference for bashClassifier.ts:

```
Two-stage classification:
1. Quick stage: build the conversation record → call sideQuery (Opus) → quick block/allow
2. Deep stage: chain-of-thought analysis → final decision
```

Characteristics:
- Builds the full conversation-record context
- Calls sideQuery with a safety system prompt
- GrowthBook configuration and metrics
- Error handling and degradation

### 2.3 Where the classifier sits in the permission pipeline

```
A bash command arrives
      │
      ▼
bashPermissions.ts permission check
      │
      ├── Traditional rule matching (string level)
      │
      └── [BASH_CLASSIFIER] LLM classification
            │
            ├── allow → pass automatically
            ├── deny → reject automatically
            └── ask → show the permission dialog
                  │
                  ├── Classifier auto-approval marker
                  └── Review options (the user can override)
```

## 3. What still needs to be completed

| Function | To implement | Description |
|----------|--------------|-------------|
| `classifyBashCommand()` | LLM call that assesses safety | Follow the two-stage pattern of yoloClassifier.ts |
| `isClassifierPermissionsEnabled()` | GrowthBook/config check | Controls whether the classifier is active |
| `getBashPromptDenyDescriptions()` | Return prompt-based deny rules | Permission setting descriptions |
| `getBashPromptAskDescriptions()` | Return ask rules | Commands that need user confirmation |
| `getBashPromptAllowDescriptions()` | Return allow rules | Commands that pass automatically |
| `generateGenericDescription()` | LLM generates a command description | Provides explanation for the permission dialog |
| `extractPromptDescription()` | Parse rule content | Extract the description from a rule |

## 4. Key design decisions

1. **ANT-ONLY marker**: bashClassifier.ts is labeled "ANT-ONLY", possibly a client adapter for an Anthropic-internal server-side classifier
2. **Two-stage classification**: the quick stage handles clear-cut cases (reducing latency) and the deep stage handles ambiguous ones
3. **Classifier results are reviewable**: the permission UI shows the classifier's decision and the user can override it
4. **YOLO classifier as reference**: yoloClassifier.ts provides a complete classifier implementation pattern to follow directly

## 5. Usage

```bash
# Enable the feature
FEATURE_BASH_CLASSIFIER=1 bun run dev

# Use together with TREE_SITTER_BASH (AST + LLM double safety)
FEATURE_BASH_CLASSIFIER=1 FEATURE_TREE_SITTER_BASH=1 bun run dev
```

## 6. File index

| File | Lines | Responsibility |
|------|-------|----------------|
| `src/utils/permissions/bashClassifier.ts` | — | Bash classifier (stub, ANT-ONLY) |
| `src/utils/permissions/yoloClassifier.ts` | 1496 | YOLO classifier (complete reference implementation) |
| `src/utils/classifierApprovals.ts` | — | Classifier approval signal management |
| `src/components/permissions/BashPermissionRequest/BashPermissionRequest.tsx` | — | Classifier UI |
| `src/hooks/toolPermission/handlers/interactiveHandler.ts` | — | Interactive permission handling |
| `src/services/api/withRetry.ts` | — | API beta header |
