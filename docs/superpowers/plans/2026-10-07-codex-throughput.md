# Codex throughput implementation plan

> Execution: main session implements; independent read-only review before delivery. User approved introducing the proposals alongside the active session on 7 October 2026. Refs #605.

**Goal:** Make future Codex work continue through review with explicit capacity and role-specific model choices, without disturbing active work.
**Architecture:** Extend the existing wave runner and its report. Preserve shared admission, isolation, verification and release gates. No new scheduler or global configuration.
**Tech stack:** Node.js, node:test, existing PowerShell preflight.
**Contract:** [CODEX_WORKFLOWS](../../CODEX_WORKFLOWS.md), [OPERATING_PLAN](../../OPERATING_PLAN.md), [parallel orchestration](../../PARALLEL_WORKTREE_ORCHESTRATION.md), [AGENTS](../../../AGENTS.md).

## Scope and verification

- [x] Extend `scripts/codex-wave.test.mjs` first: independent reviewer selection, legacy inheritance, invalid lane counts before admission, report of requested/effective capacity and unknown CLI defaults.
- [x] Extend `scripts/codex-wave.mjs`: optional `reviewerModel`/`reviewerEffort`; common selection for CLI dry-run, dispatch and report; integer lanes 1-4, omitted remains 2. Fixer and permission-probe keep worker selection. No automatic model changes.
- [x] Update the three SSOTs: one delivery owner per claim; direct evidence-backed owner decisions; explicit parallelism; ready-to-use Goals, scheduled follow-up and reproduction/visual-decision prompts. No automatic Goal or monitor activation.
- [x] Run runner/policy regression tests, dry-run smoke, preflight, token hygiene and independent review. 90 tests, dry-run, 32 local link targets and preflight pass. Token hygiene reports the unchanged MASTERPLAN budget overrun (1516/1500); required rule anchors pass. Review found one stale docs-only sentence, corrected. Existing CI remains the merge gate.
- Delivery evidence and remaining actions are recorded on [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605) and its linked PR. Do not close the broad issue or claim measured productivity gains.

## Review focus

Omitted role options must preserve existing plans. Reviewer model-only overrides must not inherit worker effort. Invalid capacity must fail before locks or worktrees. Reports must not invent a resolved CLI model. Running sessions and the shared wave/verification limits must remain intact.

## Activation and rollback

New runner behavior becomes available after merge; active processes keep their existing code and options. Model experiments are explicit per new track, never global. Goals and app follow-ups require a concrete user request and bounded target. Revert this PR to remove the added options; existing plans without them continue unchanged. Patch notes and feature registry are not applicable: no player behavior, feature or flag changes.
