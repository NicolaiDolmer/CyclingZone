# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (22/6 nat): merge #1709 + #1710 → final rehearsal → PROMPT-2-relaunch.** Kalender-wiring + cadence-fix er PR-klar (verify-local grøn, INGEN migration, ejer merger). #1708 v5.93 patch-notes allerede merged. **Afgjort 22/6:** økonomi #10/#11 = INGEN ændring; #1137 = flip ON peakAge=28 ved relaunch; squad-cap = hard-cap; **fuld pyramide** (WT i tier 1-2 = `DEFAULT_TIER_RACE_CLASSES` uændret); **launch-cadence 2 etaper/dag** (~4-ugers afvikling).
> - **PR #1709 (kalender-wiring):** `materializeSeasonCalendar` koblet ind i `relaunchOrchestrator` (efter 0→1+AI-fyld, skip i dryRun, ikke flag-gatet) + `transitionToNextSeason` (gated bag nyt `auto_calendar_enabled`-flag, fail-safe OFF, mønster som autoPrizeFlag). 8 TDD-tests.
> - **PR #1710 (cadence-fix):** `planRaceSchedules` pakker etaper tæt (`STAGES_PER_DAY=2` → ~4-ugers afvikling, op fra ~85 dage da 7 puljer delte globalt cap=5); `MAX_STAGES_PER_DAY` 5→30. Fixer dødt-langsom afvikling.
> - **POST-LAUNCH (udskudt, ejer-besluttet):** fuld **140-etaper/5-per-dag/28-dages-vision** rører `race_days_total` (board-mål/sponsor/progression, 28 filer) → ordentlig SIMULERET slice efter launch (spawned task).
> - **KRITISK VEJ:** (1) ejer merger #1709 + #1710. (2) **final rehearsal** på final main (`run-relaunch-rehearsal.mjs` mod disposabel klon) → verificér per-division-kalender materialiserer (races m. `league_division_id` + profiler + schedule pr. live pulje; div 1+2+3 fyldt, div 4 tom) + accept-checks. (3) **PROMPT-2 destruktiv relaunch** (`docs/runbooks/2026-06-22-forever-relaunch-prompts.md`): backup → `seedRacePool --prune` → dry-run → reset (clearAllAiTeams+AI-fyld+kalender) → backfill → flags ON (+ **#1137 peakAge=28**) → post-verify → comms (in-app broadcast + Discord).
> - **FAST-FOLLOW efter reset:** fuld 140/5-rekalibrering · Discord #7/#13/#14/#15 · frontend de-slop #3/#4/#8 · ægte højdeprofiler #1021. **Åbne ejer:** #1276 PCM-IP · #929 leaked-pw · #691 key-rotation · #940 NPS. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

> **✅ 18/6-relaunch:** frisk uafhængig sæson 1 LIVE (22 hold, fiktive ryttere, race_engine_v2/daily_training/academy on). Forever-relaunch (epic #1105) = ét sidste reset → permanent; fundamentet er klar. Postmortems: `.claude/learnings/2026-06-18-*`.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701; (a) op/nedrykning gated sæson 3).
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
