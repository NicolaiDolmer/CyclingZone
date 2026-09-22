# Codex wave entry implementation plan

Goal: full Codex waves with independent review, shared capacity gates and owned cleanup.

Authority: #5467 owner decision 21 September, plus the explicit build instruction and PR-cap exception in the current task. No merge authorization.

SSOT: `docs/AGENT_ARCHITECTURE.md`, `docs/PARALLEL_WORKTREE_ORCHESTRATION.md`, `AGENTS.md` rules 10-30. Session visibility belongs to #4016.

- [x] Inspect both issue comments and live queue. Eight open PRs; exception covers building this entry only.
- [x] Probe native subagents and installed Codex CLI. Native children inherit the main cwd; CLI can select a worktree.
- [x] Test shared exclusive wave admission, PR capacity, foreign cleanup and invalid plans with fixture data and injected time.
- [x] Implement common policy and Codex CLI runner, using existing worktree, brief, semaphore and freeze scripts. Keep merges an explicit owner action through the existing merge queue.
- [x] Show the proposed Claude workflow diff before editing its behavior. Add the same admission check to Claude's hook and setup, without replacing its scheduler.
- [x] Expose Codex claims to Claude's active-session reader. Claims are coordination state, never an expiring permission to take another writer's worktree.
- [x] Test two harmless fixture workers plus independent review, failure, interruption and cleanup without touching Claude's active marker or slots.
- [ ] Independent review, required preflight and token hygiene. Update the two SSOTs and publish evidence in the PR and #5467/#4016.

Review focus: failed GitHub reads must close admission; an expired marker is not proof of a dead owner; cleanup must retain unmerged/dirty work; failed commands must not appear successful; a writer's report is not independent review.

No player behavior, database writes, flags or patch notes are involved. Production pilot remains separate from fixture evidence.
