# #6490 · `rider_training_seen` erstatter GIN-opslaget i træningsrapporter

**Dato:** 2026-10-12 · **Status:** ejer-godkendt 12/10 (styringssession: "Ja, byg nu") · **Kilde:** uafhængig Fable-arkitektgennemgang (read-only mod prod + repo) efter Codex-status på #6490.

## Problem (prod 12/10)

- `idx_training_day_runs_report_riders` = `GIN ((report -> 'riders') jsonb_path_ops)`: **846 MB**, heap 14 MB, **37 idx_scan**. `reloptions` null (fastupdate=on).
- Codex' staging-måling: GIN = 68 % af afregnings-WAL; værste kald 20,35 s, heraf 124,78 MB WAL fra GIN.
- `commit_training_date_tick` skriver `UPDATE training_day_runs SET report=…` 5× pr. hold-dato: 8.103 kald siden 6/10, 8.045 MB WAL (~1,0 MB/kald), mean 286 ms, max 45,5 s.
- Diskpres: en read-only aggregat-query fik `No space left on device` på `pgsql_tmp`. GIN vokser med al historik; den nye tabel vokser kun med antal ryttere.

## Læsere af `report->'riders'` mod tabellen

| Læser | Spørgsmål | Kritikalitet | Sted |
|---|---|---|---|
| `initialize_first_use_rider_condition` (trigger på `riders`) | Har rytter X nogensinde optrådt i en rapport (når ikke i `training_rider_ticks`/`training_race_loads`)? | spillervendt, latenskritisk (#6450) | `database/2026-10-11-academy-sign-latency.sql:99-100` |
| `register_training_date_work` | samme for frossen trup uden `rider_condition` | aftenafregning | `database/2026-10-10-6439-training-follows-rider.sql:59-60` |
| `apply_training_compensation_6061` | samme, vagt mod nulstilling | admin/recovery | `database/2026-10-05-6129-compensation-slim-source.sql:176` |
| `scripts/trainingRecovery5928.apply.mjs:148-149`, `trainingRecovery5928.snapshot.sql:32` | findes kanonisk rapport for rytter + optælling | ejer-gated recovery | repo |
| `backend/scripts/dev/prepare6061TrainingRecovery.mjs:67` | hele rapporter pr. rytter via PostgREST `.contains` | dev/recovery | repo |

Rapportvisning i frontend/backend læser pr. `team_id`/`tick_date`/`game_day` via btree; ingen GIN-afhængighed. `commit_training_date_tick` læser kun parameteren `p_report`.

## Data

- 42.827 runs, 974.870 rytter-entries, 589 hold. Per-date-sti (29/9→): 17.157 runs/542.264 entries, som allerede ligger én række pr. (rytter, sæson, løbsdag) i `training_rider_ticks`.
- **Legacy-sti kører stadig:** 2.023 runs med `game_day IS NULL` siden 29/9 (143 hold), skrevet af `dailyTrainingEngine.js` via PostgREST. Deres ryttere findes ikke i `training_rider_ticks`.
- 4.197 ryttere findes kun i legacy-rapporter; 131 af dem har ingen `rider_condition`.
- Alle `rider_id` i rapporter er JSON-strings med kanonisk lowercase-uuid (stikprøve 329.076, 0 afvigelser).

## Valgt løsning

Tabel `rider_training_seen(rider_id uuid PRIMARY KEY, first_seen_date date, first_team_id uuid, first_run_id uuid)`. Ingen FK til `riders` (historik overlever rytteren).

- **Vedligehold:** `AFTER INSERT OR UPDATE OF report ON training_day_runs FOR EACH ROW`-trigger: `INSERT … SELECT DISTINCT rider_id … ORDER BY rider_id ON CONFLICT DO NOTHING`. Dækker RPC-sti, legacy-PostgREST-sti, recovery og repair uden kodeændring. Insert-only, sorteret, ingen rækkelåse ved konflikt.
- **Rebuild:** funktion `rebuild_rider_training_seen()` genberegner fra runs ∪ `training_rider_ticks` ∪ `training_race_loads` (sekunder). Kaldes af `betaResetService` og recovery-rollback (triggeren håndterer ikke DELETE).
- **Backfill:** ca. 13.000 rækker, under 2 MB, idempotent.
- **Læserskift:** kun JSON-leddet i de tre funktioner erstattes med `EXISTS (SELECT 1 FROM rider_training_seen WHERE rider_id = …)`. Recovery-scripts opdateres (prepare6061: læs via `training_rider_ticks`, legacy-fallback via `tick_date`).

Fravalgt: M-par-tabel (#6511/#6518; ~975k rækker, redundant med `training_rider_ticks`), L-tæller (#6507-#6510; deadlocks), genbrug af `training_rider_ticks` alene (legacy-stien dækkes ikke), `fastupdate=off` (flytter omkostningen, ikke en løsning), GIN på udtryk (stadig pending-list).

## Udrulning

1. **PR (én):** tabel + trigger + rebuild-funktion + backfill + læserskift i de tre funktioner + recovery-scripts + `docs/TRAINING_RULES.md`. GIN bevares. Migration applies post-merge (#2642), post-verify `pg_proc` + paritet.
2. **Paritet:** `EXISTS(seen)` ≡ gammelt JSON-prædikat for alle ryttere = 0 afvigelser, før og efter læserskift (read-only SQL).
3. **Observer 2 aftener:** `pg_stat_statements` wal_bytes/kald for `commit_training_date_tick`, max-tid, paritet dagligt.
4. **Separat ejer-go:** `DROP INDEX CONCURRENTLY idx_training_day_runs_report_riders` (frigør ~850 MB). Rollback = `CREATE INDEX CONCURRENTLY` (minutter, ikke øjeblikkelig).

Rollback før trin 4: gen-apply de tre funktioners forrige definition; drop trigger + tabel.

## Måling og mål

Lokal PostgreSQL 17 (mønster `backend/routes/rankings.5692.test.ts`, `RANKING_TEST_PG_BIN`) med kopi af de berørte tabeller; 100 `commit_training_date_tick`-kald × varianter (GIN i dag / ny løsning uden GIN). Mål: **WAL < 50 KB/kald** (i dag ~1,0 MB), **max < 2 s**, `register_training_date_work` + trigger uændret latens, **aftentræning færdig < 2 min efter sidste etape**.

## Åbne punkter (egne issues)

- Legacy-stien (143 hold, `game_day IS NULL`) bør lukkes, så alle hold kører per-date-stien.
- 131 legacy-ryttere uden `rider_condition` (#6061-rest).
- Diskplads/`pgsql_tmp` ENOSPC skal tjekkes i Supabase-dashboardet.
