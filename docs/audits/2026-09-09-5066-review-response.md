# #5066: critical review response

SSOT: TRANSFER_MARKET_RULES.md, GAME_INVARIANTS.md, CALENDAR_RULES.md,
ECONOMY_RULES.md. Owner design-go and replacement after 120 hours of the same
blocker were approved in the 9 September chat. Production go remains outstanding.

## Claude Code review

| Point | Decision and evidence |
|---|---|
| 1. Migration activation | Safety concern accepted. Original PR already prohibited merge before go; it did not promise an inert merge. The proposed existing flag is already ON in prod, so added an independent absent/off release gate, checked by SQL and backend entry generation. Migration never enables it. Tests exercise legacy on/new absent: no reservation, market/entry rejection or retirement. |
| 2. Dependabot | A credential skip cannot satisfy a mandatory invariant. Trusted default-branch workflow_run audit after CI publishes one check on the exact PR head. No PR code/artifacts/cache is consumed with production secrets. Tests cover bot/fork metadata, stale heads, failed measurements, reruns and private report redaction. Real event proof remains a post-merge gate. |
| 3. Repository-wide blocking | Kept the owner's policy and made its consequence explicit: red league health blocks ALL PRs, including docs/dependencies. Exceptions need exact owner-approved PR/SHA and follow-up evidence; the queue has no bypass switch. Main protection changes only after fresh green proof. |
| 4. Patch-note timing | Historical four-pool statement is true; present-tense repair claim was premature. Held the pool note in the runbook until live verification. Deploy note describes AI prize fix, effective with backend deployment. |
| 5. SQL tests/performance | Actual migration runs with grants, FK rollback, RLS-enabled service execution and real PostgreSQL concurrent connections. Fixture is a subset, not every prod trigger/policy. Added reproducible 10,000-entry baseline/gate-off/enabled benchmark; entry hot path avoids JSON conversion. This cannot establish a production SLA. |
| 6. Legacy wipe | Five existing tests contradicted 'untested', but lacked mixed retained history. Added coverage: active unowned AI only; preserve retired teams/riders/history; refuse transfer FK references before first deletion. Still an owner-authorized maintenance reset, never the live repair API. |
| 7. Stuck reservation | Owner approved switching after 120 hours of SAME blocker. Boundary tests cover before/at deadline, changed reason, retained old team/offer. Only an unblocked replacement can leave. Owner also clarified no AI prize cash. Verified old AI credits read-only; excluded future AI/bank payouts and prizes as a retirement/audit exemption. Historical accounting remains. |
| 8. CodeRabbit | CLI 0.7.6 authenticated after owner's browser login. Real CLI review completed with seven issues; dispositions below. It is distinct from the previous independent review. |

## CodeRabbit's first completed review: 7 issues

| Severity | Issue | Disposition |
|---|---|---|
| Major | Release ignores dormant pools | General active-24/dormant-0 SSOT clarified; retained incident criterion of all 15 currently active pools at 24. A changed population must be explained. |
| Major | cleared/guard always empty | Reservation RPC returns actual cleanup count; sweep reports it and transaction rejection reasons. Regression exercises real obsolete-marker cleanup. |
| Major | Composite pagination order | Added rider_id after race_id for entries, stage_number after race_id for schedules. |
| Minor | Compression preview ignores frozen/test occupancy | Included stationary occupancy in targetAiCountForPool's third argument. |
| Minor | Colon without following list | Corrected evidence sentence. |
| Minor | Keep NOW lock until activation | Rejected: lock means active session, not unfinished release. Pending work remains in issue/runbook. |
| Minor | #4233 mistaken for heading | CommonMark requires a space after heading hashes. Original was valid; rephrased 'Issue #4233' for readability. |

GitHub sources: [workflow_run trust boundary](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[Dependabot restrictions](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions).
Documentation and local mocks do not replace observing the deployed event/check.

Second completed CodeRabbit review of the updated diff: **1 minor issue**, repeated
release conditions in the evidence note. Consolidated into the canonical runbook
reference. No new code issues were raised; this does not replace verification.
