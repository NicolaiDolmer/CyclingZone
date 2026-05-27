# Achievements sync failed on parallel board profiles

**Dato:** 2026-05-27
**Symptom:** `/api/achievements/check` kunne fejle for managers med flere board-planer, fordi achievement-sync stadig antog én `board_profiles`-row pr. hold.

## Hvad skete der?

Board-redesignet ændrede runtime-modellen fra `UNIQUE(team_id)` til parallelle rows per plan type (`UNIQUE(team_id, plan_type)`). Achievement-engine fulgte ikke med og brugte `.maybeSingle()` på `board_profiles.eq("team_id", teamId)`, hvilket kan returnere Supabase-fejl når et hold har 5yr/3yr/1yr-planer.

## Root cause

Kodekontrakten i `backend/lib/achievementEngine.js` var baseret på den gamle single-board-profile-model. Stale docs/schema snippets beskrev også `team_id` som unique, selv om `database/2026-04-24-board-parallel-plans.sql` havde ændret runtime-kontrakten.

## Fix

`loadTeamStats` læser nu alle board-profiler for holdet, ignorerer baseline/pending rows, og bruger højeste satisfaction fra completed non-baseline plans. Regressionstest dækker parallel board plans med baseline + pending row.

## Forhindret-fremover

Regressionstesten simulerer Supabase `.maybeSingle()`-fejl ved flere rows, så gamle single-row-antagelser ikke glider tilbage. `ARCHITECTURE.md`, `database/schema.sql` og `database/supabase_setup.sql` er afstemt til `UNIQUE(team_id, plan_type)`.

## Læring

Når en model går fra single-row til parallelle rows, skal alle `.single()`/`.maybeSingle()` callsites grep'es i samme slice. Docs/schema-drift kan skjule den gamle antagelse og gøre fremtidige fixes usikre.
