# #4753: reliable AI pool retirement

Design-go: owner chat, 9 September 2026. This explicitly replaces the earlier C
decision: retire AI teams, preserve their history, drain obligations, discover
unmarked excess automatically, and block merges on unexplained/stuck excess.
SSOT: `docs/TRANSFER_MARKET_RULES.md`, `docs/GAME_INVARIANTS.md` and
`docs/CALENDAR_RULES.md` (existing races finish unchanged).

## Contract
- All active pools target 24 non-bank teams. Existing dormant-pool policy remains.
- Placement and reservation of the excess AI retirement share one transaction.
- Choose an unblocked AI first, deterministically; preserve existing reservations.
- A draining AI finishes existing races and deals, but starts no new obligations.
- Dead offers, team records, riders and results are retained.
- Actual retirement is atomic and rechecks the pool budget under a database lock.
- A repeated/concurrent operation cannot retire a second team below the target.
- The periodic sweep examines every pool, even if every marker is missing.
- Dry-run and mutation use the same planner. A dry-run cannot write.
- Valid waiting is reported separately; unknown or stale excess is a failure.
- The league check has a unique name and is enforced by the merge path.
- No production migration, retirement, merge or automatic repair before the owner
  sees the concrete live dry-run and gives a separate production go.

## Implementation and verification plan
Execution: inline, using executing-plans and test-driven-development.
- [x] Add a real PostgreSQL test fixture for pool planning, signup reservation,
  draining guards, atomic rollback and repeat/concurrent retirement. First fail
  against the existing behavior, then load and exercise the migration itself.
- [x] Add service-only SQL planning/retirement functions and placement/draining
  triggers. Revoke public RPC execution; use fixed search paths. No data repair
  statements at migration top level and no changed foreign-key delete actions.
- [x] Delegate retirement, pool sweep and dry-run to the common database contract;
  preserve existing caller result shapes and propagate failures.
- [x] Update league audit to classify explained waits from current obligations;
  use `league-size-invariant` in workflow and merge checks, with no silent bypass.
- [x] Update transfer/calendar/invariant SSOT, feature registry, patch notes,
  guard evidence and postmortem (guard ignored; unresolved decision closed).
- [x] Run focused integration tests, `scripts/verify-local.ps1`, frontend lint
  and applicable e2e, `scripts/preflight-pr.ps1`, token hygiene and code review.
- [ ] Push a draft PR with design-go and evidence; run read-only live dry-run;
  clear the session lock and wait for owner go. The issue stays open.
- [ ] After separate go: apply the reviewed release/repair in explicit steps,
  verify 15 pools at 24 and a fresh PR league check green, then close out evidence.

## Initial evidence (read-only, 9/9 14:39 CEST)
14 pools at 24; pool 13 at 25, 16 AI, none marked or blocked by the existing
guards. Across pools: 11 AI with FK-blocking offers, 8 terminal-only, 3 live.
Retirement flag already on; PR #4762 merged 4/9. Sweep only reads marked teams.
Branch protection omitted `audit`; merge script only checked required contexts.
Missing marker's historical cause is unproven; prevention covers interrupted
signup and discovery covers already-existing drift without guessing its origin.

Evidence: [local verification and live measurement](../audits/2026-09-09-4753-retirement-verification.md).
