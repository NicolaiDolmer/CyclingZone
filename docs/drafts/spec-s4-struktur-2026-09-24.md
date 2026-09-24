# Spec: S4-struktur (D4 → D3, D4 8 → 4 puljer, comeback efter Global Rank)

> Cloud-session 24/9. Byggeklar spec, ingen kode. Refs #4592. Mål: LIVE ved S4-start 28/9, bygget før "Afslut sæson" 27/9.
> Linjenumre er fra `main` @ `03f3da9` (24/9 kl. ca. 10).

## Formål (én linje)

Ved skiftet S3→S4 samles alle tilbageværende managers fra D3+D4 i D3 (snake efter point), D4 bliver 4 AI-puljer med løb fra dag ét, og et parkeret hold der melder sig tilbage placeres efter Global Rank på en AI-plads.

## Ejer-beslutninger (citeret)

- **24/9 kl. ca. 10:20** ([#4592-kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/4592#issuecomment-5810361017), erstatter 10:10-kommentaren om "D4 står tom"):
  > "(1) Ved skiftet S3→S4 rykker alle nuværende D4-managers op i D3, fordelt efter point (snake, som komprimeringen S1→S2); D3 får ca. 17 managers pr. pulje. (2) **D4 går fra 8 til 4 puljer**, fyldes med AI-hold fra start og har løb fra dag ét; her lander nye managers og comebacks med lav rang. (3) **Comeback efter Global Rank:** 1-24 → D1, 25-72 → D2, 73-168 → D3, resten → D4; holdet overtager en AI-plads (ingen plads → næste division ned); forholdsmæssig sponsor for resten af sæsonen og ingen bestyrelsesdom for comeback-sæsonen. **Konsekvens:** S4-kalenderen laves om med 4 D4-puljer (D4 ca. 296 → 148 løb, i alt ca. 530 → 382, stadig 140 løbsdage pr. division) og køres EFTER at strukturen er bygget. Alt bygges før 'Afslut sæson' 27/9. Kræver ændring af den stående regel 'pyramide 1/2/4/8' → 1/2/4/4 (ejer 24/9)."
- **24/9 kl. ca. 10:10** ([kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/4592#issuecomment-5810189834)): "Normal op/nedrykning, derefter flyttes ALLE D4-managers op i D3 [...] **Rækkefølge:** S4-kalenderen genereres/køres EFTER sammenlægningen (§2c: S4 må laves om, indtil sæsonen er aktiv)".
- **23/9** ([kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/4592#issuecomment-5794151474)): "parkeringen flyttes ind mellem op/nedrykning og reseed/AI-fyld, så AI lukker pladserne."
- **23/9 kl. 20** ([kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/4592#issuecomment-5800362956)): parkeret hold = "A med løn": ingen sponsorindtægt, ingen bestyrelsesdom/mål, men løn.
- **24/9 kl. ca. 09:10** ([kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/4592#issuecomment-5809392579)): "'hent tilbage ved tilmelding' skal bygges FØR 27/9".

## Prod-tal (read-only SELECT, 24/9 ca. kl. 10:30)

| Tier | Puljer | Menneskehold (ikke parkeret/frosset) | Heraf login ≤ 30 d | Heraf sovende > 30 d | AI-hold |
|---|---|---|---|---|---|
| D1 | 1 | 24 | 18 | 6 | 0 |
| D2 | 2 | 48 | 29 | 19 | 0 |
| D3 | 4 | 94 | 18 | 76 | 0 |
| D4 | 8 | 91 | 49 | 42 | 101 (12-13 pr. pulje) |

S3-løb pr. tier: D1 37, D2 92, D3 160, D4 240 (8 puljer). **S4 har 0 løb i dag** (kalenderen er ikke genereret).
Bemærk: "sovende" her er den rå 30-dages-regel; parkeringens egne filtre (abonnement, tilmelding) kan give et par færre. Efter parkering: D3 18 + D4 49 = **67 managers → ca. 17 pr. D3-pulje, 29 AI-pladser i D3.**

## Rækkefølgen ved skiftet (27/9 → 28/9)

1. **"Afslut sæson"** (`POST /admin/seasons/:id/end`, `backend/routes/api.js:11595` → `economyEngine.processSeasonEnd` `backend/lib/economyEngine.js:1461`). `season_end_skip_division_movement` skal være **OFF** (normal op/nedrykning, flaget læses `economyEngine.js:1516-1518`). Rækkefølge i dag: bestyrelse (:1499-1506) → divisionsbonus (:1509) → op/nedrykning D1..D4 (:1584-1595) → **parkering** (`runParkingIfEnabled` :1598) → reseed (:1605-1611) → AI-reconcile alle puljer (:1618-1622) → sæson `completed` (:1626-1629).
2. **NYT: sammenlægning D4 → D3** (script, spor A1): alle ikke-parkerede menneskehold i D3+D4 fordeles snake efter S3-point på D3 A-D.
3. **NYT: D4-puljerne E-H pensioneres** (spor A2): AI fra E-H flyttes til D4 A-D op til 24 pr. pulje; overskud pensioneres.
4. **AI-reconcile** alle puljer (D3 fyldes op til 24, D4 A-D til 24).
5. **S4-kalender** genereres og køres (spor A3) med 4 D4-puljer. S4 skal stadig være `upcoming` (`buildSeasonCalendar.js:38-60, 381-393`).
6. **"Start næste sæson"** (`seasonTransition.transitionToNextSeason`, `backend/lib/seasonTransition.js:1012`). Dens auto-kalender-fase (gate :1403-1406, fase :1428-1496) må ikke generere igen. `auto_calendar_enabled` findes ikke som række i `app_config` i prod (SELECT 24/9), og gaten er "fail-safe OFF" (:1403-1404), så fasen kører ikke i dag. Rækken må ikke oprettes før efter 28/9.

**Flag i prod (SELECT 24/9):** `season_end_skip_division_movement` = off (godt: normal op/nedrykning), `season_signup_enabled` = on, `ai_team_retire_enabled` = on, `ai_pool_retirement_v2_enabled` = on.

Trin 2-5 kører **mellem** processSeasonEnd og transitionen, præcis som komprimeringen S2→S3 gjorde (`backend/scripts/compressPyramidS3.js`, kræver `completed`, :149-161). Det holder os ude af `economyEngine.js` og `seasonTransition*.js`, som en lokal bølge arbejder i nu.

## Kodeændringer pr. spor (fil:linje)

### Spor A1: sammenlægnings-scriptet (nye filer, ingen overlap)

- **Ny** `backend/lib/d4MergeS4.js` (ren, ingen I/O):
  - `planD4Merge({ teams, standings, countback, d3Pools })` → `{ assignments: [{teamId, fromPoolId, toPoolId, rank}], byPool }`.
  - Genbrug `rankTeamsGlobally` (`backend/lib/pyramidCompression.js:105-140`, sorterer på `season_standings.total_points` + countback) og `snakeAssign` (:212-221). **Ikke** `distributeCompression` (:261-311): den fylder altid D2 med 48 og D3 med 96 fra toppen og kan ikke nøjes med at flytte D4 op.
  - Input-filter: `!is_ai && !is_bank && !is_frozen && !is_test_account && parked_at == null` og `league_division_id` i tier 3 eller 4. **`parked_at`-filteret er nyt**: begge eksisterende scripts mangler det (`compressPyramid.js:109`, `compressPyramidS3.js:287`) og ville hente parkerede hold tilbage.
  - Afvis hvis managers > 96 (4 × `POOL_TARGET_SIZE`, `backend/lib/economyConstants.js:139`). Med 67 er der god margin.
- **Ny** `backend/scripts/mergeD4IntoD3S4.js`, samme form som `compressPyramidS3.js`:
  - dry-run default: skriver frossen liste til `docs/snapshots/4592/` (JSON + MD til ejeren).
  - `--apply --snapshot=<json> --owner-go`: læser kun den frosne liste, kræver sæson `completed`, skriver snapshot + restore-SQL (som `compressPyramid.js:281-292`), opdaterer `teams.division=3, league_division_id`, sender notifikation via `notifyTeamOwner` (som `compressPyramid.js:311-334`), kører `reconcileAiTeamsForPool` for alle puljer og en verifikationsrunde.
  - Idempotent: et hold der allerede står i sin mål-pulje springes over.
- Tests: `backend/lib/d4MergeS4.test.js` (snake-balance, parkeret/frosset/test udelukket, > 96 afvises, determinisme ved pointlighed).

### Spor A2: D4 fra 8 til 4 puljer (pulje-form, AI-fyld, nye hold)

Rækkerne E-H i `league_divisions` kan **ikke** slettes: `teams`, `season_standings` og `races` peger på dem med FK (`database/2026-06-21-league-divisions-pyramid.sql:62, 71`; `database/2026-06-22-races-league-division.sql:20`), også historisk. Derfor:

- **Ny migration** `database/2026-09-25-4592-d4-retire-pools.sql` (kun fil; apply post-merge via auto-migrate, ejer-gated):
  - `alter table league_divisions add column retired_at timestamptz null;`
  - `update league_divisions set retired_at = now() where squad = 'senior' and tier = 4 and pool_index >= 4;` (bag et eksplicit ejer-go, se risici).
  - `plan_ai_pool_retirements` (`database/2026-09-09-4753-ai-pool-retirement.sql:44-80`): mål = 0 for `retired_at is not null`; mål = 24 − menneskehold for tier 4 med `retired_at is null`, også uden ægte managers (i dag 0, :52-54).
- `backend/lib/aiTeamGenerator.js:77-83` `targetAiCountForPool`: tag puljens `retired_at` ind. Pensioneret → 0. Tier 4 aktiv → altid fyld (som tier 1-2 i dag, :78-79). Tier 3 uændret (fyld kun med mindst én ægte manager).
- `backend/lib/teamProfileEngine.js:181-290` (`pickDivisionForNewTeam` / `choosePoolForNewTeam`): udelad pensionerede puljer. Nye managers: D3 hvis en D3-pulje har plads (occupancy < 24, #4183-reglen :250-269), ellers D4 A-D (:269-279).
- `backend/lib/pyramidCompression.js:283`: `distributeCompression` bruger allerede `d4PoolCount`; ingen ændring, men nævn i `docs/GAME_INVARIANTS.md:67`.
- **AI fra E-H flyttes, i stedet for at pensionere og nyoprette**: i dag 101 AI i D4. D4 A-D skal have 4 × 24 = 96 minus eventuelle menneskehold (0 efter A1). Flyt AI-hold fra E-H til A-D (`update teams set league_division_id`), pensionér overskuddet med `retire_ai_pool_team` (`2026-09-09-4753-ai-pool-retirement.sql:259-295`). Kræver `ai_team_retire_enabled` + `ai_pool_retirement_v2_enabled` (:10-14). Bygges som et trin i A1-scriptet eller som eget `backend/scripts/retireD4PoolsS4.js` (anbefalet: eget script i A2, så A1 og A2 ikke deler fil).
- `backend/scripts/audit-league-size-invariant.js:199-204` + `docs/GAME_INVARIANTS.md:70-92`: dormant-reglen "tier 3/4 uden ægte managers = 0 AI, ingen kalender" gælder ikke længere for D4 A-D; pensionerede puljer forventes tomme.
- Test-fixtures der hardkoder 8 D4-puljer (listen fra research, opdateres kun hvor testen handler om S4-formen): `backend/lib/aiTeamGenerator.test.js:148-157`, `teamProfileEngine.test.js:50-60`, `pyramidCompression.test.js:245-263`.

### Spor A3: S4-kalenderen med 4 D4-puljer

- `backend/lib/divisionCalendarGenerator.js:17-20` `poolHasCalendar(tier, realManagerCount)`: tier 4 aktiv pulje → `true` uden ægte managers; pensioneret → `false`.
- `backend/lib/tierCalendarMaterializer.js:532-567` (`materializeTierCalendars`): læs `retired_at`, spring pensionerede puljer over (pulje-læsning :570-587). Alternativt `forceTiers: [4]` fra `buildSeasonCalendar` (i dag sendes den ikke).
- `backend/scripts/buildSeasonCalendar.js` (CLI :308-326): ingen ny flag nødvendig, hvis materializeren selv respekterer `retired_at`.
- `backend/lib/__fixtures__/racePoolCatalog.prod.json:4-92` (offline-golden-kilden, `scripts/dev/lib/s3OfflineCalendarPlan.mjs:31, 53-66`): D4 til 4 puljer; kør `scripts/dev/refreshCalendarGoldenSnapshot.mjs` og vis `calendarGoldenDiff.mjs` for ejeren (NOW: "`calendarGoldenDiff.mjs` FØR S4-generering").
- `docs/SEASON_CUTOVER_RUNBOOK.md:229, 253-282, 493-525`: i dag bygges S4-kalenderen FØR cutover. Flyttes til trin 5 ovenfor.
- `docs/CALENDAR_RULES.md:106` ("D4 (8 puljer)") → 4.
- Forventet: 140 løbsdage pr. division uændret (`SEASON_RACE_DAY_TARGET[4]`, `backend/lib/calendarRaceDayTargets.js:70`). Løbstallet for D4 halveres. Ejerens tal "D4 ca. 296 → 148" er ikke eftervist her; dry-run viser det rigtige tal.

### Spor A4: comeback efter Global Rank (hent tilbage ved tilmelding)

I dag gør `POST /api/season/signup` (`api.js:13346-13372`) KUN `teams.next_season_signup_at = now`; holdet hentes først tilbage ved næste sæsonslut (`managerParking.runParkingSweep` :405-446 → `unparkTeam` :271-298 → `pickDivisionForNewTeam`). Ejeren vil have det **straks** med pro rata sponsor.

`api.js` og `managerParking*.js` er låst af den lokale bølge. Derfor nye filer:

- **Ny** `backend/lib/comebackPlacement.js` (ren):
  - `tierForGlobalRank(rank)`: 1-24 → 1, 25-72 → 2, 73-168 → 3, ellers 4 (grænserne = kumuleret pladsantal 24 / 24+48 / 72+96, samme tal som `compressPyramidS3.js` header :48-52).
  - `pickComebackPool({ tier, pools, teams })`: pulje i tieren med mindst ét AI-hold (en "AI-plads") og ikke pensioneret; flest AI først, så laveste `pool_index`. Ingen → tier + 1 … til D4. D4 har altid AI (A2).
  - **Global Rank NULL**: `global_rank_mv.global_rank` er NULL når holdet ikke har stilling i de seneste 2 sæsoner (`database/2026-08-03-2792-3193-global-rank-humans-only.sql:122-125`). Arkitekt-valg (kan udfordres): rangér på `global_points` blandt alle menneskehold; ingen point → D4.
- **Ny** `backend/lib/comebackService.js` `returnParkedTeam({ supabase, teamId, now })`:
  1. Kræver `teams.parked_at is not null` og aktiv sæson.
  2. Rang → pulje (ovenfor). Sæt `league_division_id`, `division`, `parked_at = null`, `next_season_signup_at = null`, `comeback_season_id = <aktiv sæson>`.
  3. AI-pladsen: den eksisterende trigger `trg_ai_pool_placement_reserve` (`2026-09-09-4753-ai-pool-retirement.sql:152-154`) reserverer AI-overskud, og `retire_ai_pool_team` pensionerer det, når AI-holdet ikke har løb i gang (:16-40). Indtil da står puljen med 25.
  4. Pro rata sponsor: `proRataShare` / `proRataAmount` (`backend/lib/midSeasonSponsor.js:46-63`) på `guaranteedBase`, ny idempotens-nøgle `comeback_sponsor:<season>:<team>`. `ensureMidSeasonSponsor` (:78-178) kan ikke bruges direkte: den springer over hvis holdet har en aktiv kontrakt (:101-102), og det har et parkeret hold typisk.
  5. `reconcilePoolCalendarOnActivation` (`tierCalendarMaterializer.js:865`) for mål-puljen, som ved en ny manager (`teamProfileEngine.js:715`).
- **Ny** route-fil `backend/routes/comeback.js` (`POST /api/season/comeback`, `requireAuth`, flag `season_signup_enabled`), monteret i `backend/server.js:74` FØR `apiRoutes`. Ingen ændring i `api.js`.
- **Ny migration** `database/2026-09-25-4592-team-comeback-season.sql`: `teams.comeback_season_id uuid null references seasons(id)`.
- Frontend: `SeasonSignupCard.jsx` (+ `DashboardPage.jsx:399, 995` kun hvis nødvendigt): for `parked: true` kalder knappen `/api/season/comeback` og viser den nye division. Tekst EN først, DA under, i `dashboard.json` (ikke låst). Nye filer som `.ts/.tsx`.

### Spor A5: ingen bestyrelsesdom i comeback-sæsonen (EFTER bølgen, ikke 28/9-kritisk)

Bestyrelsesdommen falder ved S4-slut, ikke 28/9. Derfor kan denne del vente, til den lokale bølge slipper `economyEngine.js`:

- `economyEngine.js:154-170` `loadHumanSeasonEndTeams` / `processTeamSeasonEnd` :1823: spring over hvis `comeback_season_id = sæsonen` (samme sted som parkerede hold i C0b "A med løn").
- In-season: `boardWeekendUpdate.js:215-216`, `boardWeekendFinalization.js:247-249`, `boardMidSeason.js:81-83`: samme filter. Disse filer er ikke låst og kan bygges i A4-sporet, hvis A4 har tid.
- `economyEngine.js:2492-2522` `buildPoolTree` udleder forælder/barn-forhold af rækketallet pr. tier. Med E-H pensioneret SKAL den filtrere `retired_at`, ellers rykker D3-C/D ned i E/F/G/H ved S4-slut. **Skal ligge før "Afslut sæson" S4**, ikke før 28/9.

## Tests

| Spor | Test |
|---|---|
| A1 | `d4MergeS4.test.js`: snake-fordeling (A,B,C,D,D,C,B,A…), parkerede/frosne/test udelukket, afvisning > 96, deterministisk rækkefølge. Script: dry-run mod `createTestDb` med 4+8 puljer. |
| A2 | `aiTeamGenerator.test.js`: pensioneret → 0; D4 aktiv uden managers → 24. `teamProfileEngine.test.js`: ny manager lander aldrig i en pensioneret pulje. Migration-test: `plan_ai_pool_retirements` giver 0 for pensioneret og fyld for D4 A-D (testdb). |
| A3 | `divisionCalendarGenerator.test.js` + materializer-test: 4 D4-puljer får kalender, E-H ingen. Golden-diff mod den opdaterede fixture. |
| A4 | `comebackPlacement.test.js`: rang 1/24/25/72/73/168/169/NULL; fuld tier → næste ned. `comebackService.test.js`: parked → pulje, pro rata beløb, idempotens (to kald = én betaling). Route-test: 401 uden login, 409 hvis ikke parkeret, flag off → 404. e2e: kortet på mobil 390 + desktop 1440 med mocks. |
| A5 | `economyEngine.test.js`: comeback-hold får ingen bestyrelsesdom; `buildPoolTree` med pensionerede puljer. |

## Risici

1. **Rækkefølgen er alt.** Kører kalenderen (A3) før A1/A2, får tomme puljer løb, eller E-H får løb. Runbook-trinnene 1-6 skal stå i `SEASON_CUTOVER_RUNBOOK.md`, og hvert script afviser at køre i forkert tilstand (A1 kræver `completed`; A3 kræver at E-H er pensioneret).
2. **Transitionens auto-kalender** (`seasonTransition.js:1428-1496`) kunne generere oven i en allerede bygget S4, hvis `auto_calendar_enabled` blev slået til. Den er ikke sat i prod i dag (fail-safe OFF); hold den sådan til efter 28/9.
3. **Frontend viser tomme E-H-puljer** i S4, fordi pulje-vælgerne læser alle `league_divisions` (`StandingsPage.jsx:137`, `RiderRankingsPage.jsx:145`, `ResultaterPage.jsx:191`, `RaceCentrePage.jsx:141`). Filtrér `retired_at is null` for den aktive sæson, men vis historiske sæsoner uændret. **De samme 4 sider rører ungdoms-spec'ens S2-frontend** (se `spec-ungdomslob-2026-09-24.md`); én ejer af de filer.
4. **25 hold i en pulje midt i sæsonen** (comeback før AI-holdets løb er afsluttet). `POOL_TARGET_SIZE` er også felt-loftet. Ingen evidens for om `raceEntryGenerator.js` udelukker et reserveret AI-hold; skal verificeres i A4.
5. **Global Rank er kun korrekt mens sæsonen er `active`** (`compressPyramidS3.js:27-47`). Comeback sker midt i sæsonen, så det er fint; men A1 skal fryse sin liste før cutover.
6. **Den stående regel "pyramide 1/2/4/8"** står i `docs/NOW.md` (Standing context) og `GAME_INVARIANTS.md`. NOW.md er låst for cloud-sessionen; orkestratoren retter den til 1/2/4/4.
7. **Pensionering af E-H er irreversibel i praksis** (AI-hold pensioneres). A2's migration sætter `retired_at` bag ejer-go, og scriptet har dry-run + snapshot.

## Spor-opdeling (parallelt, uden fil-overlap)

| Spor | Filer (eneste ejer) | Afhænger af | Låste filer det venter på |
|---|---|---|---|
| **A1** sammenlægning | `backend/lib/d4MergeS4.js` (+test), `backend/scripts/mergeD4IntoD3S4.js` | intet | ingen |
| **A2** pulje-form + AI | migration `…-d4-retire-pools.sql`, `aiTeamGenerator.js`, `teamProfileEngine.js` (tager også ungdoms-spec'ens S2-linje :182-185), `backend/scripts/retireD4PoolsS4.js`, `audit-league-size-invariant.js`, `docs/GAME_INVARIANTS.md` (+ deres tests) | intet (migrationens kolonne bruges af A3/A4, men kan stubbes i test) | ingen |
| **A3** kalender (= ungdoms-spec'ens Y5, ét kalender-spor) | `divisionCalendarGenerator.js`, `tierCalendarMaterializer.js`, `buildSeasonCalendar.js` (hvis nødvendigt), `racePoolCatalog.prod.json` + golden, `docs/SEASON_CUTOVER_RUNBOOK.md`, `docs/CALENDAR_RULES.md` | A2's migration i prod før kørsel | ingen |
| **A4** comeback | `comebackPlacement.js`, `comebackService.js`, `backend/routes/comeback.js`, `backend/server.js`, migration `…-team-comeback-season.sql`, `SeasonSignupCard.jsx`, `dashboard.json` (en+da), `boardWeekend*.js`/`boardMidSeason.js` hvis tid | A2 (D4 har altid AI) | ingen |
| **A5** bestyrelse + buildPoolTree | `economyEngine.js` | A2 | **`economyEngine.js`** (lokal bølge). Skal ligge før S4-slut, ikke 28/9. |

Frontend-pulje-filteret (risiko 3) lægges i ungdoms-spec'ens Y2-spor, så siderne kun har én ejer. Kalender-sporet ejer `tierCalendarMaterializer.js` + `buildSeasonCalendar.js` for både 4 D4-puljer og ungdomskalenderen.
