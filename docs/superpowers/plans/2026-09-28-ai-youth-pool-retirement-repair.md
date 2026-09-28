# AI Youth-Pool Retirement Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every active youth group at its agreed size while a surplus AI club completes its races and retires safely.

**Architecture:** The audit counts senior and youth pool occupancy separately. A service-only SQL helper selects and locks one clean AI reserve and swaps its youth group assignments with a retired departing club inside the retirement transaction; a read-only script previews the same guards for the owner. The historical ghost uses the same helper only after explicit owner approval.

**Tech Stack:** Node.js backend, Supabase/Postgres migration, Node test runner, existing pagination and audit helpers.

**Spec:** `docs/superpowers/specs/2026-09-28-ai-youth-pool-retirement-repair-design.md` (owner design-go 28/9).

## Global Constraints

- Read `docs/GAME_INVARIANTS.md`, `docs/YOUTH_RULES.md` and `docs/CALENDAR_RULES.md` before changing behavior; update affected rules in this PR.
- Preserve the 24-club group rule and `raceAutopick.MIN_RACE_ENTRIES` start floor. Keep all human-team group IDs.
- No Codex merge, prod write, migration apply or flag flip. Exact club IDs and candidate measurements remain private.
- Any player-facing release note is EN first and DA second; one version after the other open notes.

## Review Focus

- A pending AI still in a stage race must not disappear from its youth group mid-race.
- A retired AI with stale youth pointers must not make a group appear healthy.
- Candidate selection must not take an AI already in a youth group or an uncompleted youth race.
- Concurrent retirements must never reserve the same replacement or overfill a group.
- No safe candidate means no retirement or partial youth-pool write.

---

### Task 1: Audit semantics

- [x] Add failing tests for separate senior/youth counting of one race-bound pending AI and exclusion of a retired ghost.
- [x] Implement the narrow occupancy change in `backend/scripts/audit-league-size-invariant.js`.
- [x] Run focused audit tests and the read-only audit against the current data to prove the expected transitional findings.

### Task 2: Atomic retirement and ghost repair

- [x] Add a migration contract test for the same-transaction swap, conditional spare lock, no youth entry, startable riders and fail-closed no-candidate path.
- [x] Add an idempotent migration for a service-only replacement helper and an `retired_at` trigger within the existing retirement transaction.
- [x] Run migration syntax/idempotency guards and targeted existing AI retirement tests; do not apply the migration.

### Task 3: Read-only dry-run

- [x] Add a dry-run script with stable candidate order, current group counts and blocking race obligations; no apply switch or wall-clock dependency.
- [x] Test the plan for current ghost, pending race-bound club, two distinct candidates and stale-state rejection.
- [x] Run it read-only on production and save exact output in the private OneDrive handoff.

### Task 4: Release and PR

- [x] Update `docs/GAME_INVARIANTS.md` and `docs/YOUTH_RULES.md` in the same PR; add EN/DA patch note.
- [ ] Run preflight, relevant backend suite and CI; review the diff independently.
- [ ] Open PR with design-go, private dry-run pointer, owner apply steps and user-verification checklist. Mark merge-ready only after green CI and conflict check; never merge here.
