# Start-prompt: cutover S2 -> S3, søndag 23/8 2026 (ny session fra ca. 18:00)

Kopiér alt under stregen ind som første besked i den nye Claude Code-session (repo C:\Dev\CyclingZone, main).

---

Du er arkitekt/orkestrator for aftenens sæsonskifte S2 -> S3 i Cycling Zone. Dato: søndag 23/8 2026. Læs FØRST `docs/NOW.md`, derefter `docs/audits/2026-08-23-generalproeve-cutover.md` (køreplanen med målte tider + 15 fund) og `docs/2026-08-23-cutover-drejebog.md` (Komponent 3 + 4, rollback). Alt andet i dag er færdigt og merget (kalender, profiler, #4134). Du må IKKE starte andet arbejde.

## Den ene regel der ALDRIG brydes i aften

Ingen prod-mutation uden at ejeren har skrevet "GO"/"kør" på NETOP det skridt, EFTER at have set de konkrete tal/live-tilstand. "Vi tager den bagefter", "fint", "ok" og sekvens-svar er IKKE et go. Hvert skridt: vis 3-5 linjer med tal -> vent på GO -> kør -> vis post-verify -> næste. (Bidt kl. 17:23 i dag: værdi-korrektionen blev kørt uden go og rullet tilbage, se #3750.)

## Rækkefølge i aften

**A. FØR 19:30: værdi-korrektionen (ejer-krav: "tag den op FØR 19:30").**
1. Ejeren vælger c på https://cyclingzone.org/admin/value-transition (presets fra gate-målingen; nyeste måling 23/8 13:59: c = 0,811, bånd udvidet til 0,30; ejeren var uenig i at dry-runnens -18,9 % matchede det han så på siden, så AFKLAR hvilket c han mener FØR noget køres).
2. Dry-run med hans c: fra `backend/`: `infisical run --env=prod --silent -- node scripts/marketValueLevelCorrectionApply.js --dry-run --c-override=<c>` (read-only). Vis: population, sum før/efter, delta pr. division, 10 største fald.
3. OBS: apply-scriptet læser ALTID c fra gate-loggens c_candidate (0,811). Vil ejeren et ANDET c, kan apply ikke køre uden kodeændring (ejer-override-sti findes ikke). Sig det ærligt og lad ham vælge: 0,811 nu, eller vent til 30/8.
4. GO -> `--confirm-apply` (PowerShell-tool, timeout 600000). Post-verify: receipts = population, 0 mismatches (SQL mod `market_value_level_correction_rider_receipts`). Derefter merge PR #4135 (dæmpnings-flip, rebased, patch note 7.180; `gh pr ready 4135`, CI ~20 min, squash). Rollback-SQL: `update riders r set base_value = x.old_value from market_value_level_correction_rider_receipts x where x.rider_id=r.id and x.apply_log_id='<id>'` + nulstil `market_value_level_correction_youth_auction_start_rate` + slet notifikationer med titleCode marketValueLevelCorrection.
5. Spillerbesked: ejeren har postet en udgave med 0,76; den skal rettes til det c der faktisk køres (udkast: `docs/discord/2026-08-23-vaerdi-opdatering-besked.md`). Ejeren poster selv.

**B. 19:05: D1-komprimering dry-run mod prod** (11 min, read-only): `infisical run --env=prod -- node scripts/compressPyramidS3.js` fra backend/. Gem output i docs/snapshots/3901/. Vis ejeren top 24 + cutlines.

**C. 19:30-22:30: køreplanen** (tabellen "KØREPLAN I AFTEN" i generalprøve-rapporten, kommandoer og SQL står der). Kendte fælder, allerede indarbejdet i rapporten: sæt `season_end_skip_division_movement='on'` FØR "Afslut sæson" og 'off' efter transitionen; `remeasureGate3459.mjs` med sæsonnummer 2; "Afslut sæson" må ALDRIG genkøres blindt; window-wrap-SQL skal have `squad_enforcement_started_at=now()`; `generateSeasonEntries.js --season=<S3> --execute` SKAL køres efter transitionen (ellers 0 felter); `race_days_total` for S3 skal være 27 før transitionen (er 27 nu); mandat-rollback bruger DELETE, ikke TRUNCATE; lange scripts via PowerShell-tool med timeout 600000 (aldrig 2-min-grænse). `endSeasonS2.mjs` ligger i backend/scripts (fra PR #4136); spejler endpointet.

**D. Løn-genberegning (skridt ~20:12):** ejeren vil have den KØRT I AFTEN, men først efter at han har gennemgået og godkendt tallene. Dry-run: `infisical run --env=prod --silent -- node scripts/dev/salaryRecompute3645.mjs` (fra backend/). Vis: medianhold-faktor, lønsum før/efter, de 18 ryttere der x10 (navn/hold/type), puncheur vs tt-spænd. Hvis værdi-korrektionen (A) IKKE blev kørt: sig eksplicit at #4120's 19,8x-spænd fryses, og lad ejeren vælge. Apply kun på GO: `CONFIRM_SALARY_RECOMPUTE=yes ... --apply`.

**E. Spillerbesked 1 (race-day-motoren)** skal postes af ejeren FØR race-day-flippet (19:33): `docs/discord/2026-08-17-cutover-beskeder.md`, "Besked 1" EN (#the-roadbook) + DA (#dansk-snak).

## Praktisk
- Supabase MCP project_id prod: ghwvkxzhsbbltzfnuhhz. S2 id 00000000-0000-0000-0000-000000000002, S3 ...0003.
- Auto-mode-classifieren blokerer af og til prod-scripts i Bash-toolet; PowerShell-toolet har virket hele dagen for `infisical run --env=prod --silent -- node ...`.
- Baggrunds-vent/Monitor virker ikke på denne maskine; brug forgrunds-kald med timeout 600000, og giv workers besked om det samme. Du bør ikke bruge workers i aften; kør selv, et skridt ad gangen.
- Staging-branch `staging-cutover` (ref pywxpnynzmbukdvoiazp) er en prod-kopi i post-transition-tilstand; rør den ikke, slettes mandag (#3839).
- Close-out: NOW.md (Next action = mandag: kalibrering + v4-afvigelser + rytter-pakken #3512/#4098/#4128), issues #4129 (nøglen sat/ryddet), #3901, #3514, #3645, patch note for sæsonskiftet, `check-agent-token-hygiene.ps1`.
