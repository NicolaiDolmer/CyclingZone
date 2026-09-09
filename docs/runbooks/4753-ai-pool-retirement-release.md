# #4753: owner-gated release and verification

SSOT: TRANSFER_MARKET_RULES.md, GAME_INVARIANTS.md, CALENDAR_RULES.md.
Design-go was given in the owner chat on 9 September. Production go is separate.
The migration activates signup reservation/draining; a deployed sweep can retire
teams automatically. Therefore **do not merge or apply it before production go**.

1. Generate a fresh read-only preview with
   `node backend/scripts/preview-ai-pool-retirement-sql.mjs` and execute that SELECT
   against production. This inlines the migration's exact SQL planner without DDL.
   Show the owner team UUID/name, pool, rider count, preserved offers, zero deleted
   offers and future entry removals. Also show counts for all 15 pools.
2. Obtain explicit go for that live state and the release. If repair needs a red
   invariant exception, only the owner can approve it; record reason, exact PR and
   SHA, time and follow-up verification in #4753. The queue has no bypass switch.
3. Merge only that reviewed PR. Observe the migration workflow, schema functions
   and grants read-only, then observe the next backend/frontend deployments READY.
   Do not chain this with a repair. Automatic reconciliation may already finish it.
4. Re-measure first. If a team still needs manual retirement, run another dry-run
   and check it matches the owner's approved scope. The repair CLI accepts only
   `--apply --owner-go --team=<approved UUID>`: one retirement per invocation.
   It rechecks eligibility and pool budget in the transaction and rejects deferral.
5. Verify all 15 physical pool counts are 24, no unexplained pending state, and
   team/rider/history/offer preservation. Observe a fresh PR run of the uniquely
   named `league-size-invariant` check. A local test or a different `audit` is not proof.
6. Read GitHub main branch protection and preserve its existing settings while
   adding `league-size-invariant` to required status checks (GitHub Actions app).
   Read back the setting and exercise the merge queue with `-DryRun`. A missing,
   skipped, pending, ambiguous or failed league check must prevent a real merge.
   PRs without Supabase credentials fail rather than silently passing; configure
   Dependabot secrets or a reviewed trusted audit path before releasing those PRs.
7. Update GUARD_INVENTORY with observed failure AND successful enforcement, replace
   the local-only verification stamps in SSOT with release evidence, update #4753
   and related #4826/#4829 by their measured state, and clear docs/NOW.md's lock.
   Never mark the task done just because the implementation PR merged.
