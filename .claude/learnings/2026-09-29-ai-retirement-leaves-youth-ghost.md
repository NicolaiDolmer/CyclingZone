# AI retirement left a youth-group ghost (#4753)

## Symptom

The league-size audit was red for two youth groups although each physically listed 24 clubs. One AI club was marked for senior-pool removal but still had riders in ongoing youth and senior races. The audit removed it from all group counts immediately. A different, already retired AI club still occupied two youth group columns and made those groups look healthy despite having no riders.

## Cause

The senior AI retirement path was written before youth group membership became independent. `retire_ai_pool_team` cleared `league_division_id` and retired riders, but left `u23_league_division_id` and `junior_league_division_id`. The audit applied one pending-removal filter to all three memberships and did not exclude retired teams from youth groups.

## Prevention

Count a race-bound pending AI in youth groups until its obligation ends, while continuing to reserve its removal from the overfull senior pool. On retirement, clear both youth group pointers and assign a distinct startable AI reserve inside the same transaction; fail the whole retirement if no safe reserve exists. Test both an existing ghost and a club still in a stage race against the actual SQL migration, and keep a read-only dry-run separate from owner-gated production apply.

## Verification boundary

Local PostgreSQL and PGlite tests can prove the transaction and rollback paths. The current retired ghost requires a separate owner-approved production repair after the migration is merged and deployed. Never report live group occupancy green before that repair is measured.

**Merge-review correction (29/9):** a roster count is not a startable-field check. Both SQL replacement and read-only preview must exclude pending transfers and injuries through the Copenhagen date. Explicit time and a midnight-boundary regression prevent the eligibility check drifting with the test clock.
