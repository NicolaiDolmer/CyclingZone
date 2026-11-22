# Undersøgelse #8550: egne programmer + ugens løbsfelter og træthed pr. dag (design)

Refs #8550 · Refs #7456 · Refs #7947 · spor: kind investigate (#5220) · dato 21/11

> Leverancen er et teknisk design (kun docs, ingen kode). Briefen nævner stien
> `docs/superpowers/specs/2026-11-21-7456-egne-programmer-design.md`, men bølgens
> leveranceregel (#8233) tillader kun denne ene fil i PR'en. Designet står derfor
> her i fuld længde og kan flyttes ordret til spec-stien, når ejeren siger god for det.
> Offentligt repo: ingen balance-tal, holdnavne, brugernavne eller id'er.

## 0. Dom i én linje

Alle tre mangler i issuet er bekræftet i koden på `main` (`f471418de`). Nedenfor står
planen for at bygge dem: additiv datamodel, to nye kontakter (begge OFF), et nyt
uge-endpoint og en byggerækkefølge på fire PR'er.

## 1. Hvad jeg undersøgte og hvordan

| Kilde | Hvad den viser |
|---|---|
| `gh issue view 8550`, `gh issue view 7456` (body + seneste kommentarer) | Scope (3 dele), ejerens R5-beslutninger 20/11, telefonspørgsmålet (A/B-skifter) er stadig åbent |
| `backend/lib/trainingPrograms.js` | Kataloget er en fast, frossen liste i koden (`TRAINING_PROGRAMS`, 22 programmer). `findTrainingProgram(key)` kender kun dem |
| `backend/routes/trainingPrograms.js` | `GET /`, `POST /apply`, `PUT /cell`, `GET /forecast`. Tildeling = kopi ind i `training_week_plans.days`, `program_key` er kun proveniens (ejer-valg 1, 26/9) |
| `backend/routes/trainingGroups.js:311` | Gruppens "put program" validerer også kun mod det faste katalog |
| `backend/lib/trainingWeekPlanForecast.js` | `loadTeamFatigueForecast` regner KUN `tickDate = copenhagenDateString(now)`; datoens 5 løbsdage kommer fra `resolveDayCloseStatus` (kun i dag) |
| `frontend/src/components/training/r5/ProgramR5.tsx` + `programR5Model.ts` | `weekCells` markerer kun løb/låst når `weekday === todayWeekday`; "Træthed i aften" vises kun i dagens kolonne (`weekday === todayWeekday ? tonight : null`) |
| `database/2026-07-11-training-week-plans.sql`, `2026-09-26-4629-training-programs.sql`, `2026-10-01-training-groups.sql`, `database/schema-snapshot.json` | RLS-mønsteret (4 politikker pr. tabel, `team_id IN (SELECT id FROM teams WHERE user_id = auth.uid())`), kolonnerne `program_key text` på både `training_week_plans` og `training_groups` |
| `backend/lib/trainingDayCloseTrigger.js` | `loadDayCloseSpans` / `gameDaySpansByDivision`: løbsdagsaksen pr. dato (5 pr. dato, huller fyldes med rene træningsdage) |
| `backend/lib/trainingDateCondition.js` | `settleTrainingDateCondition` returnerer `{ fatigue, form, risk, injury }`; kan kædes dag for dag |
| Railway HTTP-metrik (read-only), prod-service, sti `GET /api/training/programs/forecast`, 7 dage | Baseline for svartid, se §5.1 |

Ingen skrivning nogen steder: ingen SQL, ingen scripts mod prod, ingen deploy.

## 2. Bekræftede fund (hvorfor dommen er "bekræftet")

1. **Egne programmer findes ikke.** `TRAINING_PROGRAMS` er `Object.freeze([...])` i
   `backend/lib/trainingPrograms.js:84`, og både `POST /apply` (`routes/trainingPrograms.js:243`)
   og gruppernes put (`routes/trainingGroups.js:311`) afviser alt andet end de 22 nøgler
   med `invalid_program`. Der er ingen tabel, ingen route og ingen "+ Nyt program" i R5
   (`PlusIcon` bruges kun til "addTarget").
2. **Løbsfelter kun i dag.** Prognosen leverer `raceSlots` for i dag alene, og
   `weekCells` (programR5Model.ts:265) tegner kun løbsfelt for `todayWeekday`.
3. **Træthed i aften kun i dag.** `loadTeamFatigueForecast` regner én dato;
   gitterets prognoserække viser kun noget i dagens kolonne (ProgramR5.tsx:619).

## 3. Del 1: spillerens egne navngivne programmer

### 3.1 Princip (låst, genåbnes ikke)

Ejer-valg 1 (26/9) gælder uændret: **tildeling er en kopi**. Et eget program er en
skabelon. At rette skabelonen flytter ALDRIG en plan, der allerede er tildelt (postmortem
#2438). Motoren læser stadig kun `training_week_plans.days` og `training_groups.days`;
motoren røres ikke i denne del.

### 3.2 Datamodel (additiv, idempotent migration)

Ny tabel `public.training_custom_programs`:

| Kolonne | Type | Regel |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `team_id` | uuid NOT NULL REFERENCES `teams(id)` ON DELETE CASCADE | ejerskab |
| `name` | text NOT NULL | `CHECK (char_length(btrim(name)) BETWEEN 1 AND 40)` (samme som `training_groups.name`) |
| `days` | jsonb NOT NULL | samme form som `training_week_plans.days`; valideres i app-kode med `isValidProgramWeekDays` (samme som i dag) |
| `based_on_key` | text NULL | proveniens: katalognøgle eller `custom:<uuid>` programmet blev startet fra |
| `archived_at` | timestamptz NULL | arkiv i stedet for sletning (AGENTS regel 38) |
| `created_at`, `updated_at` | timestamptz NOT NULL default `now()` | |

- Unikt navn pr. hold blandt aktive: `CREATE UNIQUE INDEX IF NOT EXISTS ... ON training_custom_programs (team_id, lower(btrim(name))) WHERE archived_at IS NULL`.
- Indeks `(team_id) WHERE archived_at IS NULL` til listen.
- **Ingen ændring af eksisterende tabeller.** Egne programmer refereres i de eksisterende
  text-kolonner `training_week_plans.program_key` og `training_groups.program_key` med
  nøglen `custom:<uuid>`. Katalognøglerne indeholder aldrig `:`, så de to navnerum kan
  ikke støde sammen. Gamle rækker er urørte.
- RLS: `ENABLE ROW LEVEL SECURITY` + fire politikker (select/insert/update/delete) `TO authenticated`
  med `team_id IN (SELECT teams.id FROM public.teams WHERE teams.user_id = (SELECT auth.uid()))`,
  præcis mønsteret fra `2026-10-01-training-groups.sql`. Backend bruger service-role som i dag;
  politikkerne holder en senere direkte klientlæsning sikker. Security-advisors tjekkes efter apply.
- Kontakt i samme migration: `INSERT INTO app_config (key, value, description) VALUES ('training_custom_programs', '"off"', ...) ON CONFLICT (key) DO NOTHING`.
  Registreres i `backend/lib/stageFlagCatalog.js` (area `training`).
- Migrationen applies post-merge via auto-migrate.yml (#2642); Claude post-verificerer
  (tabellen findes, 4 politikker, indeks, kontakten står på `off`).

### 3.3 API (alle bag `training_custom_programs`; off = 404 på skriv, tom liste på læs)

Ny route-fil efter samme fabrik-mønster: `backend/routes/trainingCustomPrograms.js`,
monteret under `/api/training/programs/custom` FØR `/training/:riderId`.

| Metode | Sti | Body | Svar / regler |
|---|---|---|---|
| GET | `/api/training/programs` (eksisterende) | | Nyt felt `custom: [{ key: "custom:<id>", name, days, basedOnKey }]` kun når kontakten er on. Ellers er svaret bit-identisk med i dag |
| POST | `/custom` | `{ name, days? , fromKey? , fromRiderId? }` | Opret. Præcis én kilde: tom uge ("Nyt program" starter fra en hvileuge? se §7 Q2), et katalog/eget program (`fromKey`) eller en rytters nuværende uge (`fromRiderId`, "Gem som program"). 400 `invalid_name` / `duplicate_name` / `invalid_days`; 403 `not_own_rider` |
| PATCH | `/custom/:id` | `{ name?, days? }` | Omdøb / ret skabelonen. Rører ALDRIG tildelte planer. `days` valideres med `isValidProgramWeekDays`; v3-sessioner kun når `training_catalog_v3` er åben for vieweren (samme regel som `PUT /cell`) |
| POST | `/custom/:id/archive` | | Sætter `archived_at`. Planer og grupper der står på programmet beholder deres kopi; proveniensen vises som "Eget program (arkiveret)" |
| POST | `/apply` (eksisterende) | `{ programKey: "custom:<id>", ... }` | Ny resolver `resolveProgramForTeam(supabase, teamId, key)`: katalognøgle → som i dag; `custom:` → slå op i tabellen med `team_id = req.team.id AND archived_at IS NULL`, ellers 400 `invalid_program`. Kopien laves af den samme `days`, deep-copied |
| PUT | `/api/training/groups/:id/program` (eksisterende) | samme | Samme resolver |

Ejerskab håndhæves i route-koden (`.eq("team_id", req.team.id)` på hver læsning og
skrivning), ikke kun af RLS, fordi backend kører service-role.

Ren funktion i `backend/lib/trainingPrograms.js`: `isCustomProgramKey(key)`,
`customProgramKey(id)`, `programWeekDaysFromTemplate(days)` (deep copy, intensiteten
genafledes af sessionen, så en kopi altid er en gyldig række).

### 3.4 UI (R5 Program-fanen, bag `training_page_r5` OG `training_custom_programs`)

- Biblioteket: sektionen "Programmer" får en knap "+ New program" / "+ Nyt program"
  (sekundær knap; sidens ene guldknap forbliver "Save plan", TASTE). Egne programmer
  vises øverst i listen med en lille "Egen"-markering (tekst, ingen emoji), katalogets under.
- "Nyt program" åbner et `Modal` (eksisterende `ui/Modal.jsx`): navn + start fra
  (tom / et program / en rytters uge). Gem opretter og vælger programmet.
- Når et eget program er valgt uden rytter/gruppe, er gitteret redigerbart og gemmes
  med "Save plan" som `PATCH /custom/:id`. Katalogprogrammer forbliver skrivebeskyttede.
- Menu på et eget program: Omdøb, Arkivér (bekræftelse siger at tildelte planer beholder deres uge).
- Navnet er spillerens egen tekst: vises kun for holdet selv, samme navn på EN og DA.
- Telefonen følger den udgave ejeren vælger under #7456 (A/B-skifteren er åben); intet nyt mønster her.
- Nye tekster i `trainingR5`-navnerummet, EN primær, DA sekundær, TONE_OF_VOICE (jeg/I).

## 4. Del 2: løbsfelter for hele ugen

### 4.1 Hvad "ugen" er

Gitteret er en skabelon man..søn, ikke datoer. Designet viser den **rullende uge**:
hver ugedagskolonne betyder dens NÆSTE forekomst fra og med i dag (i dag + 6 dage).
Det er de eneste dage spilleren stadig kan ændre. (Alternativet står i §7 Q1.)

### 4.2 Beregning (I5: genbrug, ingen kopi af reglerne)

Ny fil `backend/lib/trainingWeekForecast.js` (ny fil, så `trainingWeekPlanForecast.js`
og dagens endpoint er urørte):

1. **Løbsdagsakse pr. dato for 7 datoer:** ét opslag i `race_stage_schedule`
   (`races!inner(season_id, league_division_id)`, divisionens løb, `scheduled_at` i
   vinduet [i dag 00:00, i dag + 7 døgn), København). Derefter den eksisterende
   `gameDaySpansByDivision` dato for dato med forrige datos maks som `priorMax`, så
   hullerne (rene træningsdage) fyldes præcis som sweepen gør. Dag 0 tages fra
   `resolveDayCloseStatus` som i dag, så dagens svar er identisk. En dato hvor aksen ikke
   giver 5 løbsdage, får `available: false` for den dato (ingen gæt), ligesom `no_full_date` i dag.
2. **Bindinger og etaper:** ét opslag i `race_entry_days` for rosteren over ugens
   løbsdage (via `fetchAllRows`/`selectInChunks`, da roster x 35 kan nærme sig 1000-loftet),
   derefter `forecastBindingsFromEntryDays` (eksisterende, inkl. udgang af løb #5949).
   Profiler og etapeplan i ét opslag hver for de bundne løb.
3. **Felt pr. dato:** samme `forecastSlotActivity` og `programSlotForRaceDay`: et felt er
   `race` når rytteren er udtaget til en etape på løbsdagen, `rest` når han er bundet uden
   etape (GT-hviledag) eller skadet, ellers planens pas. Uden binding er feltet træning
   (et løb rytteren ikke er udtaget til, er ikke hans løb).
4. Svaret pr. rytter pr. dato: `raceSlots` (og for dag 0 også `ranSlots` som i dag).
   Ingen tal ud over dem.

### 4.3 UI

`weekCells` får `raceByWeekday: Record<weekday, ReadonlySet<number>>` i stedet for kun
`raceToday`; låst (`ran`) forbliver kun i dag. Løbsfelt = gråt felt + flag, ingen skravering
(ejer 20/11). Kolonnehovedet viser "N løb" for hver dag med løb. Gruppens felt er kun
løb når ALLE dens ryttere har løb dér (regel A, uændret).

## 5. Del 3: træthed i aften pr. dag

### 5.1 Målt baseline i dag (read-only, Railway HTTP-metrik, prod, 7 dage til 21/11)

`GET /api/training/programs/forecast`, 15 spande à 12 timer:

| | Laveste spand | Højeste spand |
|---|---|---|
| p50 | ca. 0,67 s | ca. 1,13 s |
| p95 | ca. 1,21 s | ca. 2,26 s |
| p99 | ca. 1,65 s | ca. 2,59 s |

Ingen 5xx på 7 dage; en stor del af kaldene svarer 304 (uændret). Konklusion: ét døgns
prognose koster allerede omkring 1 s ved p50. **7 kald efter hinanden (eller 7x samme
I/O) er udelukket** (ca. 5-8 s ved p50).

### 5.2 Beregning

- Al I/O hentes ÉN gang for ugen: tilstand, evner, planer, ugeplaner, regler, kontakter,
  lægebonus (alt det der hentes i dag, plus §4.2's tre opslag). Resten er ren CPU.
- Ren kerne `buildWeekFatigueForecast(...)`: for dato d = 0..6
  - åbning(d) = for d = 0: præcis som i dag (`opening_conditions`/straks-tilstand);
    for d > 0: `{ fatigue, form }` fra `settleTrainingDateCondition` for dato d-1 (kædet).
  - Felterne regnes med `buildTeamFatigueForecast`'s egen løkke (træk den ud som
    `forecastRiderDate(...)` og kald den fra begge, så dag 0 og ugen ikke kan glide fra
    hinanden; I5). Træthedsreglen (#4854) vurderes med åbningen for dato d, og
    "kørte etape i går" = planlagt etape på dato d-1 i samme beregning.
  - Skaderullet (`injury`) fra opgørelsen bruges IKKE fremad (vi forudsiger ikke skader);
    kun `fatigue` og `form` kædes.
  - Etapens belastning er det samme "ca."-estimat som i dag (profil, indsats normal).
- Svar: `{ available, days: [{ date, weekday, available, riders: { <id>: { fatigue, band, raceSlots } } }] }`.
  Dag 0 skal være bit-identisk med dagens endpoint (golden-test). Er dag 0 allerede gjort
  op, er dag 0 den faktiske træthed (`settled: true`) og kæden starter derfra.

### 5.3 Endpoint og ydelse

- Nyt `GET /api/training/programs/forecast/week` (samme route-fil, `readLimiter`), så
  dagens `/forecast` er urørt. Kontakt off → `{ available: false, reason: "disabled", days: [] }`.
- Frontenden henter dagens prognose som i dag og ugen bagefter (ikke-blokerende): i dag
  vises straks, de andre dage fylder ind.
- **Ydelsesmål (målt før første PR med kode, AGENTS 36):** ugens p95 højst 1,5x dagens
  p95 på samme hold. Måles med en harness mod en kopi/preview, aldrig mod prod med skriv.
  Holder målet ikke, er planen B: regn ugen ved tidsplanlagt opgørelse og cache pr. hold/dato
  (kun hvis målingen viser behov; ny løbende udgift = nej uden ejer).

### 5.4 UI

Prognoserækken i gitteret får et tal pr. kolonne: "ca. X" + farvebånd (eksisterende
`FatigueForecast`-komponent, tabular figures). Dag 0 som i dag; dage frem altid med "ca.".
Datoer uden fuld akse viser "–" med tooltip ("ingen løbsdage endnu").

## 6. Kontakter (begge OFF ved merge)

| Kontakt | Dækker | Off betyder |
|---|---|---|
| `training_custom_programs` (off/beta/on) | Del 1: tabel i brug, routes, "+ Nyt program" | Routes 404, `GET /programs` bit-identisk med i dag, UI skjult |
| `training_week_forecast` (off/beta/on) | Del 2 + 3: uge-endpoint og ugens felter/tal | Endpoint svarer `available:false`, gitteret som i dag |

Begge registreres i `stageFlagCatalog.js`. Flip er ejer-only. Del 1 rører ikke motoren;
del 2/3 er kun visning, men regner med motorens funktioner, så **Fable-dom før merge**
(issue-kravet) gælder PR 3.

## 7. Åbne spørgsmål til ejeren (A/B, anbefaling først)

**Q1. Hvilken uge viser gitteret løb og træthed for?**
- **A (anbefalet): rullende uge.** Hver ugedag = dens næste forekomst fra i dag. Det er
  dagene du kan nå at ændre.
- B: kalenderugen man..søn; dage der er gået, viser hvad der skete.

**Q2. Hvad starter "+ Nyt program" fra?**
- **A (anbefalet): et valg i dialogen:** tomt (alle dage hvile), et eksisterende program,
  eller en rytters nuværende uge ("Gem som program").
- B: altid en kopi af det program der er valgt i biblioteket.

**Q3. Træthed for dagene frem: tal eller kun farve?**
- **A (anbefalet): "ca. X" + farve alle 7 dage**, samme form som i dag.
- B: tal for i dag og i morgen, kun farvebånd længere ude (usikkerheden vokser med løb hvis belastning er et estimat).

**Q4. Skal der være et loft på antal egne programmer pr. hold?**
- **A (anbefalet): kun et teknisk værn** (et højt tal der kun stopper misbrug, aldrig en almindelig spiller); tallet sættes i PR'en og vises dig før merge.
- B: intet loft.

(Kopi-princippet, ejer-valg 1, er låst og står derfor ikke som spørgsmål.)

## 8. Testplan

Backend (`node --test`, fake Supabase som `trainingPrograms.routes.test.js`):
- Kontakt off: alle nye routes 404 / `available:false`; `GET /programs` og `GET /forecast` dybt lig med i dag (golden).
- CRUD: opret (3 kilder), navn 1..40, dubletnavn, ugyldig `days`, v3-session uden v3-kontakt, andet holds program (403/404), arkiv skjuler fra listen men bryder ikke tildelte planer.
- `POST /apply` og gruppe-put med `custom:<id>`: kopi (ingen delt reference), `program_key` = `custom:<id>`, arkiveret program afvises.
- Rettelse af et eget program ændrer ingen tildelt plan (regressionstest for #2438).
- `trainingWeekForecast`: dag 0 === `buildTeamFatigueForecast` (golden mod `trainingWeekPlanForecastGolden7801.test.js`-fixtures); kæde over 7 dage; GT-hviledag = hvile; udgang af løb (#5949); træthedsregel med "etape i går" på tværs af datoer; dato uden fuld akse = `available:false` for den dato; ingen skaderul fremad; pagination over 1000 rækker.
- Akse: `gameDaySpansByDivision` kædet over 7 datoer giver samme løbsdage som sweepen ville give dato for dato (fixture med huller og sæsonens sidste dato).
- Migration: kør to gange (idempotent), RLS-politikker findes, advisors uden ny WARN.

Frontend:
- `programR5Model.test.ts`: `weekCells` med løb på flere ugedage; gruppens regel A pr. dag; låst kun i dag.
- Bibliotek med egne programmer øverst; modal-validering.
- Playwright-snapshot (alle 3 projekter) af gitteret med løb og tal flere dage; preview-mock `trainingProgramsMock.js` udvides, så ejeren kan se det på preview før merge (UI-PR = billede + ejer-go).

Ydelse: harness der måler uge-endpointet mod dagens på samme datasæt (p50/p95), resultat i PR 3.

## 9. Fix-plan: byggerækkefølge

| PR | Indhold | Filer | Risiko |
|---|---|---|---|
| 1 | Migration + `training_custom_programs`-kontakt + routes + resolver i apply/gruppe-put | `database/2026-11-2x-8550-training-custom-programs.sql`, `backend/routes/trainingCustomPrograms.js` (ny), `backend/routes/trainingPrograms.js`, `backend/routes/trainingGroups.js`, `backend/lib/trainingPrograms.js`, `backend/lib/stageFlagCatalog.js`, tests | Lav: additiv, off, motoren urørt |
| 2 | UI "+ Nyt program", redigering af eget program, arkiv | `ProgramR5.tsx`, `programR5Model.ts`, `frontend/src/lib/trainingPrograms.ts`, `useTrainingPrograms.ts`, i18n `trainingR5` (en+da), preview-mock | Lav-middel: UI, kræver billede + ejer-go |
| 3 | `trainingWeekForecast.js` + `GET /forecast/week` + `training_week_forecast`-kontakt; uddrag `forecastRiderDate` fra `buildTeamFatigueForecast` | `backend/lib/trainingWeekForecast.js` (ny), `backend/lib/trainingWeekPlanForecast.js` (kun uddrag, golden-test beviser uændret), `backend/routes/trainingPrograms.js`, tests, ydelses-harness | Middel: regner med motorens funktioner; Fable-dom før merge; målt baseline (§5.1) + mål (§5.3) |
| 4 | Gitteret: løb og "ca. X" pr. dag | `programR5Model.ts` (`raceByWeekday`), `ProgramR5.tsx`, `FatigueForecastModel.ts`, ny hook til uge-prognosen, snapshots | Lav: kun visning, bag kontakt |

Patch notes + `help.json` (en+da) skrives ved tænding, ikke ved merge bag slukket kontakt.

## 10. Dom

bekraeftet + fix-plan


## Tilføjet 22/11 efter Codex-review: SSOT og dommer-scenarier (AGENTS regel 30 og 40)

**SSOT.** Designet er afstemt mod [`docs/TRAINING_RULES.md`](../TRAINING_RULES.md) §3 (dagstyper og sessioner), §4 (ugerytme og hvilket lag der vinder), §5 (restitution, træthedsgrænse og skader), §6 (træning og løbsdage), §13 (træning pr. løbsdag, fem felter pr. dato) og [`docs/CALENDAR_RULES.md`](../CALENDAR_RULES.md) §0 (de to akser: dato og løbsdag), §2b (rytterbinding) og §4 (etapeløb og endagsløb). Hvor designet og reglerne er uenige, vinder reglerne, og afvigelsen er et ejer-spørgsmål før byg.

**Dommer-scenarier før kode (AGENTS 40).** Den uafhængige Fable-dommer skriver de forventede scenarier ud fra reglerne ovenfor, før første kode-PR merges, i `docs/audits/7456-program-dommer-scenarier.md` (fælles for #8548, #8549 og #8550). Samme dommer gennemgår hver motor- og data-PR mod scenarierne før merge. PR 1 for #8548 og #8549 blev startet 22/11 nat før scenarierne. De merges ikke, før scenarierne og dommerens gennemgang foreligger.
