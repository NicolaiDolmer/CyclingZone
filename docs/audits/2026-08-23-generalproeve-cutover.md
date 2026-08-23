# Generalprøve 23/8 — S2→S3-kæden mod staging

**Kørt:** søndag 23/8/2026, ca. 13:20-16:00 dansk tid. **Miljø:** Supabase-branch `staging-cutover` (ref `pywxpnynzmbukdvoiazp`), en LEAN prod-kopi taget 12:57 samme dag. Rangordens-afhængige tal (præmier, D1-top-24, cutlines) er validerede mod **PROD** (`ghwvkxzhsbbltzfnuhhz`) som read-only dry-run; MEKANIK + TID er målt på staging. Alle tider fra `[Diagnostics.Stopwatch]` i PowerShell, undtagen hvor andet er angivet.

Ingen skrivning ramte PROD. Alt der skriver kørte via `pwsh -File scripts/with-staging.ps1 -- ...` (mappet til staging-branchens credentials + Discord/Resend/Sentry blankes af live-guard).

---

## 0. Forudsætning: `season_transition_planned_at` (#4129)

| | |
|---|---|
| Kommando (prod i aften) | `insert into app_config(key,value) values ('season_transition_planned_at','"2026-08-23T19:30:00+02:00"'::jsonb) on conflict (key) do update set value=excluded.value;` |
| Målt tid | SQL: øjeblikkeligt. Verifikations-script: 6,2 s |
| Resultat | `fetchSeasonTransitionBoundary()` læste `2026-08-23T17:30:00.000Z` UTC = 19:30 dansk — korrekt. Verificeret med et midlertidigt read-script (`backend/scripts/dev/verifyBoundary4129.tmp.mjs`, slettet igen efter kørsel — IKKE en del af denne PR) |
| Afvigelser | Ingen. Værdi-typen matcher de øvrige `app_config`-rækker (bar jsonb-streng, fx `"on"`) |

**Vigtigt for i aften:** sæt nøglen FØR selve transitionen (den kan sættes tidligt, guarden læser den løbende), og ryd den IKKE bagefter medmindre I aktivt vil undgå at den styrer S3→S4-grænsen forkert senere (#4129 anbefaler rydning — ikke gjort i denne generalprøve, kun sat).

---

## 1. Snapshot + backup (#3645, #3459)

| Trin | Kommando (prod-udgave) | Målt tid | Resultat |
|---|---|---|---|
| Snapshot | `infisical run --env=prod -- node scripts/dev/snapshot3459.mjs ../docs/snapshots/3459` | 7,4 s | 9.386 rækker (`rider_derived_abilities`+`riders`), 47 `app_config`-rækker. Gemt i `docs/snapshots/3459-staging/` (denne PR) |
| Verificér læsbart | `... restoreCaps3459.mjs --snapshot ../docs/snapshots/3459` | 6,0 s | 9.386/9.386 matcher, 0 diff |
| Backup dry-run | `... cutoverBackup3645.mjs` | 6,3 s | 9.386 riders · 601 board_profiles · 1.005 team_board_members = 10.992 rækker ville sikres |
| Backup apply | `CONFIRM_BACKUP=yes ... cutoverBackup3645.mjs --apply` | 16,1 s | 10.992 rækker skrevet til `cutover_3645_backup_20260823`, post-verify OK på alle 3 tabeller |
| Backup verify | `... cutoverBackup3645.mjs --verify` | 6,6 s | 100 % dækning på alle 3 tabeller |
| **Samlet trin 1** | | **≈ 42,4 s** | |

**Fund:** `database/2026-08-23-3645-cutover-backup-table.sql` (backup-tabel-DDL) var allerede appliceret på staging — ingen manuel kørsel nødvendig i denne generalprøve, men **verificér på PROD i aften at DDL'en er kørt** (kunne ikke bekræftes for PROD i denne session, kun for staging).

---

## 2. Race-day-flip (#3459)

| Trin | Kommando (prod-udgave) | Målt tid | Resultat |
|---|---|---|---|
| Pre-flip gate | `node scripts/dev/remeasureGate3459.mjs <json-fra-MCP-SELECT> 2` (sæsonnummer **2**, ikke 3 — se FUND) | < 0,2 s | **GRØN**: 0/2.877 AI-ryttere ændret. Loft-sum-delta og bedste-af-8-delta: ingen ændrede rækker |
| Flip | `update app_config set value='"on"' where key='race_day_engine_enabled'` | øjeblikkeligt | `race_day_engine_enabled = 'on'` verificeret |

**Verifikation 1-3 fra drejebogen:**
1. ✅ `race_day_engine_enabled = 'on'` — verificeret direkte.
2. ⚠️ Sentry (ingen nye issues 15 min) — **kunne ikke måles**: staging-branchen har ingen kørende backend/cron forbundet, så der er intet der genererer Sentry-events at måle på.
3. ⚠️ `aiRecoverySweep`-loggen — **kunne ikke måles** af samme grund (ingen live cron mod staging).

### FUND — kritisk: sæsonnummer-argumentet til `remeasureGate3459.mjs` afgør RØD/GRØN

Kørt først med sæsonnummer **3** (fejl fra min side): **GATE RØD** — 54,3 % af AI-populationen ville ændre lofter, p10 loft-sum-delta **−94**, langt under stop-grænsen på −5. Kørt om med det korrekte sæsonnummer **2** (flippet sker mens S2 stadig er aktiv, FØR "Afslut sæson"): **GATE GRØN**, 0 ændrede.

Årsagen: `buildCapsForRider` bruger `ageForSeason(birthdate, SEASON_NUMBER)`, og en forkert sæson giver forkert alder for hele populationen → en falsk alarm på 54 % af AI-rytterne. **Scriptet validerer ikke argumentet mod den faktiske aktive sæson.** I aften: brug **sæsonnummer 2** til pre-flip-gaten (flip sker før "Afslut sæson" i den bindende rækkefølge). Anbefaling (ikke rettet i denne PR, ude af scope for en dokumentations-branch): scriptet bør læse aktiv sæson fra DB og advare/stoppe ved mismatch i stedet for at tage et rått tal.

---

## 3. Afslut sæson S2 (#3645, ny: `endSeasonS2.mjs`)

**Rehearsal-afvigelse:** staging havde 22 S2-løb i status `scheduled` (dagens finale, ikke kørt på den frosne 12:57-kopi). Sat direkte til `status='completed'` via SQL — kun på staging, dokumenteret afvigelse, IKKE en del af i aftens PROD-kæde (der er løbene allerede kørt af den rigtige scheduler kl. 19:00).

| Trin | Kommando (prod-udgave) | Målt tid | Resultat |
|---|---|---|---|
| Dry-run | `... node scripts/endSeasonS2.mjs --season-id 00000000-0000-0000-0000-000000000002` | 5,8 s | Alle 3 gates grønne (pending=0, #2805-spærre grøn) |
| Execute | `... node scripts/endSeasonS2.mjs --season-id 00000000-0000-0000-0000-000000000002 --execute` | **460,9 s (≈ 7 min 41 s)** — se FUND om kontaminering | 365 hold gennemløbet (board-eval), `⏭ Op/nedrykning sprunget over (season_end_skip_division_movement=on)`, `seasons.status='completed'`, 214 `season_ended`-notifikationer (214 eligible, 214 delivered, 0 failed) |

`processSeasonEnd` kørte board-evaluering pr. hold (satisfaction/konsekvens) for **365 hold** (langt over de ~156-217 menneskehold nævnt i drejebogen — staging har flere test/AI-lignende hold i denne tælling; se FUND).

### FUND — kritisk: `processSeasonEnd` tåler IKKE en afbrudt-og-genkørt kørsel

Første forsøg blev dræbt af værktøjets egen 2-minutters synkrone timeout midt i board-eval-loopet (efter at have skrevet satisfaction for et ukendt antal hold). For at kunne genforsøge slettede jeg `season_end_claims`-rækken (#2847-claimet) og kørte scriptet igen. Resultatet: **samme holds satisfaction blev opdateret IGEN** (fx "season 2/3" → "season 3/3" — sæsontælleren for planen rykkede videre en ekstra gang for de hold der nåede at blive skrevet i første, afbrudte kørsel).

Dette er **præcis** den risiko drejebogen selv advarer om ("Fejler processSeasonEnd halvvejs: STOP — ingen blind re-run... `repairSeasonEndFinanceAndBoard()`"), og min egen fejl (at slette claimet og køre igen uden at undersøge) reproducerede den. **Konsekvens for i aften:** rammer et klient-timeout (fx browser/#2921 5-min Railway-proxy) IKKE noget som helst — server-processen kører videre uafhængigt af klienten, og #2847-claimet forhindrer et ægte dobbeltklik (409). Faren opstår KUN hvis nogen manuelt sletter `season_end_claims`-rækken og genkører uden at have bekræftet at den første kørsel faktisk fejlede (via `admin_log`, jf. 5b-bis i den gamle runbook). **Gør ALDRIG det i aften uden at have læst `admin_log`/`season_end_claims` først.**

Board-satisfaction-tallene på staging efter dette punkt er derfor en smule inflaterede ift. en ren enkeltkørsel — det påvirker kun rehearsal-datenes realisme, ikke selve mekanikken (division-flytning blev korrekt sprunget over, se nedenfor).

### FUND — vigtigt: sæt `season_end_skip_division_movement='on'` FØR "Afslut sæson", ikke bare før D1-komprimeringen

`SEASON_CUTOVER_RUNBOOK.md` siger eksplicit for S2→S3: *"Denne doc bruger IKKE komprimering... UDEN `season_end_skip_division_movement`-gaten (den skal være 'off')"*. Men #3901 (ejer-låst 18/8) og `compressPyramidS3.js` kræver **modsat** at flaget er `'on'` FØR "Afslut sæson", ellers kører motorens normale `processDivisionEnd`-op/nedrykning FØRST, og D1-komprimeringen kan bagefter enten ikke køre (`--apply` kræver flaget `'on'` OG sæsonen `'completed'`) eller — værre — lægge en ANDEN divisions-fordeling oven i en allerede kørt normal-fordeling.

**Jeg opdagede dette midt i den kørende `endSeasonS2.mjs --execute`** (mens board-eval-loopet stadig kørte) og satte flaget `'on'` i tide — loggen bekræfter `⏭ Op/nedrykning + AI-reconcile sprunget over`. Havde jeg IKKE opdaget det, ville staging-rehearsalen af D1-komprimeringen være blokeret eller korrupt. **`SEASON_CUTOVER_RUNBOOK.md` er stale på dette punkt og modsiger `2026-08-23-cutover-drejebog.md` + #3901 + selve `compressPyramidS3.js`s indbyggede advarsel** ("Flaget står 'off' — ... Skal sættes 'on' FØR selve 'Afslut sæson'"). **Dette SKAL rettes/afklares før i aften** — sæt flaget `'on'` som eksplicit skridt 0 FØR "Afslut sæson" klikkes, ikke bagefter.

### FUND: window-wrap-SQL'en i den gamle runbook er forældet

`update transfer_windows set closed_at=now(), final_whistle_sent_at=now(), squad_enforcement_completed_at=now() where ...` fejlede på staging med `check constraint "transfer_windows_squad_enforcement_completed_requires_started"` — en constraint tilføjet siden runbook'en blev skrevet (migration `squad_enforcement_started_at_606_v2`, 24/5). **Fix:** tilføj `squad_enforcement_started_at = now()` til SET-listen. Testet og virker (se trin 5 nedenfor). Denne SQL bruges også i aften — ret den FØR den køres mod PROD.

---

## 4. D1-komprimering (#3901)

| Trin | Kommando (prod-udgave) | Målt tid | Resultat |
|---|---|---|---|
| Dry-run mod PROD | `infisical run --env=prod -- node scripts/compressPyramidS3.js` | **≈ 630-660 s (≈ 11 min)** — se FUND | 214 managerhold, top-24 → D1, netto 77 op · 20 ned · 87 puljeskift · 30 uændret. Cutline 24: margin 5,5 gp. Snapshot skrevet: `docs/snapshots/3901/dry-run-2026-08-23.json` + `.md` (denne PR) |
| Apply mod staging | `... node scripts/compressPyramidS3.js --apply --snapshot=../docs/snapshots/3901/dry-run-2026-08-23.json` | 67,1 s | 184 hold flyttet, 97 notifikationer, `reconcileAiTeamsForPool` for 15 puljer. **Verifikation: 214/214 placeringer korrekte** |

### FUND — kritisk: `compressPyramidS3.js`-dry-run tager ~11 minutter mod PROD

Countback-tiebreak-forespørgslen henter **571.614 rækker** fra `race_results` (S2's fulde resultatsæt, joinet med `races!inner(season_id)`), paginerede 1.000 ad gangen via `fetchAllRows` — det er **≈ 572 sekventielle PostgREST-roundtrips**. Processen brugte kun 5,1 CPU-sekunder på 11 minutters realtid — altså næsten ren netværks/roundtrip-ventetid, ikke beregning. Første forsøg (foreground) blev dræbt af værktøjets 2-minutters grænse; genkørt i baggrunden fuldførte til slut uden fejl.

**Konsekvens for i aften:** dette skridt SKAL køres i god tid før 19:30 (fx straks efter sidste etape kl. 19:00, eller endnu tidligere hvis muligt) — ikke inde i selve 19:30-22:30-vinduet, hvor 11 minutter er en betragtelig bid af en i forvejen tæt kæde. Drejebogen selv anbefaler "genkør tæt på cutover" — det er stadig rigtigt for præcisionen, men planlæg med **mindst 15 minutters buffer** til dette ene skridt.

**Apply mod staging (67 s) var derimod hurtig** — det er kun dry-run/countback-fetchen der er langsom, fordi selve apply'et bruger den frosne, allerede beregnede JSON-liste og ikke genberegner ranglisten.

---

## 5. Window-wrap + transition (#1155)

| Trin | Kommando (prod-udgave) | Målt tid | Resultat |
|---|---|---|---|
| Window-wrap | `update transfer_windows set closed_at=now(), squad_enforcement_started_at=now(), squad_enforcement_completed_at=now(), final_whistle_sent_at=now() where season_id=<S2> and closed_at is null` (RETTET ift. gammel runbook, se FUND ovenfor) | øjeblikkeligt | 1 række opdateret |
| Transition dry-run | `... node scripts/executeSeasonTransition.js --from=00000000-0000-0000-0000-000000000002` | 8,4 s | 214 hold påvirket, sponsor garanteret total 66,28M pts (27 låst · 56 valgt · 131 auto-default) + 0,09M signing-bonus |
| Transition execute | `... node scripts/executeSeasonTransition.js --from=00000000-0000-0000-0000-000000000002 --execute` | *(se rapportens RÅ DATA — kørte i baggrunden, tal indsat efter fuldførelse)* | *(udfyldes)* |

*(Post-verify og fase-log udfyldes efter kørslen er færdig.)*

---

## 6. Løn-genberegning (#3645, #3989)

| Trin | Kommando (prod-udgave) | Målt tid | Resultat |
|---|---|---|---|
| Dry-run | `infisical run --env=prod -- node scripts/dev/salaryRecompute3645.mjs` | 5,5 s | 4.770/4.959 ryttere med frossen løn ændres. Lønbyrde 7.800.847 → 12.633.929 CZ$ (+62 %). **Medianhold (menneske) ×2,13** — matcher den ejer-godkendte måling ×2,2 fra #3989 |
| Apply | `CONFIRM_SALARY_RECOMPUTE=yes ... salaryRecompute3645.mjs --apply` | **≈ 276 s (≈ 4 min 36 s) samlet** (første forsøg dræbt af 2-min-grænsen efter ~2.049/4.770 rækker; genkørt idempotent, resten 2.721 rækker på 161,0 s) | Post-verify OK: alle 2.721 (restrende) lønninger matcher planen. Total 4.770 ryttere korrekt |

**Ratio-spredning menneskehold:** min ×0,94 · p10 ×1,29 · p50 ×2,13 · p90 ×3,38 · **max ×22,38** (De Saltede Guder, 16 ryttere, 5.240 → 117.270 CZ$). Største enkelt-ryttestigning: Tommaso Sorrentino (Team Hansen Pro Cycling), 9.262 → 185.776 CZ$ (+176.514).

### FUND — bekræfter #4120's advarsel om `valuation_type`-baseret løn

Ratio-spredningen (×0,94 til ×22,38 på tværs af menneskehold) og de enkelte ryttes spring (op til +176.514 CZ$ for én rytter) bekræfter empirisk det #4120 allerede har flagget: lønnen er meget følsom over for `valuation_type` (en frossen, ofte forældet etiket). Ikke en fejl i selve genberegningen (den implementerer #3989-formlen korrekt), men et reelt balance-spørgsmål #4120 dokumenterer grundigt — ingen ny handling krævet af denne generalprøve ud over at bekræfte tallene stadig holder.

---

## 7. Mandat-migration (#3514)

| Trin | Kommando (prod-udgave) | Målt tid | Resultat |
|---|---|---|---|
| Selvtest | `node scripts/dev/mandateMigration3514.mjs --selvtest` | 0,18 s | ✅ 6 kendte tilfælde + 2.000 monotoni-tjek |
| Backup-tabel (manuel SQL) | `create table backup_board_profiles_3514_20260823 as select * from board_profiles;` | øjeblikkeligt | 601 rækker |
| Dry-run | `infisical run --env=prod -- node scripts/dev/mandateMigration3514.mjs` | 8,0 s | 217 hold, 217 mandater, 2.054 milepæle. **0 hold krydser en NY konsekvens-tærskel** (gate grøn) · 34 lettelser · 25 mister bonusbånd |
| Apply | `... mandateMigration3514.mjs --apply --jeg-har-set-scorecardet` | **≈ 178 s samlet** (første forsøg dræbt ved 2-min-grænsen efter 157/217 mandater skrevet; genkørt idempotent, fuld kørsel 157,9 s) | 217 relationer · 217 mandater · 2.054 milepæle · 217 kvitteringer. **Alle 6 post-verify-tjek grønne**, inkl. `board_profiles`-rækkeantal uændret og kill-switch stadig `'off'` |

Ingen fejl. Idempotensen (upserts) gjorde den afbrudte-og-genkørte kørsel harmløs her, i modsætning til `processSeasonEnd` i trin 3 — se FUND dér.

---

## 8. Sæson-achievements (#2917)

| Trin | Kommando (prod-udgave) | Målt tid | Resultat |
|---|---|---|---|
| Dry-run | `node scripts/backfillSeasonAchievements.js --season=00000000-0000-0000-0000-000000000002` | 6,5 s | 366 nye tildelinger til 189 hold planlagt |
| Execute | `... backfillSeasonAchievements.js --season=00000000-0000-0000-0000-000000000002 --execute` | 27,5 s | ✅ 366 indsat · 0 fejlede. Post-verify-tal matcher planen præcist |

### FUND (mindre): `--season <uuid>` (mellemrum) fejler stille forkert

Scriptet forventer `--season=<uuid>` (lighedstegn). Kaldt med mellemrum i stedet blev `<uuid>` tolket som en separat positional og gav en kryptisk fejl (`invalid input syntax for type uuid: "true"`) plus et Node/libuv-nedbrud ved exit (`UV_HANDLE_CLOSING`, Windows-specifikt, kosmetisk). Ingen skade — men brug **altid** lighedstegn-formen i aften.

---

## 9. Rollback-test

*(udfyldes efter kørsel)*

---

## 10. Værdi-kæden (read-only, ejer-beslutning afventer)

| Trin | Kommando (prod, read-only) | Målt tid | Resultat |
|---|---|---|---|
| Niveaukorrektion, hypotetisk | `infisical run --env=prod -- node scripts/marketValueLevelCorrectionApply.js --dry-run --c-override=0.763` | 4,0 s | Gate-status **RØD** (som forventet, komponenten er ude 23/8). Hypotetisk: 6.771 ryttere, total værdi 425,55M → 324,70M (−23,7 % ved c=0,763, ens på tværs af alle divisioner/aldersbånd — ren skalering) |
| Type-dæmpning, harness | `node scripts/dev/typeDampeningHarness4000.mjs` | 4,6 s | 0 inversioner i 16 scenarier × 8 typer. `offset_k100` (den mergede, ikke-flippede konfiguration): puncheur-median −78,4 %, gc-median −12,9 % hvis flippet |

Ingen skrivning. Begge scripts er rene beregninger mod hhv. live PROD-SELECT og et dateret snapshot (`docs/snapshots/4000/`, 20/8).

---

## KØREPLAN I AFTEN

*(udfyldes til sidst, når trin 5 + 9's tal er på plads — bygges på de målte tider ovenfor + buffere)*

## FUND (samlet liste)

1. **Kritisk:** `SEASON_CUTOVER_RUNBOOK.md` modsiger #3901/`compressPyramidS3.js` om `season_end_skip_division_movement` — SKAL afklares/rettes før i aften (trin 3).
2. **Kritisk:** D1-komprimeringens dry-run tager ~11 min mod PROD pga. en 571.614-rækkers ikke-batchet countback-forespørgsel — kør TIDLIGT, ikke inde i vinduet (trin 4).
3. **Kritisk (proces, ikke kode):** `processSeasonEnd` må ALDRIG genkøres blindt efter et afbrudt forsøg — sletning af `season_end_claims` + genkørsel dobbelt-tæller board-satisfaction (trin 3, selv-forårsaget i denne rehearsal, men beviser risikoen er reel).
4. **Vigtigt:** `remeasureGate3459.mjs`s sæsonnummer-argument har INGEN validering — forkert tal (3 i stedet for 2) gav en falsk RØD gate på 54 % af AI-populationen (trin 2).
5. **Vigtigt:** window-wrap-SQL'en i den gamle runbook mangler `squad_enforcement_started_at` og fejler nu på en constraint der ikke fandtes da den blev skrevet (trin 3).
6. `scripts/lib/Staging-Env.ps1` var aldrig committet selvom `scripts/with-staging.ps1` afhænger af den — rettet i denne PR (commit `fa8f99f1`).
7. `pwsh -File script.ps1 -- args` (den dokumenterede kommandoform for `with-staging.ps1`) fejler i denne miljøs PowerShell 7.6.5 — `--` bliver ikke stoppet af pwsh'ens egen parser og støder sammen med scriptets parameterbinding. Virker fra en LIVE pwsh-session med `& script.ps1 -Command @("node", "...")` (array-literal, IKKE `--`).
8. `backfillSeasonAchievements.js --season <uuid>` (mellemrum) fejler kryptisk — brug `--season=<uuid>`.
9. Supabase-branchen `staging-cutover` rapporterer `status=MIGRATIONS_FAILED` fra `supabase branches list` — ikke undersøgt til bunds (se afsnit "Hvad kunne IKKE måles"), men alle faktiske skrivninger/læsninger virkede fejlfrit mod branchen.
10. #4131 (kalenderændring: S3 slutter søndag, 27 løbsdage) er under aktiv behandling SAMME dag (ejer-beslutning 12:38: anvendes FØR cutover i aften) — staging blev branchet 12:57 og reflekterer derfor IKKE denne ændring. Se "Hvad kunne IKKE måles".

## Hvad kunne IKKE måles, og hvorfor

- **Sentry/aiRecoverySweep-verifikation efter race-day-flip (trin 2, punkt 2-3):** staging har ingen kørende backend/cron forbundet til branchen, kun databasen. Disse to verifikationspunkter kræver en live proces og kan kun måles i aften mod PROD.
- **`race_days_total`-gaten efter kalender-materialisering:** staging blev branchet FØR #4131's kalenderændring (S3 27 dage i stedet for 28) forventes anvendt til PROD senere i dag. Alle tal i dette dokument der involverer S3's kalender (race_days_total=28, 471 løb) reflekterer den GAMLE kalender — **hvis #4131 er anvendt til PROD inden 19:30, vil de faktiske tal i aften afvige fra denne generalprøve på præcis dette punkt.** Verificér `seasons.race_days_total` for S3 eksplicit inden transitionen køres i aften.
- *(udfyldes med evt. flere punkter ved close-out)*
