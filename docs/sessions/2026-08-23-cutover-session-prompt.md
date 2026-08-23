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

---

## Tilføjet 17:58 af designsessionen (kontraktudløb + løn-rækkefølge)

Fire punkter der ikke stod i prompten ovenfor. Alle tal er målt mod prod i dag.

**F1. Kontraktudløb kører i aften. Det er ejer-besluttet i dag. Lad det køre.**
Fase 5c (`contractExpiryRelease.js`) frigiver ryttere med `contract_end_season <= 2`. Prod lige nu: **834** seniorryttere på menneskehold. AI-holdenes 366 auto-fornyes i fase 5b-2 og frigives derfor ikke. Generalprøven målte præcis 834 `contract_expired_release`-notifikationer, så forvent samme størrelsesorden. **Bliv ikke alarmeret, og forsøg ikke at rette mekanikken midt i cutoveret.**
- **58 af 214** menneskehold falder under 8 ryttere. Fase 6f (`squad_below_minimum_check`) sender KUN en notifikation. Ingen healer fylder dem op: `runStarterSquadHealSweep` er markør-gated på `starter_squad_allocated_at IS NULL` og rammer dem ikke. Kendt og accepteret.
- Under 8 ryttere blokerer **ikke** løb. `MIN_RIDERS_FOR_RACE` importeres ikke i en eneste race-fil; holdet stiller op med færre (`raceAutopick.js:89` bruger kun `rule.max`). Konsekvensen er sportslig, ikke teknisk.
- Den varige løsning er specet i `docs/superpowers/specs/2026-08-23-kontraktudloeb-tvangsauktion-design.md` (15 ejer-beslutninger), med #4145 og #4146 udskudt. Skal i produktion før S3 slutter 20/9. **Ikke i aften.**

**F2. Post-transition-tjek: residualen.**
Generalprøven efterlod 12 ryttere med `contract_end_season <= 2 AND team_id IS NOT NULL AND NOT is_academy` og undersøgte det ikke til bunds. Kør samme SQL mod prod efter transitionen og notér tallet i close-out. Er det markant større end 12, så undersøg: `releaseExpiredContractRiders` udskyder bevidst ryttere der er midt i et aktivt etapeløb (`deferredByRacing`), og de fanges først ved næste transition.

**F3. Rækkefølge-spørgsmål til ejeren FØR skridt 20:12 (løn-genberegning).**
Transitionen (19:47-20:01) kører fase 6 `season_payroll`, som trækker **hele S3's lønsum upfront** ud fra `riders.salary` som de står på det tidspunkt. Løn-genberegningen kl. 20:12 skriver nye værdier til `riders.salary` (`salaryRecompute3645.mjs:227`).
Konsekvens: **S3 bliver betalt med de gamle lønninger, og de nye slår først igennem ved S4-skiftet.**
Spørg ejeren om det er tilsigtet, eller om genberegningen skal ligge FØR transitionen. Dette er en observation af rækkefølgen, ikke en afgjort sag — træf ikke valget selv.

**F4. Flip IKKE `wage_deduction_mode` i aften.**
Prod står på `season_upfront` (verificeret i `app_config`). Ejeren besluttede i dag at flippe til `daily` ved S3→S4, ikke nu. `wageDeductionConfig.js`' header advarer eksplicit: et flip midt i en sæson, hvor sæsonlønnen allerede er trukket upfront, dobbelttrækker holdene resten af sæsonen.

---

## RETTET RÆKKEFØLGE (ejer-beslutning 23/8 ca. 18:55) — overstyrer køreplanens placering

Køreplanen i generalprøve-rapporten lægger løn-genberegningen kl. 20:12, altså EFTER "Udfør sæsonskifte". **Det er forkert og må ikke køres sådan.**

Fase 6 i transitionen (`season_payroll`) trækker **hele S3's lønsum upfront** ud fra `riders.salary` som de står i det øjeblik (`wage_deduction_mode = season_upfront`). Kører rettelsen bagefter, betaler spillerne hele S3 på de gamle, forkerte lønninger, og de nye slår først igennem ved S4.

**Den rækkefølge der skal køres:**

1. Sidste S2-løb kl. 19:00
2. **Afslut sæson (S2)** — bestyrelsen skal dømme på de værdier spillerne har set hele sæsonen. Kør IKKE værdi-korrektionen før dette skridt: `boardConsequences.js:321` bruger `market_value` til stjerne-beskyttelsen ved tvangssalg, og `market_value = COALESCE(base_value, 1000)`, så en korrektion før dommen sender ryttere under beskyttelsesgrænsen på tal spillerne aldrig har set
3. D1-komprimering apply (stillingsbaseret, upåvirket af værdier)
4. **Niveau-korrektion c** → **type-dæmpning #4000** → **løn-genberegning**. Bindende rækkefølge jf. `riderValuationTypeDampening.js`' header. Se BLOKKEREN nedenfor før skridt 3 i kæden
5. **Udfør sæsonskifte** — fase 6 trækker nu S3's løn på de rettede tal
6. Generér entries til S3, mandat-migration, sæson-achievements

### BLOKKER der skal afklares FØR løn-genberegningen køres

Læst i koden, ikke kørt. Verificér med dry-run før nogen handler:

- `salaryRecompute3645.mjs:82` regner løn af `rider.current_production_value`, **læst fra databasen** (select-liste linje 109). Scriptet kalder ikke `applyTypeDampening` og genberegner ingenting.
- `current_production_value` er en LAGRET kolonne, beregnet i `backfillCores.js` gennem værdimodellen efter `applyTypeDampening()` (`backfillCores.js:226` og `:439`).
- Værdi-korrektionen skriver KUN `base_value` (`marketValueLevelCorrectionApply.js:234`).
- Der findes intet genberegnings-skridt for `current_production_value` i køreplanen, drejebogen eller denne prompt.

**Hvis det holder:** at flippe type-dæmpningen ændrer læse-tid-beregningen, men ikke den lagrede `current_production_value`. Løn-genberegningen ville så læse det UDÆMPEDE grundlag og fryse kontrakterne på præcis den 19,8x rangorden som #4120 siger ikke må blive bindende. Kæden ville se rigtig ud og give det forkerte resultat.

**Fælde i den oplagte løsning:** `backfillCores`' genberegningssti skriver også `base_value` (`:464`). Kører den efter c, kan den overskrive korrektionen. Rækkefølgen mellem c og en CPV-genberegning skal afklares med ejeren, ikke gættes.

**Konkret at gøre:** dry-run løn-genberegningen FØR og EFTER dæmpnings-flippet og sammenlign medianerne pr. `valuation_type`. Er de identiske, er hullet bekræftet, og kæden må ikke køres videre uden en CPV-genberegning. Vis ejeren tallene og få et GO på hvordan.

### Alder + progression: to fakta blokkeren skal ses i lyset af

- **Alder er udledt, ikke lagret.** `ageForSeason(birthdate, seasonNumber) = 2026 + (N-1) - fødselsår` (`riderSeasonAge.js:41`). Alle ryttere bliver et år ældre i det øjeblik transitionen gør S3 aktiv — ingen kolonne opdateres. Pension måles på den AFSLUTTEDE sæsons alder (S2).
- **Progressionen skriver `current_production_value` om.** `riderProgressionEngine.js:226` opdaterer CPV for hver aktiv rytter hver sæson, og fasen kører INDE i transitionen, EFTER `season_payroll`.

Konsekvens for kæden: CPV bliver skrevet om under transitionen uanset hvad der sker før. Køres løn-genberegningen før transitionen, fryses lønnen på CPV fra før progressionen og på S2-alder. Det er konsistent med at løn er frossen ved underskrift og ikke følger alder — men bekræft det med dry-run-tal, antag det ikke.

Det rejser også spørgsmålet om progressionens egen CPV-beregning går gennem `applyTypeDampening()`. Gør den det, opdaterer transitionen selv CPV med dæmpningen — og så ser hullet ovenfor anderledes ud. **Afklar dette FØR kæden køres.** Det er ét grep + ét dry-run, ikke en antagelse der må bæres videre.
