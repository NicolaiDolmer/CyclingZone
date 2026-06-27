# Race calendar model — design (2026-06-27)

> Status: **design locked with owner (Nicolai) 2026-06-27**, build pending owner-go + solo session.
> Supersedes/extends the parked 140-stage slice [#1712] and folds in the scheduler-overlap root cause [#1856].
> Nothing touches prod until the owner confirms a solo session and gives explicit go (calendar regeneration mutates prod).

## Why

The live race calendar is structurally wrong (verified against prod 2026-06-27):

- **Pools within a division do NOT share a calendar.** They should run the *same* races in parallel; today each pool got its own mismatched calendar (Div 2 pools: 54 vs 46 stage-days; Div 3 pools: 41/37/34/40).
- **Divisions are not synchronized on dates.** Div 6 finishes 10/7, Div 1 not until 31/8 — different lengths, so promotion/relegation between them is unfair.
- **Only Division 1 has the full 140 stage-days.** Div 2–7 have 34–54.
- **The shape is wrong.** Div 1's 140 stages are stretched over 66 real days with a lumpy 5→2→1 taper; one-day races are crammed into the first week with 5 *different* concurrent races/day (unrealistic).
- **Binding keys on the real-world (CET) date, not an in-game day.** `race_stage_schedule` has only `scheduled_at` (an IRL timestamp); there is no in-game-day field. So several races compressed onto the same real afternoon are treated as "same day" and a rider is wrongly blocked from all but one — including two one-day races that should both be rideable.

## Verified data model

- `league_divisions` = 15 rows = the full pyramid: tier 1 (1 pool), tier 2 (2 pools A–B), tier 3 (4 pools A–D), tier 4 (8 pools A–H). `league_division_id` is a **pool**, not a tier; the tier is the `tier` column.
- Current population: Div 1 = 28 teams / 4 real; Div 2 (ids 2–3) = all AI; Div 3 (ids 4–7) = ~41 real teams; Div 4 (ids 8–15) = **empty**. Most real managers are in Division 3. (Flagged for separate review — team placement / relegation.)
- `races` has `scheduled_for`, `race_type` (`single` | `stage_race`), `stages`, `league_division_id`, `pool_race_id` (shared template id). `race_stage_schedule(race_id, stage_number, scheduled_at)` — per-stage IRL timestamps, **no in-game-day**.

## Locked model (owner decisions 2026-06-27)

1. **Calendars are per-DIVISION (tier), not per-pool.** Each division has its own set of races. The **pools within a division run that same calendar in parallel** (each pool = its own field/competition). Example: Division 3's 4 pools all run the same race, as 4 parallel instances.
2. **Only DATES are synchronized across divisions** — same season start/end + timeline. The races differ per division (Div 1 the biggest, down to Div 4).
3. **Race-days scaled per division.** Top division ~140 race-days, decreasing down the pyramid (lower divisions race less, like real life). Same date span; lower divisions just have more empty/rest days. (Must verify the `race_pool` catalog has enough distinct races per tier — esp. tier 4, noted as ~44 in #1712.)
4. **Explicit in-game race-day.** Introduce an in-game-day number per stage, separate from the IRL simulation timestamp. Compression (several stages per real day) is pacing only.
5. **Binding keys on the in-game day.** One rider, one race per in-game day. It bites **only when two _different_ races coincide in-game**. A stage race's own stages never block its riders. Two one-day races on different in-game days are both allowed even if simulated the same real afternoon.
6. **Calendar shape mirrors real life.** Mostly 1–2 races at a time; **overlap is allowed and expected but not every race overlaps**. One-day classics **spread across the whole season** (not clustered). Stage races **compressed up to 5 stages per real day**, and may overlap other races (incl. grand tours overlapping smaller races).
7. **HARD CONSTRAINT — a season is at most 28 real days. Non-negotiable.**

## Verified packing (Division 1)

Greedy 28-day pack of Div 1's existing 33 races (`scratchpad/pack.mjs`): 3 grand tours (21 stages, 5 real days each) as the spine at days 1/12/23; 9 smaller stage races (compressed ≤5/day) + 21 one-day classics overlapping. Result: **maxDay = 28, all 140 race-days fit, 24 days @ 2 concurrent / 4 days @ 1.** Confirms the model is feasible within the hard cap. Lower divisions (scaled) will be lighter.

## Locked decisions (owner, 2026-06-27 — Phase-1 gate)

- **Sequencing:** Division 3 FIRST (phased) — build the new model, apply to Division 3 (from-scratch reset + new calendar), verify live, then roll the full all-division rebuild as the next controlled step. The race-days=60 load-bearing audit (R1) belongs to that follow-up.
- **D3 prize-reversal scope:** contained — reverse only the 40 Division-3 teams' OWN prize (1,328,625), NOT cross-division loaned-rider earnings (the wider 1,644,150 / 95-team scope is rejected).
- **No-economic-harm:** an interest-free LOAN (0%, repaid from future earnings), not a free grant — requires a new 0% loan path + repayment tracking (no zero-interest row exists in `loan_config` today). 6 teams go negative, total 238,603.
- **Per-tier scaled race-day targets (proposed, confirm at final gate):** t1≈140, t2≈110, t3≈80, t4≈44 (tier-4 catalog-capped at 44 → blocks tier-4 go-live until #1734; non-breaking today as tier 4 has 0 live pools).
- **Verified catalog capacity:** 121 distinct races / 376 race-days. Per-tier ceilings: t1=162, t2=264, t3=197, **t4=44**.
- **Calendar shape (locked via visual iteration with owner, 2026-06-27):**
  - A race on EVERY one of the 28 IRL days, in every division — no empty days.
  - One-day classics: many, spread evenly across the whole season (not clustered). Div 3 ≈ 18-20 of the 42 catalog classics.
  - Overlap is a deliberate MIX, not uniform: some stage races run fully SOLO (no overlap, a signature race), some share a day with a one-day classic, and occasionally two stage races overlap each other. Never every race overlapping.
  - Density scales by division: dense in Div 1 (mostly 2 concurrent, packing 140 race-days), lighter down the pyramid (Div 3 ≈ 60% one-race days / 40% two-race days; ~3 solo stage races, ~3 stage-on-stage days).
  - Stage races compressed at ≤5 stages/real-day, fewer in lighter divisions so they span more days and help fill the calendar.
  - Verified Div-3 illustrative pack (`scratchpad/packd3d.mjs`): 9 stage races (incl. Boucles Mayennaises) + 18 classics = 27 races over 28 days, 0 empty days, 3 solo / 3 stage-on-stage / 11 two-race days.

## Open tuning (not blocking)

- Grand-tour solo-vs-overlap pattern (could keep GTs more solo).
- Per-division race-day targets + verify `race_pool` capacity per tier; tier-4 catalog may need expansion (#1734).
- Whether occasional 3-concurrent is acceptable in the densest packing.
- Division 4 is empty / real managers concentrated in Div 3 — team placement is a separate question.

## Build plan (owner-go + solo session)

1. Add the in-game-day field/model to the schedule (or derive a stable in-game-day ordinal) + migration.
2. Rewrite the calendar generator: one shared calendar per tier, scaled race-days, 28-day packing with realistic overlap, spread classics, compressed stage races; materialize the same calendar across each tier's pools.
3. Move binding (`raceBinding.js` + the PUT /selection 409 + runtime autofill) to the in-game day; keep stage-internal stages non-blocking.
4. Regenerate all divisions; synchronize start/end dates across tiers.
5. Recalibrate `race_days_total` (60→ per-tier) + the proportional/absolute thresholds listed in #1712 (run board-satisfaction + money-supply harnesses; owner approves the numbers).
6. Forward-guards: keep divisions date-synchronous; only create overlaps that are fillable; a DB-level or advisory-lock guard for the binding invariant (the structural gap behind the #1844/#1845/#1823 double-booking class).

## Related

Calendar: #1712 (140-stage vision), #1146 (shared-calendar design), #1734 (catalog expansion), #1774 (count mismatch), #1899 (per-division race_days), #1825 (S2b cursor/desync — orphaned obligation).
Scheduler/results integrity (separate but adjacent workstream): #1856 (overlap root cause), #1845/#1844 (engine fixes, merged), #1848/#1861 (Boucles rerun — owner-go, money mutation). See the race-rerun problem map (workflow `race-rerun-problem-map`, 2026-06-27) for the full corruption/rerun picture.
