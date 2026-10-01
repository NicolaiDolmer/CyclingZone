# Training integrity audit and approved package 1
Date: 2026-09-29. Refs #5888 #5884 #5907 #5912 #5915.
Sources: read-only production queries; current main; fixed-date production-function probes; Discord game/feedback channels for the preceding 48 hours. Exact calibration values and player identities are excluded from this public report.
SSOT: [Training](../TRAINING_RULES.md), [Progression](../PROGRESSION_RULES.md), [Youth](../YOUTH_RULES.md), [Calendar](../CALENDAR_RULES.md), [Race engine](../RACE_ENGINE_RULES.md).

## Verified findings
- Single-day individual results use gc while the training lookup required stage. A gc-only production-function probe returned no rider; the corresponding stage fixture returned the rider. Affects senior and U23 single races, independently of the youth-pool lookup fix in PR #5880.
- Youth stage finishers received bound-rest reports before PR #5880 was delivered. Existing reports remain historical evidence; merging corrected code does not repair them.
- Some saved junior entries were absent from the immutable simulated starting field yet received bound-rest training reports. A planned entry is not proof of participation.
- Race finalization grants recovery for gaps between game days while race-day training also processes those days. Gaps are not necessarily full dates without racing. Two independent owners can award recovery for the same time.
- The daily report query returns only the latest run. The daily ability history uses ignoreDuplicates on its date key, preserving the first snapshot rather than the last. Direct production comparison found understated daily history values. These report repairs belong to package 2.
- Training programs remain beta-gated while race-day ticks are on. Without access to program cells, the legacy day setting repeats across the date's slots.

## Fatigue, form and development verification
No numeric balance target is certified by this audit.
A deterministic synthetic comparison uses the actual applyDailyTick, nextFatigue, nextForm and conditionMultiplier functions, explicit dates and seeded cohorts. It compares the configured calendar cadence with the race-day cadence. It is not a historical season replay.
With condition held constant, season growth remains close across cadences. With evolving form and fatigue, growth materially diverges for some cohorts. The existing G1 delta-only test therefore does not prove whole-system balance.
Daily fatigue approaches its equilibrium much faster in real time after the cadence change. The observed end-of-day population is also distorted by forced rest and overlapping recovery. A global average cannot establish that fatigue is appropriate.
Current form can reach its maximum through sustained rest, contrary to the owner's newly approved product direction. This requires a calibrated form-model change, not an undocumented constant tweak in a correctness fix.
Limits: synthetic cohorts use fixed caps, no staff, and no sampled injury interruptions. A separate mixed-schedule comparison now includes raceFatigueLoad, raceDayProgram and the same production training functions: prior gap recovery, one recovery owner with evening settlement, and a hypothetical chronological reference. It demonstrates material timing sensitivity; none of these outputs certifies mixed-schedule fairness or optimal strategies. Reproduce with backend/scripts/dev/trainingCadenceAudit.mjs and a private output path.

## Owner decisions and release boundary
Package 1 approved to build in the current chat on 29 September, with explicit fatigue/form/development verification.
Approved design directions:
- An appropriate mix of racing and training can compete with pure training for relevant overall development; targeted training may be best for a specific ability.
- Form represents built sporting readiness. Prolonged inactivity and overload weaken it.
- Assistant proposals need player acceptance for the listed sessions only.
- Non-starters resume their program, subject to injury. Abandoning frees later game days; participation yield follows actual effort.
Concrete coefficients for new form, race matching or proportional abandonment yield are not approved here.
No production repair or feature-flag flip is authorized by this document. Package 1 corrects activity/recovery accounting without retuning constants. Package 2 repairs receipts/history. Historical data repair requires a separate rider-level dry run and owner approval.
Patch notes and SSOT corrections accompany the implementation. Player-facing values and text require owner review before release.

## Verification required
- Correct single/stage result classification without final-GC double credit.
- Senior, U23 and junior scope, including missing youth membership.
- Non-starting entries versus real entrants, missing/malformed snapshots and pending results.
- No duplicate recovery, legacy flag-off behavior, retry behavior.
- Fixed-date daily and season cohorts; no success claim based solely on the delta-only G1 floor.
- Independent diff review, mandatory local/CI checks and production verification after an approved release.


## Review follow-up
The owner subsequently approved total-load normalization in #5928, including
race effort within the date's activity slots. The population-median deviation
is explicitly accepted temporarily; level calibration using actual programs
and efforts is tracked in #5931. The model and the cost difference between hard
and normal training are retained. The combined package still requires explicit
owner release approval.

`trainingCadenceAudit.mjs` now accepts an optional private population fixture.
It compares deployed cadence and gap recovery, the intermediate date-only
proposal, and production total-load normalization. The deployed comparison
includes the single-race result-recognition defect. `buildStageMasks` protects
the canonical zero-based calendar axis with boundary regressions. Outcomes are
projections of saved selections and frozen base plans, not observed incidence
or a historical season replay; injury probabilities assume a healthy start to
each date and do not include later plan changes. Exact outputs stay private.

`trainingConditionCutoverDryRun.mjs` produces a private proposal without a DB
connection. It requires prior-date reports and unchanged effort evidence,
preserves immutable starters, and retains current-condition comparisons.
Activation requires fresh evidence after pausing and draining legacy race
finalizers. The SQL bootstrap remains owner-gated; no execution is implied by
producing a proposal.

The first draft wrongly treated every starter without a ranked result as unsettled. Independent and CodeRabbit reviews identified legitimate DNF as a counterexample. The new check was removed and regression coverage added. DNS handling in this patch releases training only; saved selections and persistent booking rows remain. Durable release requires coordinated JS selection predicates and the database binding rebuild contract, plus owner-approved reconciliation of existing data. This is a reviewable first part of package 1, not completion of all package scope.
Targeted English and Danish training help accompanies the normalization. Broader help consolidation remains tracked in #5885; this patch does not claim the complete help rewrite is delivered.
