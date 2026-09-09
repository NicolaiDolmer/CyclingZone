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

Latest measurement: 120 AI in pools; three have live offers. The issue's own-rider
criterion and the expanded seller-or-rider criterion both gave 10/7. No bank AI
was included; the reason for the live population change is not established.
Pools 1-15 are at 24 except pool 13, Division 4 F, at 25. No pending markers.
Retirement was already deployed by #4762 on 4 September; flag on, verified 9/9.
This contradicted the original C premise, so implementation followed the owner's
subsequent explicit retirement design rather than the obsolete deletion plan.

The exact migration planner was inlined as SELECT and run without installing SQL:

The exact candidate identity and per-team effects are shown privately in the owner
chat, not published in this repository. Regenerate with the committed preview
script; that live result, rather than a public copy, is the approval basis.

No current blocker. Team, rider and result records remain. This observation is
time-bound; regenerate immediately before approval and recheck before mutation.

## Observed local verification

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
Existing race claims and unpaid results defer retirement. No rider ability,
valuation, salary or historical result is rewritten. The planner reports affected
riders, offer history and future entries before release; rollback is not a promise
to reconstruct deleted future entries after a successful commit.

Patch note 7.268 includes the historical four-pool incident in Danish and English;
the exact Danish copy was shown to the owner. No layout changed. Doc-drift search
found no new environment variable, route or deploy target requiring ARCHITECTURE.
Postmortem records the ignored guard and #4233's closure with a decision unresolved.

## Still required after owner go

Follow [the release runbook](../runbooks/4753-ai-pool-retirement-release.md).
Observe deployment/migration, remeasure, retire at most the approved candidate per
explicit invocation if still needed, verify all 15 pools physically at 24, observe
a fresh PR's unique league check green, require it in GitHub and prove enforcement.
Only then may incident close-out claim success. Until then #4753 remains open.
