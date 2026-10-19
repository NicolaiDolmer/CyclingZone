# #6765 M1 operational readiness

Owner mandate 19 October: off-by-default stage control, queue/pass telemetry,
Sentry budgets, Danish peak exclusion, and a Supabase-branch rebuild/pass
measurement before merge. This extends [PR #6899](https://github.com/NicolaiDolmer/CyclingZone/pull/6899).
No production write, reader swap, feature activation or merge.

## Runtime controls

- ranking_shadow_enabled is seeded off with ON CONFLICT DO NOTHING, belongs
  to STAGE_FLAGS, and is listed in FEATURE_REGISTRY. The registry entry remains
  building with the pending production key in its note; its flag field can be
  set after normal apply (the registry guard requires actual production rows).
- All runtime apply/parity calls share the helper gate. Missing/unknown flag
  and read failure are off. Beta uses the existing engineWrite convention.
  Statement triggers continue to enqueue. Privileged, explicit maintenance
  benchmark calls do not turn on the runtime flag.
- A service-only metrics RPC counts ranking_dirty_log. Each helper invocation
  logs queue_length at entry, pass_ms, enabled and status, including disabled
  runs and failures. Queue >10,000 or pass >20,000ms sends a Sentry budget event.
  Equality at either limit does not alarm. Pass duration includes the helper's
  metrics, flag read, apply and any due parity.
- Daily parity is excluded from [19:00,22:00) Europe/Copenhagen. Client admission
  includes elapsed legacy/apply time; SQL checks its execution clock at admission
  and before each comparison. Tests inject time and cover summer/winter offsets,
  exact boundaries, and a pass crossing 19:00.
  Deferred work remains due. Staging's every-pass option cannot bypass the
  flag or peak exclusion.
- Legacy leases are renewed before metrics, between metrics and the flag read,
  after the flag read even when off, and around parity. Deterministic slow-read
  tests reproduce and prevent loss of legacy completion behind shadow monitoring.

## Branch selection and authorization

Used the existing non-default Supabase branch staging-cutover,
project ref pywxpnynzmbukdvoiazp. Issue #6751 was verified CLOSED/claude:done,
delivered via merged #6753 on 17 October; its latest comment confirms completion.
The current NOW references separate future rehearsals. The owner explicitly
approved pre-merge branch apply for measurement, flag off, no production access.

The new-branch tool returned Invalid or expired requestState and created no
branch (verified with list_branches). No temporary branch was created or deleted;
deletion timestamp is not applicable. The existing staging branch was retained.
It continues to hold the measured shadow objects with the runtime flag off.
Final migration replay was verified at 12:59:13 UTC: queue 0, flag off, SQL peak
deferral active and only the new two-argument parity overload present.

The clean loadtest wrapper and assertLoadtestIsolation returned ISOLATED with
zero blockers. The driver validates the exact API/DB ref and loadtest marker,
rejects production refs, and checks flag off before every batch. No source
result was inserted, updated or deleted. Only additive M1 objects, the off seed
and shadow queue/aggregates were written.

## Measured result

19 October 2026, 14:41 Danish time. PostgreSQL 17.6 on Supabase.
Raw evidence: [JSON](2026-10-19-6765-supabase-branch.json).

| Measurement | Result |
|---|---:|
| Source results before / after | 2,307,176 / 2,307,176 |
| Races with results / all races | 1,778 / 1,909 |
| Contribution rows after rebuild | 199,016 |
| First complete rebuild, summed SQL time | 30.191898 s |
| First rebuild client elapsed (TLS/process overhead included) | 42.683166 s |
| Rebuild transactions | 11 (repair expansion + bounded race batches) |
| Largest individual transaction | 4.121627 s |
| One pass, race selected at p95 of source-row count | 0.231499 s |
| Source rows in that selected race | 4,000 |
| Queue after completion | 0 |
| Runtime flag before / after | off / off |
| Differences, all four outputs, both EXCEPT ALL directions | 0 |

The rebuild total is not one long transaction: no measured batch exceeded
4.13s. The benchmark drained back-to-back; production's scheduled drain cadence
is separate. The single-pass number is one observation on a p95-size race,
not a measured latency percentile. These numbers do not prove M2's observation
period or production-compute SLA.

## Reproduction

Local verification after operational review: 60 helper/coordinator/catalog/driver
tests and 19 SQL checks passed; strict TypeScript passed. The broad backend run
covered 969 files in two Windows-safe batches. Its only three failures were the
new RED lease/peak regressions; their corrected files subsequently passed in
the 68-check combined run and final targeted run. The isolated economy pass
passed all 141 tests. Existing engine TODO cases remain TODO, not new failures.
Frontend source and dependencies are unchanged; its earlier 4,819 unit tests
and build remain the baseline. Independent diff review has no remaining findings.

    pwsh -File scripts/verify-lock.ps1 -Max 2 -- pwsh -Command "& './scripts/staging/with-loadtest-staging.ps1' -Command @('node','scripts/measureRankingShadow6765.mjs','--apply-migration')"

Only use with a fresh, authorized shadow state on the approved staging branch.
The driver refuses to reset an existing rebuild. Credentials remain in the clean
child environment and are not printed or written to the evidence file.
Source data are the pre-existing synthetic/anonymized loadtest fixture.

Patch notes exempt: off-by-default operational controls do not change player
output, text or mechanics. Claude retains merge/production apply/review-marker
ownership. T7 distributional checks and M2 observation gates remain separate.
