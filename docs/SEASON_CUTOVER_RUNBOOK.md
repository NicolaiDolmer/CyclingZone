# Sæsonskifte-runbook (S2 → S3, 23/8/2026)

> **Forhold til `SEASON_TRANSITION_CHECKLIST.md`:** den doc er S1→S2-specifik (26.–27/7)
> og dokumenterer et ENGANGS-flow — pyramide-komprimering (#2851) i stedet for normal
> op/nedrykning, fordi ejeren besluttede at global rank skulle fylde D2/D3 fra bunden.
> Denne doc bruger IKKE komprimering. **Motorens normale per-pulje op/nedrykning kører**
> (`season_end_skip_division_movement` skal være `'off'`, verificeret 4/8 — se preflight).
> Transition-motoren (`backend/lib/seasonTransition.js`, faserne i skridt 5) og
> readiness-gaten (`backend/lib/seasonTransitionReadiness.js`) er UÆNDREDE — genbrug
> `SEASON_TRANSITION_CHECKLIST.md`s skridt 0/1/1b/4/5/7 som mekanisk facit for
> "hvordan man klikker 'Afslut sæson' / 'Udfør sæsonskifte'". Denne doc dækker kun
> **hvad der er ANDERLEDES ved S2→S3**, i køre-rækkefølge.
>
> **Entry point:** `pwsh -File scripts/preflight-season-cutover.ps1` — kør den FØRST,
> altid. Den kører kæden af unit-tests + kode-tilstedeværelses-tjek og udskriver de
> præcise SELECT-blokke der skal køres via Supabase MCP (`execute_sql`) før hvert
> skridt nedenfor. Se scriptets egen header for hvad den kan og ikke kan verificere.

---

## Hvad er anderledes end S1→S2 (læs dette først)

Verificeret i kode + live prod-SELECTs 3.–4/8/2026 (se `.claude/audits/` for
den fulde session-log). Tal ændrer sig frem mod 23/8 — genkør preflight-scriptets
SQL-blokke tæt på cutover-dagen, ikke ugen før.

1. **S3-kalenderen findes IKKE endnu.** `select count(*) from races where season_id='...003'`
   gav **0** rækker (4/8). Modsat S2, hvis kalender lå klar (materialiseret ved
   world-launch, ikke af en transition). `auto_calendar_enabled` mangler i
   `app_config` (fail-safe OFF). Transitionen HAR en `season_calendar`-fase
   (`materializeTierCalendars`, idempotent, kun live puljer) — men den kører kun
   hvis flaget er ON, og er aldrig kørt i en LIVE cutover før. **Ejer-beslutning
   nødvendig før 23/8:** (A) sæt `auto_calendar_enabled='on'` så transitionen
   selv bygger S3-kalenderen som fase 17 (kræver en dry-run/test af den vej
   først — den er utestet i produktion), eller (B) byg kalenderen manuelt FØR
   cutover med et separat script (intet dedikeret "byg ny sæson"-CLI blev
   fundet — kun reparations-scripts `repair2251Tier4GrandTours.js` /
   `repair2276Div4Cascade.js`, som begge kalder `materializeTierCalendars`
   direkte og kan bruges som skabelon). **Uden en af de to sker intet mandag
   morgen** — ingen løb, ingen entries, samme fejltilstand som cron-loop-
   incidentens "tomt mellemrum", men varigt i stedet for minutter.

2. **Normal op/nedrykning kører — for FØRSTE gang nogensinde.** D1 har kun
   været AI (`teams.division=1` → 0 ægte, 24 AI, målt 4/8). D2 var **48/48
   ægte** (0 AI) — top-2-pr.-pulje rykker altså for første gang RIGTIGE
   managere op i D1. Det udløser **[#3114](https://github.com/NicolaiDolmer/CyclingZone/issues/3114)**
   (åbent 4/8): Monuments har `game_day=100000`-sentinel, og
   rytter-samme-dags-bindingen kan ikke se dem som konflikt — beskrevet i
   issuet som "latent, åbner ved D1-oprykning". Det ER netop denne cutover.
   Verificér issuets status i preflight-scriptets output; er det stadig åbent,
   eskalér til ejeren FØR cutover, ikke bagefter.

3. **D3→D4-nedrykning: data-gaten er fuldt åben.** Alle 4 D3-puljer var
   **24/24 ægte** (0 AI) målt 4/8 — `processDivisionEnd`s `poolAllReal`-gate
   (`backend/lib/economyEngine.js`, LÆSES kun af denne PR, røres ikke) er
   derfor sand i alle fire, og bund-4-pr.-pulje relegerer for ægte til D4.
   **[#2164](https://github.com/NicolaiDolmer/CyclingZone/issues/2164)**
   (den eksplicitte D3→D4-regel + testdækning) er stadig åbent. Risikoen er
   lavere end issuets rå tekst antyder: destinations-D4-puljerne
   (`league_division_id` 8–15) havde allerede 3–6 ægte managere hver OG en
   fuld 24-løbs S2-kalender (verificeret 4/8) — ingen ny pulje aktiveres, kun
   flere managere ind i eksisterende, kalender-klare puljer. Verificér alligevel
   tælle-forventningen mod preflight-scriptets pulje-SQL FØR cutover.

4. **Form-nulstilling (#3232) er live med en ikke-idempotent mode.**
   `app_config.season_form_reset_mode='decay'` (target 50, faktor 0,25) —
   IKKE `'off'`, IKKE den trivielt-sikre `'baseline'`. `decay` decayer formen
   forskelligt hver gang den kører (`backend/lib/seasonFormReset.js`s egen
   modulkommentar), og der findes **INGEN claim-guard-tabel** endnu (samme
   mønster som `academy_season_intake_runs`, #2911, blev foreslået men aldrig
   bygget — se `docs/audits/2026-08-03-form-reset-sim-3232.md`, "Åbent
   spørgsmål"). Konsekvens: kører transitionen mere end én gang (fx efter en
   fejlet fase, "for en sikkerheds skyld") decayer formen EN GANG TIL, uden
   varsel. **Allerede tracked:**
   [#3266](https://github.com/NicolaiDolmer/CyclingZone/issues/3266) ("Claim-guard
   mod dobbelt decay-kørsel i seasonFormReset FØR 23/8") — åbent 4/8. Verificér
   dets status i preflight-scriptets output FØR cutover; er det stadig åbent,
   vælg mellem (a) få det bygget/merget, (b) skift mode til
   `'off'`/`'baseline'` for denne cutover, eller (c) et eksplicit, dokumenteret
   ejer-accept af "transitionen køres kun ÉN gang for S2→S3" som driftsregel
   — vælg (c) kun hvis (a)/(b) ikke når det til 23/8.

5. **Løn-mode: `season_upfront` er stadig default (sikkert), men #2840 er
   uafklaret.** `wage_deduction_mode='season_upfront'` målt 4/8.
   [#2840](https://github.com/NicolaiDolmer/CyclingZone/issues/2840) (dagsbaseret
   løn) er stadig åbent — ejeren valgte 26/7 "vent til første payroll er
   observeret" (den observation skete 27/7). Koden markerer eksplicit at
   `'daily'` "aktiveres tidligst ved S3-skiftet 23/8" — hvis det ER planen:
   kør en dry-run (`salaryDecouplingScorecard.js` er en BESLÆGTET men separat
   mekanik — bekræft med ejeren om det er den rigtige forberedelse for
   `wage_deduction_mode`, eller om #2840 kræver sit eget script) og få
   eksplicit go, og skift KUN præcis ved sæsongrænsen (aldrig midt i en
   sæson — `wageDeductionConfig.js`s egen advarsel om dobbelttræk).

6. **Honours-migrationen (#2863) er allerede anvendt.** `get_season_honours`
   findes i prod (verificeret 4/8) — ingen ny migration at køre for S3. Kør
   blot `backfillSeasonAchievements.js` (uden `--skip=team_survived` denne
   gang — kriteriet er eksakt igen fra S2→S3, jf. scriptets egen header)
   EFTER op/nedrykning har landet, som ved S1→S2.

7. **Pension måles stadig på den AFSLUTTEDE sæsons alder** — uændret regel,
   men nu på S2: `retirementDecision(age - 1, ...)` i `riderProgression.js`
   giver `ageForSeason(fødselsdato, 2)` = referenceår **2027**. Kandidat-optælling
   (36–39-vindue / 40+ garanteret) målt 4/8: **90 / 3** på ægte hold — genmål
   tæt på 23/8 (spillerne handler videre).

---

## Rækkefølge 23/8 (deltaer over `SEASON_TRANSITION_CHECKLIST.md`s struktur)

1. **Preflight (dage før):** `pwsh -File scripts/preflight-season-cutover.ps1`.
   Ret alle `[NO-GO]`. Løs punkt 1 (S3-kalender) og punkt 4 (decay-claim-guard)
   ovenfor — de er de eneste to der reelt blokerer, resten er
   verificér-og-acceptér.
2. **Skridt 0/1/1b fra `SEASON_TRANSITION_CHECKLIST.md`** (backup, varsel,
   #2805-spærren, sidste etape + finalisering, matview-afstemning) — uændrede
   mekanismer, genbrug dem direkte. Ingen komprimerings-skridt (2/3b i den
   gamle doc) — spring dem over.
3. **"Afslut sæson"** — **UDEN** `season_end_skip_division_movement`-gaten
   (den skal være `'off'`, IKKE sættes til `'on'` som ved S1→S2). Normal
   `processDivisionEnd` kører for hver tier.
4. **Window-wrap** (skridt 4 i den gamle doc) — samme mekanik.
5. **Transitionen** ("Udfør sæsonskifte") — samme faseliste som
   `SEASON_TRANSITION_CHECKLIST.md` skridt 5a, MED to tilføjelser afhængigt af
   punkt 1 og 4 ovenfor:
   - Er `auto_calendar_enabled` sat til `'on'` (valg A): forvent faserne
     `season_calendar` + `season_entry_generator` i loggen — de erstatter den
     manuelle skridt 6 (`generateSeasonEntries.js`) i den gamle doc.
   - Er formmode stadig `decay` uden claim-guard: verificér i `admin_log` at
     dette er den ENESTE `season_transition`-kørsel for S2→S3 (samme
     tids-filtrerede tælleforespørgsel som den gamle docs skridt 5, "Tælle-queries").
6. **Entries** (kun hvis valg B ovenfor — `auto_calendar_enabled` var OFF):
   kør `generateSeasonEntries.js` manuelt som i den gamle doc skridt 6.
7. **Sæson-achievements:** `backfillSeasonAchievements.js --execute` UDEN
   `--skip`-flag (se punkt 6 ovenfor).
8. **Slutkontrol:** `SEASON_TRANSITION_CHECKLIST.md` skridt 7 uændret. Tilføj:
   verificér #3114 (Monuments/D1) og #2164 (D3→D4) ikke har produceret synlige
   fejl for de first-time-berørte hold (spot-check et par nyoprykkede D1-hold
   + et par nyrelegerede D4-hold i deres nye puljers kalender).

## S3 → S4 (28/9 2026) - kun det der er ANDERLEDES

Alt ovenfor gælder stadig som mekanik. Fem ting er nye, målt read-only mod prod 3/9 2026.

1. **Kalenderen bygges FØR cutoveren, ikke som fase 17.** S2→S3's punkt 1 var et valg
   mellem A (manuelt script) og B (`auto_calendar_enabled='on'`). Valget står fast på A,
   og scriptet er nu det eneste sted længden og gatene bor:
   `node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days N`.
   Fuld opskrift + gate-tabel: `docs/CALENDAR_RULES.md` §2d.

2. **Sæsonlængden er ikke 31.** S3 kørte 31 løbsdatoer, fordi den startede en fredag.
   S4 starter **mandag 28/9** (S3 slutter søndag 27/9), og §2's søndags-regel tillader
   derfor kun hele uger. 35 dage er målt umuligt (D3 får 18 kalenderdage uden løb).
   Ejeren skal vælge længden eksplicit; `--apply` nægter at køre på scriptets forslag.

3. **`seasons`-rækken for S4 findes ikke - og årsmødet er dødt indtil den gør.**
   `proposeNextMandate` slår næste sæson op på `number` og springer alle hold over med
   `target_season_not_found`. Rækken oprettes af `--apply` med status `'upcoming'`;
   `insertSeasonIfMissing` promoverer den selv til `'active'` ved cutoveren.
   Kontrakten er låst i `backend/lib/seasonLookup.js` + `seasonLookup.test.js`.

4. **Inaktive managere parkeres ved dette skifte** (#4592/#4307): 30 dage uden login
   (`users.last_seen`) → uden for divisionerne, hvilket frigør pladser i puljerne.
   Definitionen + rapporteringen findes; selve parkeringen er del 2 og skal verificeres
   som bygget FØR cutoveren, ikke antages.

5. **Fire gates var røde i tørkørslen 3/9** og skal lukkes før kalenderen bygges:
   D2's komposition (kuperet/bjerg), D1's brosten-i-etapeløb og D1's nedkørsels-finaler.
   To af dem peger på kataloget (§5b), ikke på generatoren - de kan altså ikke kalibreres
   væk. Fund, tal og beslutningsliste: `docs/audits/season4-calendar-dryrun-2026-09-03.md`.

6. **`season_transition_planned_at` sættes nu AUTOMATISK af `--apply` (#4129).**
   Sæsonskifte-guarden (#4004) læser `app_config.season_transition_planned_at` for at
   afgøre hvornår en auktion ville krydse selve sæsonskiftet. Nøglen blev historisk
   KUN sat manuelt, én gang, på selve S2→S3-cutover-aftenen 23/8 (og ryddet igen samme
   aften) — ingen kode satte den, så guarden kørte i praksis på det uskrevne
   start_date-gæt hele vejen indtil da (se #4129). `buildSeasonCalendar.js --apply`
   sætter nu nøglen selv, idempotent, som en del af trin 1 ovenfor. **Siden #5592 er
   værdien det skifte kalenderen planlægges mod** (tørkørslens linje "sæsonskifte der
   planlægges mod"): det tidligst mulige skifte efter S3's seneste etape, eller en
   senere værdi der allerede står i nøglen. Tørkørslen 26/9 gav **27/9 19:30 dansk tid
   (17:30 UTC)**, ikke den gamle fallback kl. 18:00. Intet manuelt SQL-trin behøves for
   det NORMALE forløb. Verificér alligevel FØR selve cutoveren
   (Supabase MCP `execute_sql` eller `psql`, read-only):

   ```sql
   select key, value, updated_at from app_config where key = 'season_transition_planned_at';
   select number, status, start_date from seasons where status = 'upcoming';
   ```

   Forvent `value` = det tidspunkt tørkørslen planlagde mod (26/9: 27/9 19:30 dansk tid).
   Sæt den **aldrig** tilbage til 18:00: så ville auktionsvagten bruge et tidligere skifte
   end det kalenderens første løbsdag er planlagt efter. Mangler nøglen efter `--apply`,
   eller skal skiftet ske SENERE, sættes den til det senere tidspunkt (en senere værdi
   bevares af scriptet; sæt den FØR `--apply`, så første løbsdag planlægges mod den):

   ```sql
   insert into app_config (key, value)
   values ('season_transition_planned_at', '"2026-09-27T19:30:00+02:00"'::jsonb)
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```

   En daglig read-only cron-vagt (`runDailySeasonCountCheck` i `backend/cron.js`,
   se `backend/lib/seasonTransitionKeyGuard.js`) alarmerer selv (Sentry) hvis nøglen
   mangler/afviger > 12t fra fallbacken mens der er < 7 dage til næste sæsonstart —
   men vent ikke på den alarm, tjek proaktivt som en del af selve cutover-trinene.

> **Uændret og stadig bindende:** §2c's "én regenerering pr. sæsonkalender". Er S4's
> kalender skrevet, er formen låst for S4 - en fejl bagefter står til S5.

## S4-tændingsplan (issue #5506)

> **Rækkefølgen er et forslag; ejeren bestemmer.** Planen tænder intet. Hvert trin har ét go-punkt (ejeren), én kontrol og én fortryd-vej. Højst én kontakt pr. trin, og kontrollen skal være grøn, før næste trin startes. Tilstanden er målt read-only mod prod og GitHub 23/9.

**Udgangspunkt 23/9 (målt):**
- **Sæson 3:** S3 er `active`, og 26 af 31 løbsdatoer er kørt. Sidste løbsdag er søndag 27/9, og der er 135 S3-løb, som ikke er `completed`.
- **Sæson 4:** S4-rækken findes ikke, og der er 0 S4-løb.
- **Mangler i `app_config`:** `season_transition_planned_at` (sættes af trin 1) og `rider_primary_type_from_distribution`.
- **Kontakterne** står som beskrevet i issuet.

**Fælles mekanik:**
- **Kontakt-flip:** Admin > System, flag-tavlen (`AdminSystemTab.jsx:213`). Den kalder `PATCH /api/admin/feature-flags/<key>` med `{"stage":"on"}` (`backend/routes/api.js:14776`). Tavlen skriver `admin_log` (`feature_flag_changed`) og `app_config.updated_by`.
- **Boolean-flag:** tavlen tillader kun on/off, ikke beta.
- **Fortryd et flip:** samme tavle, tilbage til forrige stadie.
- **Generel flip-kontrol:** `select key, value, updated_at, updated_by from app_config where key = '<key>';`
- **Node-kommandoer:** køres fra `C:\Dev\CyclingZone` med prod-creds via `infisical run --env=prod --silent --`. Det er samme mønster som `scripts/run-value-event-5443.ps1`. Ejer-kommandoer er PowerShell 5.1: brug `;`, ikke `&&`.
- **`'<flip-tid>'`:** tidspunktet for go'et, i UTC.

### Oversigt

| Trin | Hvad | Go | Fortryd findes? | Kan tændes i dag? |
|---|---|---|---|---|
| **Fase A: før cutover (nu til lørdag 26/9)** | | | | |
| 1 (H1) | S4-kalenderen skrives **lørdag 26/9** med `--target-structure s4` (#5795): D4 E-H planlægges som pensioneret, før S3 slutter. Trin 12b er kun en kontrol | ejer | Delvis: kun genopbygning, mens S4 er `upcoming` | Ja teknisk (senior), mangler go. Ungdom: nej, grupperne er ikke seedet |
| 2 (H8) | Træningsscore for alle | ejer | Ja (kontakt) | Ja, mangler udmelding |
| 3 (H12) | Notify-kø for løbsbeskeder | ejer (ejer-only) | Ja (kontakt) | Ja |
| 4 (H9) | Ny mobil-træningsside for alle | ejer | Ja (kontakt) | Ja, mangler Android-test |
| 5 (ekstra) | `season_signup_enabled` (tilmelding + parkering) | ejer | Delvis: parkerede hold kan ikke af-parkeres | Ja teknisk |
| 6 (H10a) | Bestyrelses-backfill (#4857) | ejer | **INGEN (RØD)** | Ja teknisk, mangler go |
| 7 (H13) | Trup-backfill (#4619/#5396) | ejer | **Delvis (RØD)**: snapshot findes, rollback uafprøvet | Ja teknisk, mangler go |
| 8 (H2) | Værdikørslen (#5443) | ejer | Ja (`-Rollback` + nøgle tilbage) | Nej |
| 9 (H4) | Rating = bedste rolle nu | ejer | Ja (kontakt) | Nej |
| 10 (H3) | Merge #5461 (patch note + hjælp) | ejer ("merge") | Ja (revert) | Nej |
| **Fase B: søndag 27/9** | | | | |
| 11 (H15) | Søndagskørslen kl. 06 | ejer (beslutning) | **INGEN (RØD)** | Kører selv |
| 12 (H14) | Selve cutover-kørslen | ejer | **INGEN (RØD)**, kun PITR | Nej |
| 13 (H11) | Løbsmotor v4 | ejer-only | Delvis: ikke prod-testet midt i et etapeløb | Nej |
| **Fase C: mandag 28/9 og frem** | | | | |
| 14 (H6) | Træning pr. løbsdag | ejer | Delvis: risiko for dobbelt tick | Nej |
| 15 (H7) | Merge #5281 (B3, bonus væk) | ejer ("merge") | Ja (revert) | Nej |
| 16 (H10b) | Mandatet for alle (#4859) | ejer | Ja (kontakt til beta) | Nej |
| 17 (H5) | primaryTypeMode (#5327) | ejer | **INGEN (RØD)** | Nej |

H-numrene er handlingernes numre i #5506. Handling 10 er delt i 10a (backfill) og 10b (flip), så der højst er én kontakt pr. trin. Trin 5 står ikke i issuet; se "Uafklaret".

---

### Trin 1 (H1): S4-kalenderen skrives

> **Rækkefølge ændret igen 26/9 (#5795, ejer: "vi har altid lavet kalenderen før sæsonen var slut"):** seniorkalenderen skrives **lørdag 26/9, før S3's sidste løbsdag**, med `--target-structure s4`. Flaget planlægger mod S4's målstruktur: de D4-puljer som `retireD4PoolsS4.js` (#5642) pensionerer ved "Afslut sæson" (E-H, udpeget på `pool_index` med samme regel som scriptet), behandles i planen som pensionerede og får ingen løb. Databasen røres ikke af flaget: `retired_at`, S3's løb, stillinger og puljer er urørte. Uden flaget stopper gaten "pulje-struktur" stadig en kørsel med 8 D4-puljer (`SENIOR_CALENDAR_POOLS_FROM_S4` = 1/2/4/4). Trin 12b er nu en **kontrol**, ikke en skrivning. (24/9-rækkefølgen, hvor kalenderen først blev skrevet i 12b, er erstattet.)

- **For spilleren:** S4's løb, datoer og puljekalendere bliver synlige. Udtagelse til S4-løb åbner først når S4 er `active` (`seasonAllowsSelectionWrites`, #5405); en S4-kalender i dag kan altså ikke få udtagelser før skiftet.
- **Forudsætning:**
  - Tørkørslen med flaget viser "#5795 målstruktur s4 ... pensioneres ved skiftet ... Division 4 — E · F · G · H" og "#4592 puljer med kalender ... D1 1 · D2 2 · D3 4 · D4 4 ✅". D3 er 4, fordi alle fire D3-puljer allerede har managers (målt 26/9), og sammenlægningen (#5641) fordeler på alle fire.
  - Ungdomskalenderne kræver at truppernes grupper er seedet (`seedYouthPools.js --apply --owner-go`, #5646) og at seniorkalenderen er skrevet. **Målt 26/9: 0 grupper med `squad` = `u23`/`junior` i prod**, så `--squad`-kørslerne stopper selv i dag. De afhænger ikke af D4-pensioneringen og kan køres så snart grupperne er seedet.
  - Tørkørslen 26/9 har 0 finale-afvigelser (§7b); de tre fra #5405's kommentar 22/9 er lukket. `--allow-finale-drift` er derfor ikke nødvendig.
  - Den gyldne diff og en frisk tørkørsel skal køres umiddelbart før.
  - S4-rækken findes ikke. `--apply` opretter den som `upcoming` og sætter `season_transition_planned_at` til det skifte kalenderen planlægges mod (tørkørslens linje "sæsonskifte der planlægges mod", 26/9: 27/9 19:30 dansk tid). Skal "Udfør sæsonskifte" ske senere, sættes nøglen til det tidspunkt FØR `--apply`, så første løbsdag planlægges mod det.
  - `auto_calendar_enabled` er ikke sat i prod (= off, målt 26/9), så transitionen bygger ikke kalenderen igen.
- **Go:** ejer, "kør" på tallene fra den friske tørkørsel (`CALENDAR_RULES.md` §2c/§2d).
- **Kommando** (`buildSeasonCalendar.js`):
  ```powershell
  cd C:\Dev\CyclingZone\backend
  node scripts/dev/calendarGoldenDiff.mjs
  infisical run --env=prod --silent -- node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 28 --target-structure s4
  infisical run --env=prod --silent -- node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 28 --target-structure s4 --apply
  # #5644: truppernes egne kalendere, EFTER seniorens (tørkørsel først, så --apply pr. trup)
  infisical run --env=prod --silent -- node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 28 --squad u23
  infisical run --env=prod --silent -- node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 28 --squad u23 --apply
  infisical run --env=prod --silent -- node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 28 --squad junior
  infisical run --env=prod --silent -- node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --race-days 28 --squad junior --apply
  ```
  `--target-structure` gælder kun seniorkalenderen; med `--squad` afvises den. `--uniform-tilt` bruges ikke (§2d). Truppernes kørsler har ikke K-B-/scorecard-gatene (de er kalibreret mod senioren); de gates af kalender-invarianterne, planlægningsvinduet og truppens tæthed (U23 1-2 løb pr. uge, junior 1, `CALENDAR_RULES.md` §1f).
- **Kontrol bagefter:**
  ```sql
  select s.number, s.status, s.start_date,
         (select count(*) from races r where r.season_id = s.id) as loeb,
         (select count(*) from races r where r.season_id = s.id and r.scheduled_for < now()) as loeb_i_fortiden
  from seasons s where s.number = 4;
  select value from app_config where key = 'season_transition_planned_at';
  -- #5644: løb pr. trup og tier, og ingen løb i en pensioneret pulje
  select coalesce(r.squad, 'senior') as trup, d.tier, count(distinct d.id) as puljer, count(*) as loeb
  from races r join league_divisions d on d.id = r.league_division_id
  where r.season_id = '00000000-0000-0000-0000-000000000004' group by 1, 2 order by 1, 2;
  select count(*) as loeb_i_pensionerede_puljer from races r join league_divisions d on d.id = r.league_division_id
  where r.season_id = '00000000-0000-0000-0000-000000000004' and d.retired_at is not null;
  -- #5795: før pensioneringen står E-H som aktive. Samme kontrol på pool_index (E-H = 4-7):
  select count(*) as loeb_i_d4_e_til_h from races r join league_divisions d on d.id = r.league_division_id
  where r.season_id = '00000000-0000-0000-0000-000000000004' and coalesce(r.squad, 'senior') = 'senior'
    and d.tier = 4 and d.pool_index >= 4;
  ```
  Forventet: `upcoming`, `2026-09-28`, `loeb` > 0 og `loeb_i_fortiden` = 0. `value` = det skifte tørkørslen planlagde mod (26/9: 27/9 19:30 dansk tid, dvs. 17:30 UTC, #5592). Senior: puljer 1/2/4/4, `loeb_i_pensionerede_puljer` = 0 og `loeb_i_d4_e_til_h` = 0. Scriptets egen post-verify printer også "løb i puljer der pensioneres ved skiftet: 0 ✅" og stopper rødt ellers. Tallene pr. division står i tørkørslen (målt 26/9: D1-D3 uændrede, D4 halveres fra 8 til 4 puljer).
- **Fortryd:**
  - Mens S4 er `upcoming`: kør samme kommando med `--apply --replace-existing` (også `--target-structure s4`, ellers stopper pulje-gaten før pensioneringen). Det sletter efter et JSON-snapshot til `docs/snapshots/5405/` og bygger forfra, og det kræver sit eget go (§2d).
  - **Pr. trup (#5644):** `--replace-existing` sletter kun den kørte trups løb. Senior (uden `--squad`) rører ikke U23-/juniorløbene, og `--squad u23` rører ikke senior- eller juniorløbene. Før #5644 slettede den hele sæsonen.
  - Der findes ingen vej, der sletter uden at bygge igen.
  - Fra S4 er `active`: INGEN (låst, §2c).
- **Hvad kalenderen i dag IKKE påvirker (#5795, verificeret i koden 26/9):** S3's løb og stillinger (materializeren skriver kun `races`/`race_stage_profiles`/`race_stage_schedule` for `season_id` = S4). Stage-scheduleren, AI-udtagelsen og pulje-reconcile læser kun den `active` sæson. "Afslut sæson" (`POST /api/admin/seasons/:id/end`) læser kun S3's løb. Sammenlægningen flytter hold ind i D3-puljer, der allerede har S4-løb; løb hænger på puljen, ikke på holdet, og der findes ingen S4-udtagelser før S4 er `active`. Pensioneringen af E-H sletter ingen løb, og E-H har ingen S4-løb. Til gengæld: fra `--apply` er S4-rækken der, så årsmødet ved "Afslut sæson" finder næste sæson (#4557), og auktionsvagten (#4004) stopper nye auktioner der ville slutte efter det planlagte skifte.
- **Kan tændes i dag?** Ja for senioren (tørkørslen 26/9 er grøn med flaget), mangler ejer-go. Ungdom: nej, grupperne er ikke seedet.

### Trin 2 (H8): Træningsscore for alle

- **For spilleren:** Scoren fra 1 til 99 og grafen vises på træningssiden og rytterprofilen for alle, ikke kun beta.
- **Forudsætning:**
  - Ingen teknisk afhængighed.
  - Motoren skriver scorer uanset flaget: 43.180 rækker i `rider_training_scores`, seneste 22/9.
  - help.json og patch notes dækker scoren.
  - Ejerens udmelding: ingen evidens for, at den er postet.
- **Go:** ejer.
- **Kommando:** flag-tavlen: `training_score_visible` -> `on` (læser: `backend/lib/trainingScoreFlag.js:19`, `api.js:2790`).
- **Kontrol bagefter:** `GET /api/training/me` som ikke-beta-konto. Forventet: svaret indeholder feltet `trainingScore`.
- **Fortryd:** flag-tavlen -> `beta`.
- **Kan tændes i dag?** Ja. Mangler kun udmeldingen.

### Trin 3 (H12): Notify-kø for løbsbeskeder

- **For spilleren:** Løbsbeskederne på Discord sendes fra en kø. Afviklingen venter ikke længere på Discord, så etaperne står mindre i kø.
- **Forudsætning:**
  - Ingen afhængighed.
  - Tabellen `race_notify_outbox` findes med 0 rækker.
  - Skal måles på en stor klynge kl. 12 eller 18 (`backend/lib/raceNotifyOutboxFlag.js:16-17`).
  - Foreslås kørt i S3, så målingen ikke blandes med v4 og S4-start.
- **Go:** ejer (ejer-only, #3624).
- **Kommando:** flag-tavlen: `race_notify_outbox_enabled` -> `on` (:20). `beta` læses som off (:11-14).
- **Kontrol bagefter:**
  ```sql
  select status, count(*) from race_notify_outbox where created_at >= '<flip-tid>' group by status;
  ```
  Forventet efter klyngen: kun `sent`, 0 `failed`, ingen `pending` eller `sending` ældre end 5 minutter.
- **Fortryd:** flag-tavlen -> `off`. Rækker, der allerede står i køen, sendes stadig, fordi drain-tikket ikke læser flaget (`backend/lib/discordNotifier.js:620`, `backend/cron.js:576-585`).
- **Kan tændes i dag?** Ja.

### Trin 4 (H9): Ny mobil-træningsside for alle

- **For spilleren:** Telefonen viser den nye tabel med dagens løbsdage som kolonner. Desktop er uændret.
- **Forudsætning:** Ejerens Android-test (#3643 åben).
- **Go:** ejer.
- **Kommando:** flag-tavlen: `training_mobile_table` -> `on` (`backend/lib/trainingMobileTableFlag.js:28`).
- **Kontrol bagefter:** `GET /api/training/me` (`api.js:2776`) som ikke-beta-konto. Forventet: `"mobileTable": true`.
- **Fortryd:** flag-tavlen -> `beta`. Det virker, så længe den gamle mobil-gren findes i `frontend/src/pages/TrainingPage.jsx` (kommentar ved :2100).
- **Kan tændes i dag?** Ja teknisk. Mangler Android-testen.

### Trin 5 (ekstra, ikke i #5506): Tilmelding og parkering (`season_signup_enabled`)

- **For spilleren:** Inaktive managere ser kortet "Tilmeld dig næste sæson". Ved "Afslut sæson" parkeres hold uden login i 30 dage, som ikke har tilmeldt sig. De mister deres puljeplads.
- **Forudsætning:**
  - Ejer-beslutning om parkering ved S4 (#4592 åben).
  - Win-back-mailen (send-go står i NOW).
  - Skal være on, før "Afslut sæson" (trin 12) køres. Ellers sker der ingen parkering (`backend/lib/economyEngine.js:1523-1527`).
- **Go:** ejer.
- **Kommando:** flag-tavlen: `season_signup_enabled` -> `on` (`backend/lib/seasonSignupFlag.js:14`). Tørkørsel af parkeringen, som skriver intet:
  ```powershell
  infisical run --env=prod --silent -- node backend/scripts/parkingDryRun.js
  ```
- **Kontrol bagefter:** `GET /api/season/signup-status` som inaktiv konto. Forventet: `"enabled": true, "eligible": true`.
- **Fortryd:**
  - Flag-tavlen -> `off` før "Afslut sæson": så parkeres ingen.
  - Efter parkering: INGEN af-parkerings-kode. Kun `parkTeam` findes (`backend/lib/managerParking.js:78`). Se afhjælpningen i trin 12.
- **Kan tændes i dag?** Ja teknisk. Mangler ejer-beslutningen.

### Trin 6 (H10a): Bestyrelses-backfill (#4857)

- **For spilleren:** Menneskehold uden bestyrelsesrelation får relation og mandat, så mandatkortet ikke står tomt.
- **Forudsætning:**
  - Ingen teknisk afhængighed.
  - Tallet har flyttet sig: 10 menneskehold uden `board_relations` målt 23/9 med scriptets prædikat. Issuet siger 2.
  - Tørkørslen skal vises igen.
- **Go:** ejer, "kør" på tørkørslens liste.
- **Kommando** (`backfillMandateForTeamsWithoutRelation.js:35`, `--apply --owner-go` :186-189; scriptets header bruger `node --env-file=backend/.env`):
  ```powershell
  infisical run --env=prod --silent -- node backend/scripts/backfillMandateForTeamsWithoutRelation.js
  infisical run --env=prod --silent -- node backend/scripts/backfillMandateForTeamsWithoutRelation.js --apply --owner-go
  ```
- **Kontrol bagefter:**
  ```sql
  select count(*) from teams t
  where not t.is_ai and not coalesce(t.is_bank, false) and not coalesce(t.is_frozen, false)
    and not coalesce(t.is_test_account, false)
    and not exists (select 1 from board_relations br where br.team_id = t.id);
  ```
  Forventet: 0, eller kun de hold, tørkørslen rapporterer som "ikke klar" (uden `season_1_identity_basis`).
- **Fortryd:** INGEN. **RØD.** Se afhjælpning 2.
- **Kan tændes i dag?** Ja teknisk. Mangler go og afhjælpningen.

### Trin 7 (H13): Trup-backfill (#4619, prædikat fra PR #5396)

- **For spilleren:**
  - Akademiryttere placeres i U23 eller junior efter sæsonalder.
  - Akademiryttere på 23 år eller mere får en afventende Graduation Day-beslutning.
  - Seniorsiden er uændret, fordi prædikatet kræver begge kolonner.
- **Forudsætning:**
  - Migrationen er kørt, og snapshot-tabellen `riders_4619_squad_backup_20260915` findes og er tom.
  - I dag står 522 akademiryttere som `squad='senior'`.
  - #5432 (8-loftet i SQL-RPC'erne) og #4620 (U23-kalender) er åbne.
  - Ingen evidens for den bedste timing i forhold til cutover.
- **Go:** ejer, "kør" på tørkørslens tal.
- **Kommando** (`backfill-4619-riders-squad.js:33`, gates :353-357):
  ```powershell
  infisical run --env=prod --silent -- node backend/scripts/backfill-4619-riders-squad.js --dry-run
  infisical run --env=prod --silent -- node backend/scripts/backfill-4619-riders-squad.js --apply --owner-go
  ```
- **Kontrol bagefter:**
  ```sql
  select squad, is_academy, count(*) from riders group by 1, 2 order by 1, 2;
  select count(*) from riders_4619_squad_backup_20260915;
  select count(*) from academy_graduation where status = 'pending' and from_squad = 'u23' and to_squad = 'senior';
  ```
  Forventet:
  - 0 rækker med `squad='senior'` og `is_academy=true`.
  - Snapshot-antallet = tørkørslens antal ændrede ryttere.
  - Antallet af `pending` = tørkørslens antal.
- **Fortryd:** Delvis. Snapshottet skrives før opdateringen (`backfill-4619-riders-squad.js:298-309`), men der findes intet rollback-script. **RØD**, indtil afhjælpning 3 er testet.
- **Kan tændes i dag?** Ja teknisk. Mangler go og en testet rollback.

### Trin 8 (H2): Værdikørslen (#5443)

- **For spilleren:** Alle rytterværdier bliver regnet om på én gang, både op og ned. Lønkrav flytter sig ikke.
- **Forudsætning:**
  - **Modelvalget:** #5497 er ikke "godkendt til build", og #5502 er åben. Scriptet er låst til `v5` (`riderValueExtraordinaryRun5443.js:70`). Vælges den typefri model, skal der en ny model og en script-ændring til.
  - **Spillerbeskeder:** udmeldingen og besked aftenen før skal være postet. Ingen evidens for, at de er ude.
  - **Ikke søndag:** scriptet nægter at køre om søndagen (:122). Kør fredag 25/9 eller lørdag 26/9.
  - **I prod 23/9:** `backup_5443_value_event_20260920` findes med 0 rækker, og begge nøgler står `v4`.
- **Go:** ejer, ordret "kør" efter tørkørslen (runbook trin 6).
- **Kommando** (`docs/runbooks/5443-ekstraordinaer-vaerdikoersel.md` trin 4-7). Nøgle og kørsel er ét trin: scriptet nægter uden nøglen, og nøglen alene lader søndagskørslen regne med v5.
  ```sql
  update public.app_config set value = '"v5"'::jsonb where key = 'rider_valuation_model';
  ```
  ```powershell
  pwsh -File scripts/run-value-event-5443.ps1
  pwsh -File scripts/run-value-event-5443.ps1 -Apply
  ```
- **Kontrol bagefter:**
  ```sql
  select run_date, changed, written, completed_at from rider_value_sunday_log order by run_date desc limit 1;
  select count(*) as loengrundlag_flyttet from riders r
    join backup_5443_value_event_20260920 b on b.rider_id = r.id
   where r.current_production_value is distinct from b.current_production_value;
  select count(*) filter (where best_role is null) as uden_bedste_rolle from riders where not coalesce(is_retired, false);
  ```
  Forventet:
  - Dagens dato med `completed_at` sat.
  - `loengrundlag_flyttet` = 0.
  - `uden_bedste_rolle` = 0, eller kun ryttere uden evner. Det er forudsætningen for trin 9; i dag er tallet 8.555.
- **Fortryd:**
  ```powershell
  pwsh -File scripts/run-value-event-5443.ps1 -Rollback
  ```
  ```sql
  update public.app_config set value = '"v4"'::jsonb where key = 'rider_valuation_model';
  ```
  - Backuppen dækker 6 kolonner inklusive `best_role`/`best_role_rating` (`BACKED_UP_COLUMNS` :77). Runbooken siger fejlagtigt 4.
  - Sæt samtidig trin 9's kontakt til off, og revertér #5461, hvis trin 10 er kørt.
- **Kan tændes i dag?** Nej. Modelvalg, spillerbesked og "kør" mangler.

### Trin 9 (H4): Rating = bedste rolle nu

- **For spilleren:** Ratingen på kort, tabeller og profil bliver "bedste rolle nu" med rollenavn, og type-badget hedder "Natural role". Ratingen kan kun stige (`frontend/src/lib/riderRating.js:88-93`, ejer-regel 17/9).
- **Forudsætning:**
  - Trin 8's kontrol er grøn, især `uden_bedste_rolle`. Med tom cache viser lister uden evner en tom rating (`riderRating.js:76-83`).
  - Ejer-beslutning 22/9: tændes sammen med værdiskiftet (`backend/lib/riderBestRoleDisplayFlag.js:8-11`).
  - Kør umiddelbart efter trin 8. Mens kontakten er off, vises egen rolle (`primary_type`), og værdikørslen kan skifte den. En synlig rating kan altså falde mellem trin 8 og 9. Udledt af koden, ingen prod-måling.
- **Go:** ejer.
- **Kommando:** flag-tavlen: `rider_best_role_display` -> `on`.
- **Kontrol bagefter:** `GET /api/display-flags` (`api.js:1242`) som ikke-beta-konto. Forventet: `{"rider_best_role_display":true}`.
- **Fortryd:** flag-tavlen -> `off`.
- **Kan tændes i dag?** Nej. Cachen er tom, og ejer-beslutningen binder trinnet til trin 8.

### Trin 10 (H3): Merge #5461 (patch note + help.json)

- **For spilleren:** Patch note og hjælpetekst forklarer værdiskiftet.
- **Forudsætning:**
  - Trin 8 er kørt og kontrolleret.
  - Konflikten skal løses: PR'en har `mergeStateStatus` DIRTY 23/9.
  - Version `7.293` er allerede brugt på main, så PR'en skal have ny version og kørselsdagens dato.
  - EN-teksten ("every rider is priced as the type he is today") passer kun til v5. Den skal omskrives, hvis modellen bliver typefri.
- **Go:** ejer, ordret "merge".
- **Kommando:**
  ```powershell
  pwsh -File scripts/merge-queue.ps1 -Pr "5461" -DryRun
  pwsh -File scripts/merge-queue.ps1 -Pr "5461"
  ```
- **Kontrol bagefter:** `gh pr view 5461 --repo NicolaiDolmer/CyclingZone --json state,mergeCommit`. Forventet: `MERGED`, og efter deploy står værdinoten øverst på cyclingzone.org/patch-notes.
- **Fortryd:** `git revert --no-edit <merge-sha>` på egen branch, derefter PR gennem merge-køen.
- **Kan tændes i dag?** Nej.

### Trin 11 (H15): Søndagskørslen 27/9 kl. 06

- **For spilleren:** Den normale ugentlige værdiopdatering, sidste gang i S3.
- **Forudsætning:**
  - #5443 trin 3: rækkefølgen mellem søndagskørslen og cutover skal stå i drejebogen. Den kører før cutover, som ligger om aftenen.
  - Er trin 8 kørt, regner den med v5.
  - Markedsblendet er off (`market_value_sweep_enabled`).
- **Go:** ejer vælger mellem (A) lad den køre med backup og (B) spring den over.
- **Kommando:**
  - (A) Ingen. Cron `sunday-value-refresh` kører selv (`backend/cron.js:2179`).
  - (B) Et claim på forhånd får sweepen til at springe dagen over (`backend/lib/sundayValueSweep.js:158-170`):
    ```sql
    insert into public.rider_value_sunday_log (run_date) values ('2026-09-27');
    ```
    Ingen evidens for, at en tom claim-række ikke udløser en alarm.
- **Kontrol bagefter:**
  ```sql
  select run_date, scanned, changed, written, completed_at from rider_value_sunday_log where run_date = '2026-09-27';
  ```
  Forventet ved (A): én række med `completed_at` sat. Ved (B): én række med `completed_at` null.
- **Fortryd:** INGEN, fordi kørslen ikke tager backup. **RØD.** Se afhjælpning 4.
- **Kan tændes i dag?** Kører af sig selv. Det, der mangler, er ejerens valg og backuppen.

### Trin 11b (ejer-kørt): Sluk akademi-drift for S3-skiftet (#5741)

- **For spilleren:** Ingen ungdomsdrift (akademi-drift) opkræves ved DENNE sæsonskiftekørsel — ejer-beslutning 25/9. Rammer kun selve cutover-lønkørslen (12c); resten af akademiet (intake, træning m.m.) er uændret.
- **Forudsætning:** Køres FØR trin 12c "Udfør sæsonskifte", fordi akademi-drift debiteres inde i `processTeamSeasonPayroll` (trin 4), som kaldes fra `processSeasonStart` for den NYE sæson — dvs. inde i `seasonTransition.js` fase 6, udløst af 12c (`POST /api/admin/season-transition`), IKKE af "Afslut sæson" (12a, `POST /api/admin/seasons/:id/end`). Er nøglen ikke sat til `off` inden 12c er kørt, opkræves drift som normalt, og kan ikke fortrydes bagud (se "Fortryd" nedenfor). **Sæt IKKE nøglen tilbage til `on` mellem 12a og 12c** — S4-rækken findes ikke engang endnu på det tidspunkt, og en kontrol dér ville vise 0 uanset nøglens værdi og bevise intet.
- **Go:** ejer.
- **Kommando (før 12c):**
  ```sql
  update public.app_config set value = '"off"'::jsonb where key = 'academy_drift_enabled';
  ```
- **Kontrol bagefter (efter 12c's kørsel):**
  ```sql
  select count(*) from finance_transactions where type = 'academy_drift' and season_id = '00000000-0000-0000-0000-000000000004';
  ```
  Forventet: 0.
- **Fortryd:** sæt nøglen tilbage til `on` — men KUN efter 12c er kørt, aldrig mellem 12a og 12c:
  ```sql
  update public.app_config set value = '"on"'::jsonb where key = 'academy_drift_enabled';
  ```
  Drift for DENNE sæsonskiftekørsel er allerede ikke opkrævet og opkræves IKKE bagud — flaget styrer kun kørslen på det tidspunkt lønnen faktisk kører, ikke en efterfølgende genberegning.
- **Kan tændes i dag?** Ja, nøglen kan sættes til `off` når som helst før 12c. Migrationen (`database/2026-09-25-5741-academy-drift-enabled.sql`) sætter kun default `on` — uændret adfærd ved merge.

### Trin 12 (H14): Selve cutover-kørslen

- **For spilleren:**
  - S3 afsluttes med op- og nedrykning.
  - S4 bliver aktiv: kontrakter, sponsorer, løn, pension og nulstilling af form.
  - Inaktive hold parkeres, hvis trin 5 er on.
- **Forudsætning:**
  - Alle S3-løb er afviklet. S4-kalenderen (trin 1) er skrevet lørdag 26/9 med `--target-structure s4` (#5795); 12b er kun en kontrol.
  - Preflight uden `[NO-GO]` (`scripts/preflight-season-cutover.ps1:29`). Den dækker ikke kontakterne i denne plan.
  - PITR er verificeret frisk i Supabase-dashboardet (`SEASON_TRANSITION_CHECKLIST.md` skridt 0 pkt. 1).
  - Trin 5 er afgjort.
  - #4153 (løn for ryttere, der pensioneres i samme skifte) er åben.
- **Go:** ejer for hvert klik: "Afslut sæson" og "Udfør sæsonskifte" hver for sig.
- **Kommando:**
  ```powershell
  pwsh -File scripts/preflight-season-cutover.ps1 -FromSeasonNumber 3 -ToSeasonNumber 4
  ```
  Derefter, i denne rækkefølge (#4592 + #2492, ejer 24/9):
  1. **12a** "Afslut sæson" på `/admin/season` = `POST /api/admin/seasons/00000000-0000-0000-0000-000000000003/end` (`api.js:11524`). `season_end_skip_division_movement` skal være off (normal op/nedrykning).
  2. **12a+** Sammenlægningen D4 → D3 (#5641) og pensioneringen af D4 E-H (#5642), hver med tørkørsel og eget go, og AI-fyldet af alle puljer. Ungdomsgrupperne seedes her, hvis de ikke allerede er det.
  3. **12b (kontrol, #5795)** S4-kalenderen er skrevet i trin 1. Efter pensioneringen køres trin 1's SQL-kontrol igen: senior 1/2/4/4 puljer, `loeb_i_pensionerede_puljer` = 0, og ingen D3-pulje uden managers efter sammenlægningen (`select d.id, count(t.id) from league_divisions d left join teams t on t.league_division_id = d.id and not t.is_ai and not t.is_bank where d.tier = 3 group by d.id;`). Kun hvis kontrollen er rød: tørkørsel og `--apply --replace-existing` (eget go, S4 er stadig `upcoming`). Mangler ungdomskalenderne, køres `--squad u23` og `--squad junior` her, når grupperne er seedet.
  4. Preview = `GET /api/admin/season-transition/preview` (`api.js:13996`).
  5. **12c** "Udfør sæsonskifte" = `POST /api/admin/season-transition` (`api.js:14013`). `auto_calendar_enabled` må ikke være sat, så transitionen ikke genererer kalenderen igen.

  Mekanikken følger checklistens skridt 0/1/1b/4/5/7 og afsnittene ovenfor.
- **Kontrol bagefter:**
  ```sql
  select number, status from seasons where number in (3, 4) order by number;
  select count(*) from admin_log where action_type = 'season_transition' and created_at >= '2026-09-27';
  select count(*) from season_form_reset_runs where season_id = '00000000-0000-0000-0000-000000000004';
  ```
  Forventet: S3 `completed` og S4 `active`, 1 kørsel og 1 form-nulstilling. Er trin 5 on, skal antallet af hold med `parked_at >= '2026-09-27'` desuden svare til tørkørslen.
- **Fortryd:** INGEN. Kun en Supabase PITR-gendannelse, som også sletter alt, spillerne har gjort siden. **RØD.** Se afhjælpning 5.
- **Kan tændes i dag?** Nej. S3 slutter 27/9, og sammenlægning og pensionering (12a+) køres først på selve dagen. Kalenderen er trin 1 (lørdag); 12b er kontrollen.

### Trin 13 (H11): Løbsmotor v4

- **For spilleren:** Etaperne afvikles af den nye løbsmotor.
- **Forudsætning:**
  - #4914, #4915 og #4948 er åbne 23/9. #4948 kræver en PR, der viser raceDay-hjælpen, i samme deploy.
  - #5505 er merget 22/9.
  - `race_engine_v3_scoring` skal stå on (`backend/lib/raceEngineFlag.js:73-78`). Den er on 23/9.
  - Timing: efter cutover-kontrollen og før første S4-etape, så intet etapeløb skifter motor midt i løbet.
- **Go:** ejer-only.
- **Kommando:** flag-tavlen: `race_engine_v4` -> `on`. Brug on/off, ikke beta (:80-83).
- **Kontrol bagefter:**
  ```sql
  select engine_version, count(*) from race_simulation_runs where created_at >= '<flip-tid>' group by engine_version;
  ```
  Forventet: kun `4`. v3 hedder `2` (`backend/lib/raceSimulator.js:67`).
- **Fortryd:** flag-tavlen -> `off`. Næste etape kører så v3, og klassementet bygges på begge motorer. Det er unit-testet (`backend/lib/raceRunnerEngineV4.test.js:301`), men aldrig afprøvet i prod midt i et etapeløb. Delvis; se afhjælpning 6.
- **Kan tændes i dag?** Nej.

### Trin 14 (H6): Træning pr. løbsdag

- **For spilleren:**
  - Løbsdagen bliver enheden for træning: 140 løbsdage pr. sæson i alle divisioner.
  - Træningen kører samlet efter dagens sidste løb, tidligst kl. 20.
  - En rytter kører enten et løb eller træner på en løbsdag, aldrig begge.
- **Forudsætning:**
  - S4 er aktiv (trin 12), og kalenderen findes (trin 1).
  - #5205, #5264, #5169 og #5465 er merget.
  - Kapacitetsgaten G6 er grøn (`TRAINING_RULES.md` §13.4).
  - Stadig ikke bygget: program pr. løbsdag (beslutning 8) og ops-vagterne B5. Ejeren skal acceptere at tænde uden dem.
  - Timing: mandag 28/9 før kl. 20.
- **Go:** ejer.
- **Kommando:** flag-tavlen: `training_tick_per_race_day` -> `on`. Det er et boolean-flag, så kun on/off (`backend/lib/trainingTickRaceDayFlag.js:21`, `dailyTrainingEngine.js:189`).
- **Kontrol bagefter:**
  ```sql
  select count(*) filter (where r.game_day is not null) as loebsdags_ticks,
         count(*) filter (where r.game_day is null) as kalenderdags_ticks
  from training_day_runs r join teams t on t.id = r.team_id
  where r.created_at >= '<flip-tid>' and t.league_division_id is not null;
  ```
  Forventet efter sweepen kl. 20: `loebsdags_ticks` > 0 og `kalenderdags_ticks` = 0.
- **Fortryd:** flag-tavlen -> `off`, så kører den gamle sti uændret igen. Men de to stier har hver sit unikke indeks (`dailyTrainingEngine.js:7-10`). Slukkes flaget efter dagens kl. 20-sweep, kan kalenderdags-sweepen kl. 22 træne samme dato en gang til. Det er udledt af koden, ikke testet. Delvis; se afhjælpning 7.
- **Kan tændes i dag?** Nej. S4 er ikke aktiv.

### Trin 15 (H7): Merge #5281 (B3: manager-bonussen fjernes)

- **For spilleren:** Den gamle bonus på 25 % for selv at trykke "Træn i dag" forsvinder helt fra kode og tekster.
- **Forudsætning:**
  - Trin 14's kontrol er grøn. Bonussen lever kun på den gamle sti (`dailyTrainingEngine.js:203`), så en merge før trin 14 ændrer balancen.
  - #5281 har `mergeStateStatus` DIRTY 23/9.
- **Go:** ejer, ordret "merge".
- **Kommando:**
  ```powershell
  pwsh -File scripts/merge-queue.ps1 -Pr "5281" -DryRun
  pwsh -File scripts/merge-queue.ps1 -Pr "5281"
  ```
- **Kontrol bagefter:** `git fetch; git --no-pager grep -n "bonusMult" origin/main -- backend/lib/dailyTraining.js`. Forventet: ingen træf, og "Deploy verify" er grøn.
- **Fortryd:** `git revert --no-edit <merge-sha>` på egen branch, derefter PR gennem merge-køen.
- **Kan tændes i dag?** Nej.

### Trin 16 (H10b): Mandatet for alle (#4859)

- **For spilleren:** Boardroom og årsmødet med mandat vises for alle, ikke kun beta.
- **Forudsætning:**
  - Lukket eller merget: #4855, #4856, #4843 og #4844.
  - Trin 6 er kørt, og S4 findes (trin 1 og 12, jf. #4838).
  - Tørkørslen er vist til ejeren (`cd backend; infisical run --env=prod -- node scripts/proposeNextMandateDryRun.js`).
  - Beta-feedbacken 19/9 om visningsfejl og manglende ord: ingen evidens for, at den er rettet.
- **Go:** ejer.
- **Kommando:** flag-tavlen: `board_mandate_model_enabled` -> `on` (`backend/lib/boardMandateFlag.js:32`).
- **Kontrol bagefter:**
  ```sql
  select status, count(*) from board_mandates where season_number = 4 group by status;
  ```
  Forventet: S4-mandater for alle berettigede menneskehold, samme antal som i tørkørslen. `GET /api/board/room` som ikke-beta-konto skal vise mandatet (`api.js:16921`).
- **Fortryd:** flag-tavlen -> `beta`. Det er kill-switchen: motoren skriver videre, men fladen skjules (`boardMandateFlag.js:12-27`).
- **Kan tændes i dag?** Nej. S4-rækken, trin 6 og tørkørslen mangler.

### Trin 17 (H5): primaryTypeMode (#5327)

- **For spilleren:** Nyfødte ryttere trækker primær type fra kalenderens efterspørgsel i stedet for divisionens vægte.
- **Forudsætning:**
  - #5503 er merget: kontakten findes kun i generatoren (`backend/lib/fictionalRiderGenerator.js:229-232`).
  - Ingen læser, ingen `app_config`-række, ingen migration og ingen post i `stageFlagCatalog.js`.
  - #5327-B er ikke bygget. Det er rodårsagen til sprinter-potentialet plus koblingen i `aiTeamGenerator.js`, `fictionalLaunchPopulation.js` og `starterSquadAllocator.js`.
  - Ifølge #5327 (22/9) skal kontakten tændes samlet med B, ikke før.
- **Go:** ejer.
- **Kommando:** findes ikke.
- **Kontrol bagefter** (foreslået, når B findes):
  ```sql
  select primary_type, count(*) from riders where created_at >= '<flip-tid>' group by primary_type;
  ```
  Sammenlignes med før/efter-målingen fra `backend/scripts/dev/typeDistribution5327.mjs`.
- **Fortryd:** INGEN for ryttere, der allerede er født med den nye type. Kontakten stopper kun nye fødsler. **RØD.** Se afhjælpning 8.
- **Kan tændes i dag?** Nej.

---

### Røde trin og afhjælpning

Alle afhjælpninger er prod-skrivninger. De kræver ejer-go og køres **før** trinnet. Backup-tabeller er ikke-destruktive. Rollback-SQL er uafprøvet, indtil den er kørt mod en kopi.

1. **Trin 1 (delvis):** Efter S4 er `active`, er kalenderen låst. Tørkørsel + gylden diff lige før `--apply` er den eneste sikring (§2c).

2. **Trin 6, bestyrelses-backfill:** gem holdlisten før kørslen:
   ```sql
   create table public.backup_4857_teams_before_backfill as
   select t.id as team_id, now() as captured_at from public.teams t
   where not t.is_ai and not coalesce(t.is_bank, false) and not coalesce(t.is_frozen, false)
     and not coalesce(t.is_test_account, false)
     and not exists (select 1 from public.board_relations br where br.team_id = t.id);
   ```
   Rollback (uafprøvet, destruktiv). Ingen evidens for, at tabel-listen er udtømmende; tjek den mod tørkørslens output:
   ```sql
   delete from public.board_vision_milestones where team_id in (select team_id from public.backup_4857_teams_before_backfill) and created_at >= '<apply-tid>';
   delete from public.board_mandates where team_id in (select team_id from public.backup_4857_teams_before_backfill) and created_at >= '<apply-tid>';
   delete from public.board_relations where team_id in (select team_id from public.backup_4857_teams_before_backfill) and created_at >= '<apply-tid>';
   ```

3. **Trin 7, trup-backfill:** tjek lige før apply, at `select count(*) from academy_graduation where from_squad is not null` = 0 (0 målt 23/9). Rollback-SQL (uafprøvet):
   ```sql
   update public.riders r set squad = coalesce(b.squad_before, 'senior'), is_academy = coalesce(b.is_academy_before, r.is_academy)
   from public.riders_4619_squad_backup_20260915 b where b.rider_id = r.id;
   delete from public.academy_graduation where status = 'pending' and from_squad = 'u23' and to_squad = 'senior' and created_at >= '<apply-tid>';
   update public.academy_graduation set from_squad = null, to_squad = null where created_at < '<apply-tid>';
   ```

4. **Trin 11, søndagskørslen:** tag backup lørdag aften, **efter** trin 8. Ellers ruller en tilbagerulning også værdikørslen tilbage.
   ```sql
   create table public.backup_s4_sunday_values_20260926 as
   select id as rider_id, base_value, current_production_value, primary_type, secondary_type, best_role, best_role_rating, now() as captured_at
   from public.riders;
   ```
   Rollback (uafprøvet):
   ```sql
   update public.riders r set base_value = b.base_value, current_production_value = b.current_production_value,
     primary_type = b.primary_type, secondary_type = b.secondary_type, best_role = b.best_role, best_role_rating = b.best_role_rating
   from public.backup_s4_sunday_values_20260926 b where b.rider_id = r.id;
   ```
   Alternativet er valg (B) i trin 11: spring kørslen over med et claim på forhånd.

5. **Trin 12, cutover:** verificér PITR. Tag snapshots lige før "Afslut sæson":
   ```sql
   create table public.backup_s4_cutover_teams_20260927 as
   select id, division, league_division_id, balance, parked_at, next_season_signup_at, now() as captured_at from public.teams;
   create table public.backup_s4_cutover_riders_20260927 as
   select id, team_id, salary, contract_end_season, contract_length, is_retired, now() as captured_at from public.riders;
   create table public.backup_s4_cutover_board_mandates_20260927 as
   select *, now() as captured_at from public.board_mandates;
   ```
   Snapshots giver et grundlag for reparation, ikke en ren fortrydelse: transaktioner, beskeder og nye mandater består. Af-parkering (uafprøvet):
   ```sql
   update public.teams t set league_division_id = b.league_division_id, parked_at = null
   from public.backup_s4_cutover_teams_20260927 b where b.id = t.id and t.parked_at >= '2026-09-27';
   ```
   Ingen evidens for, at puljen ikke imens er fyldt op af AI-hold. Uden PITR-accept står trinnet som **ejer-accepteret risiko**.

6. **Trin 13 (delvis):** skriv proceduren for at slukke v4 midt i et etapeløb ned før flip. Sluk mellem to etapeklynger, og tjek derefter:
   ```sql
   select race_id, stage_number, engine_version from race_simulation_runs where created_at >= '<off-tid>';
   ```
   Forventet: `2`. Tjek også, at GC-rækker findes for de berørte løb.

7. **Trin 14 (delvis):** sluk kun før dagens kl. 20-sweep. Tjek bagefter:
   ```sql
   select team_id, tick_date, count(*) from training_day_runs
   where tick_date = '<dato>' and coalesce(squad, 'senior') = 'senior'
   group by 1, 2 having count(*) > 1;
   ```
   Forventet: 0 rækker.

8. **Trin 17:** #5327-B skal mærke fødsler under den nye tilstand, fx med den eksisterende kolonne `riders.generation_tag`. Dermed kan de findes. At de beholder typen, står som ejer-accepteret risiko.

### Uafklaret: kræver ejer-beslutning

1. **Værdimodel:** v5 (typet; runbook og script er klar) eller typefri (#5497/#5502). Typefri kræver en ny model, en script-ændring (`REQUIRED_MODEL_ID = "v5"`) og ny #5461-tekst.
2. **Parkering ved S4:** skal ske? Kræver `season_signup_enabled` on før "Afslut sæson" (trin 5). Denne kontakt står ikke i #5506. Parkerede hold kan ikke af-parkeres med kode.
3. **S4-kalenderens tre finale-afvigelser:** ret dem eller acceptér med `--allow-finale-drift`.
4. **Søndagskørslen 27/9:** lad den køre med backup, eller spring over med et claim på forhånd (#5443 trin 3).
5. **v4-timing:** før første S4-etape (foreslået, så intet etapeløb skifter motor) eller senere. Samme dag som trin 14 giver to store ændringer på S4's første dag.
6. **Træning pr. løbsdag uden program pr. løbsdag og B5:** kan det tændes 28/9 uden dem?
7. **Mandatet for alle:** før eller efter cutover.
8. **primaryTypeMode:** med til S4 eller først senere. Ingen evidens for, hvilke fødsler cutover selv udløser; akademiets optag er off.
9. **Trup-backfill:** før eller efter cutover, set i forhold til #4620 og #5432.
10. **Cutover uden rollback:** accepteres risikoen, hvis PITR er verificeret og snapshots er taget?
11. **#4153:** løn for ryttere, der pensioneres i samme skifte, er åben. Rettes før 27/9 eller accepteres.

> Kilde: status quo-forslag 1 (ejer-ja 22/9), read-only research 23/9. Planen taender intet; hvert trin kraever ejerens go.

## Reference

- `docs/SEASON_TRANSITION_CHECKLIST.md` — S1→S2-drejebogen (komprimerings-specifik,
  men trin 0/1/1b/4/5/7-strukturen og transition-motor-referencerne er stadig facit).
- `scripts/preflight-season-cutover.ps1` — kør FØRST. Parametre: `-FromSeasonNumber`/
  `-ToSeasonNumber` (default 2→3), `-SkipTests`, `-SkipGh`.
- Åbne issues denne cutover skærer ind i: #2164 (D3→D4 eksplicit regel) ·
  #3114 (D1-oprykning game_day-sentinel) · #2840 (løn-mode dagsbaseret) ·
  #3266 (form-reset decay-claim-guard).
- Transition-motor: `backend/lib/seasonTransition.js` · readiness-gate:
  `backend/lib/seasonTransitionReadiness.js` · division-motor (LÆSES, ikke
  rørt): `backend/lib/economyEngine.js` (`processSeasonEnd`→`processDivisionEnd`).
