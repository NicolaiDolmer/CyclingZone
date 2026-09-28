# AI youth-pool retirement repair — approved design

**Design-go:** owner, 28 September 2026 in Codex: replace the already retired AI club in U23 Group A / Junior Group A with a startable spare; keep the draining AI club in U23 Group F / Junior Group H until its races end, then replace it with a different startable spare in the retirement transaction. No human club moves. No Codex production write, merge, or flag change.

**Area contracts:** [GAME_INVARIANTS.md](../../GAME_INVARIANTS.md) owns pool occupancy and AI retirement; [YOUTH_RULES.md](../../YOUTH_RULES.md) owns youth group size, playable squads and the junior/U23 distinction; [CALENDAR_RULES.md](../../CALENDAR_RULES.md) owns active race obligations. This design amends the youth occupancy rule while an AI club remains race-bound. The senior pool continues to exclude an AI club marked for removal.

## Problem and observed shape

The current league audit excludes a draining AI club from all three pool axes. Its senior pool is genuinely overfull and must reserve that AI for removal, but its youth clubs still race and physically occupy their groups. Conversely, `retire_ai_pool_team` clears the senior pool and retires its riders while leaving both youth group pointers behind; the audit can count a retired, empty club as a valid youth member. One retired ghost already exists. Exact club IDs and the two guarded replacement candidates are in the private OneDrive handoff `private-handoffs/2026-09-28-youth-pool-repair-private.md`.

## Rules

1. Senior occupancy keeps its existing pending-removal exclusion. A youth group counts a non-retired draining AI club while its race obligation still blocks retirement. A retired AI club never occupies an active youth place.
2. A retirement that vacates a youth group clears the departing club's youth pointers and assigns one distinct eligible AI club to the same U23 and/or junior group **in the same database transaction**. No externally visible state has an empty youth slot.
3. The replacement must be active, unparked, unfrozen, not a bank/test club, not pending removal, have no youth group already, have enough eligible U23 and junior riders to start, and have no uncompleted youth-race entries. Select deterministically. Conditional row locks prevent one spare being used twice.
4. A missing safe replacement fails closed: the retiring club remains active and marked for retry. Human group assignments are never changed.
5. The existing retired ghost is corrected only by a separate owner-gated call after a read-only dry-run checks its empty roster and zero uncompleted race entries. No broad reseed of all youth groups.
6. Dry-run reports the exact before/after youth and senior pool counts, candidates, rider eligibility, in-flight obligations, and any blocker. It never applies changes.

## Verification and release

**Tier FULL:** red/green audit tests for senior versus youth pending occupancy and retired ghosts; SQL contract tests for transactional replacement, locks and fail-closed behavior; dry-run on current production data read-only; preflight, full backend and frontend CI. Check an already retired ghost, a race-bound pending club, no candidate, and competing retirements. Verify the same youth group remains playable and no manager club moves. Patch note EN/DA follows `docs/TONE_OF_VOICE.md` and uses the next free version after 7.315. Show the dry-run to the owner privately before any apply.

**Apply order, owner-controlled:** merge via `scripts/merge-queue.ps1`; verify the next production deploy READY; install the migration under the repo's migration rules; run a fresh dry-run; owner approves the specific retired-ghost repair; invoke the owner-gated repair once; verify all active groups and race obligations. Future retirements use the new transaction automatically after the migration is live. Codex performs none of those production writes in this task.
