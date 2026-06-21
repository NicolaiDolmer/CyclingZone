# Forever-relaunch — natbølge- + relaunch-prompts (2026-06-22)

> To copy-paste-klare prompts til friske sessioner. **Status ved skrivning (22/6, verificeret):** form-frys LIVE i prod (4-tier/15-pulje pyramide-skema: `league_divisions`=15 puljer, `teams.league_division_id`, `season_standings.league_division_id`, tier-4 økonomi granit-frosset, `MAX_DIVISION=4`, `POOL_TARGET_SIZE=24`) · WS1 race-automatisering ON + §6.1 BEVIST (auto_prize+stage_scheduler, Giro-cyklus kørte auto + auto-prize) · `START_DATE=2026-06-22` · verificeret DB-backup taget (`cz-db-backups/cyclingzone-20260622-004911`, `db:verify-restore` grøn) · alt session-arbejde merged (#1683/#1684/#1685/#1690/#1698). Prod-ref = `ghwvkxzhsbbltzfnuhhz`. Infisical autentificeret (`infisical run --env=prod -- ...`).

---

## PROMPT 1 — NATBØLGE (ultracode, spawn subagenter hele natten)

```
ultracode — natbølge mod forever-relaunch (kør til ~kl. 8). Du driver en fleet af subagenter der bygger 4 launch-readiness-features færdige, så de er klar til go-live i morgen. Selve relaunchen køres i en SEPARAT prompt — IKKE her.

LÆS FØRST: docs/NIGHT_WAVE_RUNBOOK.md · docs/runbooks/2026-06-22-forever-relaunch-prompts.md (status) · docs/superpowers/plans/2026-06-21-forever-relaunch-form-freeze.md · gh issue view 1688/1681/1569/1140/1137. Verificér mod faktisk kode/skema — gæt ikke.

ALLEREDE PÅ PLADS (rør ikke fundamentet): form-frys live (league_divisions=15 puljer tier 1/2/4/8, teams.league_division_id, season_standings.league_division_id, MAX_DIVISION=4, POOL_TARGET_SIZE=24, tier-4 økonomi granit-frosset), WS1 ON+bevist, START_DATE=2026-06-22.

SPAWN parallelle subagenter (én pr. spor, isolerede git-worktrees, branch fra origin/main), hver bygger end-to-end → PR. Arbejd HELE natten: når de 4 er PR-klar, lav completeness-pass + tag flere relaunch-kvalitets-items (AI-slop #1576, onboarding-rest, Discord-sweep #1676) indtil ~kl. 8.

DE 4 SPOR:
1) #1688 AI-FYLD + RACE-SKALA (kritisk, størst): byg AI-hold-generator (opret fiktive AI-hold is_ai=true med ryttere via fictionalRiderGenerator+starterSquadAllocator, tildel puljer per politik: div 1+2 = ALTID AI til POOL_TARGET_SIZE; div 3+4 = AI fylder KUN puljer med ≥1 ægte manager op til target; fjern-AI-når-manager-kommer). Kobl ind efter allocateLeaguePools i relaunchOrchestrator + som runnable script. PLUS ret raceRunner.fillMissingTeamEntries (backend/lib/raceRunner.js) til pulje-filter + 24-cap (ellers proppes alle AI-hold i hvert løb). PLUS DIVISION_SQUAD_LIMITS[4] (boardConstants.js). PLUS StandingsPage pulje-faner (frontend, i dag hardcodet [1,2,3]). Balance-følsomt → simulér mod 100-mgr (moneySupplyScorecard). Migration → ejer merger.
2) #1681 HOLDUDTAGELSE FINDBAR: i dag pr-løb på /races/:raceId (RaceDetailPage → RaceSelectionPanel), ingen global indgang. Gør den prominent/findbar fra dashboard/nav.
3) #1569/#1140 NY-SPILLER-ONBOARDING: strømlin onboarding for ægte nye spillere (handlingsplan i #1569, konsolidér 6+ elementer #1140).
4) #1137 PROGRESSION L0: passiv rytterudvikling/aldring/peak/retirement (SEASON_RIDER_PROGRESSION_ENABLED=false i dag). Byg per #1137-specs. Balance-følsomt → simulér. LAD FLAGET STÅ OFF i PR (ejer flipper ved relaunch efter review).

REGLER (alle agenter): branch fra origin/main i worktree; TDD; pwsh -File scripts/verify-local.ps1 grøn FØR push (+ alle 3 playwright-projekter ved visuel ændring, refresh snapshots); commit via git commit -F (ingen heredoc); PR med ## Brugerverifikation (mindst ét [x] ELLER backend-only-label); INGEN auto-merge af database/*.sql (ejer merger migrationer); GRANT SELECT på nye player-facing kolonner i samme migration (#1162); player-facing → patch notes (konsolidér centralt, undgå version-merge-konflikt); kommentér PR-nr på issuet; markér IKKE done (ejer reviewer i morgen). Prod-scripts via infisical run --env=prod. Parallel-safety: docs/AGENT_ARCHITECTURE.md. Loop-guard: 2 CI-fails samme symptom → STOP.

TIL SIDST: completeness-rapport (PR-klar / partielt / mangler) + opdatér docs/NOW.md (Working agent = Ingen aktiv session).
```

---

## PROMPT 2 — FOREVER-RELAUNCH (destruktiv prod-reset — kør om morgenen efter natbølge-review)

```
Forever-relaunch af Cycling Zone — PERMANENT destruktiv prod-reset (frisk sæson 1, aldrig-reset igen). IRREVERSIBEL. Kør KUN når natbølge-PR'erne er reviewet+merget og du er klar. Den verificerede backup er gendannelses-nettet. Alt prod via infisical run --env=prod -- ... (secrets injiceres, dump dem ALDRIG).

FORUDSÆTNINGER (verificér, STOP hvis ikke grøn):
1. Natbølge-features merged til main (#1688 AI-fyld + #1681 + #1569 + evt #1137) + CI grøn.
2. Form-frys live: SELECT count(*) FROM league_divisions =15; teams.league_division_id + season_standings.league_division_id findes; teams-division-CHECK=1-4.
3. WS1 flags: SELECT key,value FROM app_config — auto_prize_enabled+stage_scheduler_enabled+race_engine_v2_enabled = on.
4. START_DATE=2026-06-22 i backend/scripts/relaunchSeason1.js:23. Prod-ref=ghwvkxzhsbbltzfnuhhz.

STEP-FOR-STEP:
1. FRISK VERIFICERET BACKUP (net): $env:BACKUP_DIR="C:\Users\Nicolai\OneDrive\CyclingZone-context\cz-db-backups"; infisical run --env=prod -- npm run db:backup → derefter $env:BACKUP_COUNT_TOLERANCE="15"; node scripts/db-verify-restore.mjs --dir <ny-backup-dir>. Skal sige "VERIFIED — ... 0 issue(s)". STOP ellers.
2. EGNE LØBSNAVNE: infisical run --env=prod -- node backend/scripts/seedRacePool.js scripts/race_pool_seed.csv --dry-run (preview) → uden --dry-run men MED --prune (anvender CZ-fiktive navne + fjerner gamle real-navngivne katalog-rækker). Verificér katalog.
3. DRY-RUN reset: infisical run --env=prod -- node backend/scripts/relaunchSeason1.js (uden --apply) → gennemgå plan-summary.
4. DESTRUKTIV RESET: infisical run --env=prod -- (RELAUNCH_1101_CUTOVER_ACK=true sat) node backend/scripts/relaunchSeason1.js --apply --target-prod --confirm "RELAUNCH SEASON 1". (PowerShell: $env:RELAUNCH_1101_CUTOVER_ACK="true"; infisical run --env=prod -- node backend/scripts/relaunchSeason1.js --apply --target-prod --confirm "RELAUNCH SEASON 1"). Reset-kæde: retire legacy → full beta-reset → fiktiv population → backfill → startholds → allocateLeaguePools (pulje-spredning, ægte hold i div 4) → sæson 0+transition 0→1 → board-oplåsning (pending_5yr) → akademi → kontrakter → founder-badges.
5. AI-FYLD: kør AI-fyld-generatoren (#1688) → div 1+2 AI-fyldt, div 3+4 AI i pulje-huller.
6. SCHEDULÉR FRISK SÆSON: infisical run --env=prod -- node backend/scripts/backfillRaceScheduledFor.js (dry-run) → --live (sætter scheduled_for + race_stage_schedule → stage-scheduleren afvikler fresh-løb auto).
7. VERIFICÉR FLAGS ON post-reset (sæt hvis reset slukkede dem): academy_enabled, daily_training_enabled, race_engine_v2_enabled, auto_prize_enabled, stage_scheduler_enabled = "on". Flip #1137-progression-flag KUN hvis du har reviewet+godkendt den.
8. POST-VERIFY mod prod (alle grønne): pyramide (league_divisions=15; ægte hold league_division_id ikke null + division=4; div 1+2 har AI) · 0 aktive ryttere uden rider_derived_abilities/base_value · ægte hold balance=800000 (ingen dobbelt sponsor/upkeep) · sæson-1-vindue board_negotiation_state='pending_5yr' · nyt signup → div-4-pulje + 8-rytter-trup · founder-badges · egne løbsnavne i kalenderen (ikke Czech Tour/Giro). Brug rehearsal-harnessens acceptance-checks som skabelon.
9. HVIS FEJL: restore fra backuppen — PITR via Supabase-dashboard, eller den logiske dump per docs/RUNBOOK_RESTORE_DRILL.md. Stop + fejlsøg.
10. COMMS: efter grøn verify — send relaunch-besked (in-app broadcast til alle ægte managers + Discord) med founder-prosa (din ToV). Opdatér PatchNotesPage.jsx + help.json + NOW.md + luk forever-gate §6 i docs/superpowers/specs/2026-06-19-forever-relaunch-readiness-design.md.

REFERENCE: docs/superpowers/specs/2026-06-19-forever-relaunch-readiness-design.md (§6 gate/§8 vindue) · docs/RUNBOOK_RESTORE_DRILL.md · scripts/db-README.md · backend/scripts/dev/run-relaunch-rehearsal.mjs (acceptance-checks).
```
