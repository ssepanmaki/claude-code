# Agent Communication Fix: Open Questions

- Version: v1.0
- Date generated: 2026-04-25
- Scope: ACP Agent / Bridge / Remote Control Server / REPL hook lifecycle
- Companion execution doc: `docs/internals/agent-comm-fix-jira-tasks.md`
- Purpose: keep the questions to ask before deciding, the cross-check prompt and the confirmed conclusions. Do not write Jira execution steps here.

---

## 1. Conclusions confirmed so far

- Only two deliverable documents are kept: this questions doc and the Jira task doc.
- The Jira task doc is the single execution entry point, with owner, priority, file scope, acceptance criteria, risks and verification suggestions.
- Claude cross-check result: passed overall with no blocking findings. It suggested adding a protocol regression gate, the JIRA-001/008 dependency, code reference locations and consistent thresholds; these have been merged into the Jira task doc.
- The work has moved into the business-code fix phase; `bun run typecheck` and the related regression tests must be run.

---

## 2. Questions to settle before execution

1. Is the `session-ingress` WebSocket limit fixed at 10MB, consistent with the ACP route?
2. Is the over-limit close code always `1009`, and is the close reason fixed as `message too large`?
3. Does anything downstream depend on the plain-text format of `resource_link`, and can it replace the current markdown link representation?
4. What is the actual settings key for the ACP permission mode, and is the fallback for invalid values always `default`?
5. Must `_meta.permissionMode` always override settings/defaultMode?
6. In the abort listener test, can a mock signal or a counter reliably prove that no listeners accumulate after 10k `next` calls?
7. Do the cancellation semantics of the pending prompt queue allow lazy cleanup instead of removing entries from the array immediately?
8. Is the REPL hook suppress cleanup limited to the target section, without touching other decompiled React Compiler structures?
9. Under which existing `__tests__` layout should the RCS WebSocket tests live, and is there route/mock infrastructure to reuse?
10. Must the release gate include that the `stopReason` decision and the `sessionUpdate` send order do not regress?

---

## 3. Review questions for Claude or a reviewer

```text
Please act as an external reviewer and re-check docs/internals/agent-comm-fix-jira-tasks.md.

Check:
1. Whether it still meets the requirements of a per-file execution checklist and a Jira task document.
2. Whether any files, acceptance criteria, risks or prerequisites are missing.
3. Whether there are duplicates, anything that misleads the implementer, unreasonable priorities or tests that cannot be put into practice.
4. Whether any finding must block implementation.

Output in English:
- Verdict
- Blocking Findings
- Non-blocking Findings
- Suggested Edits
- Final Recommendation

Do not modify files; output review comments only.
```

---

## 4. Review suggestions already addressed

- The Release Checklist now includes a protocol-level no-regression gate.
- JIRA-001 and JIRA-008 now state their ordering for the shared file.
- JIRA-001 to JIRA-008 now have reference code locations.
- JIRA-003 again includes the dequeue-time acceptance for the 1000-queued scenario.
- JIRA-008 story points were raised from 2 to 3.
- JIRA-010 now states that an 11MB payload is aligned to the 10MB limit and triggers a 1009 close.
- The recommended execution order now defines a P0 gate: start P1 work only after all P0 changes and smoke checks are done.

---

## 5. Not maintained in this document

- Jira ticket bodies are not maintained here; edit them in `docs/internals/agent-comm-fix-jira-tasks.md`.
- Business-code implementation plans are not maintained here; read the relevant files per ticket when implementing.
- Intermediate drafts are not kept; the old execution checklist has been merged into the Jira task doc.
