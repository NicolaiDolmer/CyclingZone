# #3546 — wipeSeason3Calendar.mjs dry-run mod prod (2026-08-20)

100 % read-only. Ingen skrivning. Kørt via:

```
cd backend && infisical run --env=prod -- node scripts/dev/wipeSeason3Calendar.mjs
```

## Output

```
=== #3546 wipe af S3-kalenderen ===
TILSTAND: DRY-RUN (skriver intet)
Database: ghwvkxzhsbbltzfnuhhz

Sæson 3: id=00000000-0000-0000-0000-000000000003 · status=upcoming · race_days_total=60 · race_days_completed=0
Sæson-port: OK — status er 'upcoming'.

Races for season_id=00000000-0000-0000-0000-000000000003: 430
   status-fordeling: scheduled 430

── Kalender-form (slettes altid sammen med races) ──
   race_stage_schedule    1.138
   race_stage_profiles    1.138

── Gameplay-port (0 forventet for en 'upcoming'-sæson — ikke-nul stopper HELE kørslen) ──
   ok       race_stage_roles       0
   ok       race_stage_passages    0
   ok       race_stage_moments     0
   ok       race_simulation_runs   0
   ok       race_incidents         0
   ok       race_withdrawals       0
   ok       race_entry_clears      0
   ok       race_entries           0
   ok       pending_race_results   0
   ok       race_results           0
   ok       board_satisfaction_events 0
   ok       rider_career_events    0
   ok       rider_peak_plans       0
   ok       finance_transactions   0

teams.my_result_seen_race_id peger på et S3-løb: 0 hold (nulles ved apply, ikke gated — ren UI-seen-state).

Gameplay-port: OK — 0 rækker i alle 14 gate-tabeller.

=== PLAN ===
Races der slettes:              430
race_stage_schedule            der slettes: 1.138
race_stage_profiles            der slettes: 1.138
teams.my_result_seen_race_id der nulles: 0

Bemærk: season.race_days_total (nu 60) bliver IKKE genberegnet af dette script.
Det sker automatisk (recomputeSeasonRaceDays) når kalenderen re-materialiseres — orkestratorens næste skridt.

DRY-RUN slut — intet skrevet. Kør med --apply --jeg-har-set-dry-runnet for at skrive.
```

## Konklusion

Matcher konteksttallene fra forberedelsen præcist: 430 races, 1.138 stage-profiler,
1.138 schedule-rækker, 0 entries/resultater. Gameplay-porten (alle 14 FK-afhængige
gate-tabeller fundet i `database/schema-snapshot.json`) er ren — wipen er sikker at
applicere. `--apply` er IKKE kørt af denne session (ingen mutationer mod prod, jf.
opgavens punkt 6) — det er orkestratorens skridt efter ejer-go.
