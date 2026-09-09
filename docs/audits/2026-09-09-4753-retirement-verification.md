# #4753: implementation evidence and production gate

Design-go: owner chat 9 September, recorded in [the issue](https://github.com/NicolaiDolmer/CyclingZone/issues/4753#issuecomment-5602277990).
SSOT: TRANSFER_MARKET_RULES.md, GAME_INVARIANTS.md, CALENDAR_RULES.md.
Implementation is locally verified. Production has not been changed; release and
repair require a separate owner go against the fresh candidate list.

## Read-only production observations

| Measurement | Pools above 24 | AI with old offer FK blockers | Terminal-only |
|---|---:|---:|---:|
| Issue, 4 September | 4 | 16 | 13 |
| 9 September, 14:39 CEST | 1 | 11 | 8 |
| 9 September, 16:06-16:09 CEST | 1 | 10 | 7 |
| 9 September, 16:25 CEST | 1 | 10 | 7 |
| 9 September, 18:06 CEST | 1 | 10 | 7 |
| 9 September, 18:32 CEST | 1 | 10 | 7 |

Latest measurement: 120 AI in pools; three have live offers. The issue's own-rider
criterion and the expanded seller-or-rider criterion both gave 10/7. No bank AI
was included; the reason for the live population change is not established.
Pools 1-15 are at 24 except pool 13, Division 4 F, at 25. No pending markers.
Retirement was already deployed by #4762 on 4 September; flag on, verified 9/9.
This contradicted the original C premise, so implementation followed the owner's
subsequent explicit retirement design rather than the obsolete deletion plan.

The exact migration planner was inlined as SELECT and run without installing SQL.

The exact candidate identity and per-team effects are shown privately in the owner
chat, not published in this repository. Regenerate with the committed preview
script; that live result, rather than a public copy, is the approval basis.

The earlier preview had no blocker; the 18:06 follow-up found an in-flight race,
so immediate retirement is currently deferred. Team, rider and result records
remain. Regenerate immediately before approval and recheck before mutation.

## Original implementation verification (before review follow-up)

- Final `scripts/verify-local.ps1`: exit 0. Isolated backend 118 passed;
  main backend 9,403 passed, 3 existing skips; frontend 3,181 passed; build passed.
- Real migration integration: 29 tests. Includes all three live offer statuses,
  all three terminal statuses, transaction rollback, budget/idempotency, signup,
  draining, claims, settlement, frozen/test accounts and read-only planner parity.
- PostgreSQL concurrency harness: four passed, isolated server stopped. Two
  retirements, signup versus retirement, first-stage claim, and entry batch locks.
  Harness used PostgreSQL 18.4; production is 17. No claim of identical versions.
- Playwright: 814 passed, 26 existing skips across all three configured projects.
- Audit regression tests reject unmarked excess, marker without obligation and
  a fresh marker blocked by a stalled race. All 19 passed.
- Merge helper: seven scenarios passed, including missing, skipped, ambiguous,
  pending and failed league checks. Only the unique successful check passes.
- Independent review completed; stage-one claims, candidate exclusions, auction
  bidders, reservation stability, listing statuses, lock order and swap
  negotiation compatibility were corrected and retested.
- Generated schema snapshot refreshed from canonical read-only pg_catalog queries
  using `buildSnapshot`; production `teams.retired_at` positively verified.

Final preflight: exit 0, backend/frontend lint zero errors and zero warnings.
Token hygiene: zero failures. Existing advisory type snapshot drift is distinct
from the blocking schema-column check. The 16:25 dry-run returned the same team
and effects as the earlier private preview; production remains untouched.

## Derived effects and boundaries

Pool membership drives league occupancy; draining markers stop future automatic
entries and new market obligations. Retirement removes riders from active squads,
rankings and transfer candidates (`TeamPage`, `RidersPage`, `RiderStatsPage`,
`useRiderRankings` consume is_retired); stored team/rider/result/offer history is
preserved. Watchlist removal and its notification share the retirement transaction.
Existing race claims and live market obligations defer retirement. AI prizes create
no cash entitlement and do not defer retirement (owner clarification during review). No rider ability,
valuation, salary or historical result is rewritten. The planner reports affected
riders, offer history and future entries before release; rollback is not a promise
to reconstruct deleted future entries after a successful commit.

The pool patch note was held until activation during review; version 7.268 now
covers the deploy-time AI prize fix. Pool copy remains in the release runbook.
No layout changed. Doc-drift search
found no new environment variable, route or deploy target requiring ARCHITECTURE.
Postmortem records the ignored guard and #4233's closure with a decision unresolved.

## Still required after owner go

Follow [the release runbook](../runbooks/4753-ai-pool-retirement-release.md).
It is the single checklist for activation, measured pool recovery and enforced
GitHub checks. Until its observed close-out criteria pass, #4753 remains open.

## Review follow-up evidence

[Critical dispositions](2026-09-09-5066-review-response.md) cover all eight Claude
points and both completed CodeRabbit reviews. Second CodeRabbit run raised one
minor documentation issue; the repeated release checklist above was consolidated.

New integration coverage executes the actual migration with RLS enabled for
teams/riders, denies the authenticated role's RPC call, and verifies service-role
retirement. Other cases cover absent release gate, zero-cash AI prize settlement,
same-blocker replacement at the exact deadline, and obsolete reservation counts.
This is still a purpose-built schema subset, not the complete production RLS and
trigger stack. Four real PostgreSQL concurrency scenarios passed again; server
shutdown was observed. PostgreSQL remains 18.4 locally versus 17 in production.

Reproduce entry-trigger overhead with
`node backend/scripts/test-ai-pool-concurrency.mjs --benchmark` (local isolated DB).
For 10,000 rows, five measured samples after warm-up gave median 303.087 ms without
the new trigger, 503.752 ms with its release gate off, and 1,058.562 ms enabled.
An earlier run gave 190.780 / 327.211 / 589.059 ms respectively: host contention
matters. These measure incremental fixture overhead, not production capacity;
there is no owner-approved latency target, so no performance-SLA green is claimed.

Final review verification: TIER FULL passed with 118 isolated + 9,412 main backend
tests (3 existing skips), 3,181 frontend tests and build. Preflight passed; backend
and frontend lint each reported zero errors/warnings. CI contract tests: 22 passed.
Token hygiene: zero failures; existing advisory warnings are retained.

Browser evidence is deliberately not reported as an entirely green full run:
all three projects completed with 812 passed, 26 skipped and two mobile-webkit
failures (season matrix click stability timeout, SEO route React hydration #418).
Both passed alone with one worker and unchanged code/assertions. That does NOT prove
a hydration error harmless or exclude an intermittent player bug; #4925 already
tracks this class and remains open. PR stays draft. An earlier concurrent browser
run was interrupted after timeouts; concurrent backend had a cache-test ECONNRESET
before the successful isolated TIER FULL run. These failed attempts are not hidden.
