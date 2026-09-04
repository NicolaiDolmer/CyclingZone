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
   sætter nu nøglen selv (sæsonstart minus 1 dag kl. 18:00 dansk tid, samme værdi som
   fallbacken) idempotent, som en del af trin 1 ovenfor — intet manuelt SQL-trin
   behøves længere for det NORMALE forløb. Verificér alligevel FØR selve cutoveren
   (Supabase MCP `execute_sql` eller `psql`, read-only):

   ```sql
   select key, value, updated_at from app_config where key = 'season_transition_planned_at';
   select number, status, start_date from seasons where status = 'upcoming';
   ```

   Forvent `value` = S4's `start_date` minus 1 dag kl. 18:00 dansk tid (fx S4 starter
   28/9 → `"2026-09-27T16:00:00+00:00"` UTC = 18:00 CEST). Afviger den (eller mangler
   nøglen), sæt den eksplicit før cutoveren:

   ```sql
   insert into app_config (key, value)
   values ('season_transition_planned_at', '"2026-09-27T18:00:00+02:00"'::jsonb)
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```

   En daglig read-only cron-vagt (`runDailySeasonCountCheck` i `backend/cron.js`,
   se `backend/lib/seasonTransitionKeyGuard.js`) alarmerer selv (Sentry) hvis nøglen
   mangler/afviger > 12t fra fallbacken mens der er < 7 dage til næste sæsonstart —
   men vent ikke på den alarm, tjek proaktivt som en del af selve cutover-trinene.

> **Uændret og stadig bindende:** §2c's "én regenerering pr. sæsonkalender". Er S4's
> kalender skrevet, er formen låst for S4 - en fejl bagefter står til S5.

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
