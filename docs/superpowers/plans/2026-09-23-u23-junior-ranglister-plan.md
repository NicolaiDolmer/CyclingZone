# U23- og junior-standings, -ranglister og op/nedrykning: byggeplan (23/9 2026)

> **Status:** plan fra en read-only planlægger 23/9. Der er ikke bygget noget, og intet er skrevet til prod.
> **Ejerens ønske 22/9:** "U23 hold, junior hold, junior ranglister, U23 rangliste".
> **Roadbook (`docs/drafts/roadbook-plan-2026-09-15.md`):**
> - Før S4: *"U23 races and junior races, on their own calendars and their own leagues"*
> - Under S4: *"Promotion, relegation and rankings for U23 and junior, counted at the end of the season"* og *"Prize money in youth races, once I have seen the numbers"*
>
> **Bygger på:** spec `docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md` (§2, §3.2, §3.3, §6, §7, §8, §10), `docs/YOUTH_RULES.md` §2.3, §6 og PR #5525 (A2, åben).
> **Mærkning:** **[V]** er verificeret i kode på `main`, i PR-diffen eller i prod (SELECT, projekt ghwvkxzhsbbltzfnuhhz, 23/9). **[A]** er en antagelse eller et skøn.

---

## 0. Kort fortalt

1. **Fælden:** den vigtigste opdagelse er ikke UI. Senior-stillingen og alle fire rangliste-matviews summerer i dag `race_results` for hele sæsonen uden at kende trup [V]. Det første ungdomsløb der bliver afgjort, lægger derfor U23-point ind i:
   - seniorstillingen
   - op- og nedrykningen
   - divisionsbonus, bestyrelse og sponsorbase
   - Global Rank
   - senior-rytterranglisten

   Det skal lukkes FØR første ungdomsresultat (spor S1). Ejeren skal ikke tage nogen beslutning for at det kan lukkes.
2. **Arkitekt-valg:** ungdomsstillingerne gemmes i en egen tabel `youth_season_standings` og IKKE som `season_standings.squad` (spec §6.2). Den nuværende unik-nøgle `(season_id, team_id)` antager én række pr. hold. Det gør 28 backend-filer, 19 frontend-filer, `global_rank_mv` og et view også. Begrundelse i §2.0.
3. **Ungdoms-rytterranglisten** bliver et eget matview, som spec §6.3 siger. De eksisterende senior-matviews får et trup-filter. Det giver samme resultat som i dag, fordi alle løb er senior.
4. **U23 og junior bygges med samme kode.** Trup er en parameter overalt. Junior tændes ved at seede junior-puljerne, når junior-kalenderen og junior-C1 er klar.
5. **Kan bygges før cutover uden nye ejer-valg:** S1, S2, S4, S5, S7, S8 og S9, plus S6's kode bag en slukket kontakt. **Venter på ejeren:** pyramideformen efter C1 (seed, S3), antal op/ned-pladser (før kontakten i S6 tændes, senest før S4 slutter) og præmier (efter S4-data).

---

## 1. Udgangspunkt

### 1.1 Prod 23/9 [V]

**Kolonnen `squad`:**
- Findes på `riders`, `race_pool` og `training_day_runs`.
- Findes IKKE på `league_divisions`, `races` eller `teams` (A2 er ikke merged).

**Andet:**
- `race_pool.squad` er fordelt senior 224, u23 36, junior 18. Katalogerne er leveret (PR #5262).
- Ungdomskataloget bruger løbsklasserne `Class1`, `Class2` og `ProSeries`. Alle tre findes i `race_points`, så `points_earned` beregnes for ungdomsløb uden ændringer.
- Trup-backfill (#4619) er ikke kørt: størstedelen af akademirytterne står stadig som `squad='senior'` med `is_academy=true` (runbook trin 7, "Delvis (RØD)").
- Pyramiden er 1/2/4/8 puljer. AI-hold findes i dag kun i tier 4, så tier 1-3 er rene menneskepuljer.
- Der findes ingen S4-række i `seasons` endnu. S3 er aktiv.

**`season_standings`:**
- Nøgler: `UNIQUE (season_id, team_id)`, FK til `league_divisions`, ingen `squad`.
- Afhængige objekter: matview `global_rank_mv` (unikt indeks på `team_id`) og view `ai_active_season_status`.
- SQL-funktioner der læser den: `recompute_season_standings`, `apply_global_rank_season_rollover`, `get_season_documentary_facts`.

**Matviews:** `rider_rankings_mv`, `team_standings_ext_mv`, `team_race_points_mv` og `global_rank_mv`. Ingen af dem har `squad`.

**SQL-funktioner der summerer `race_results` sammen med `races` uden trup:**
- `recompute_season_standings`
- `dashboard_rider_ranking`
- `dashboard_my_team_season_races`
- `get_season_recap`
- `get_season_documentary_facts`

`get_rider_race_days` og `apply_stage_result` joiner også, men er ikke rangliste-aggregater.

### 1.2 Hvad A2 (PR #5525, OPEN) giver [V]

**Migration `database/2026-09-24-5517-squad-leagues-races-teams.sql`:**
- `league_divisions.squad` med `UNIQUE (squad, tier, pool_index)`. Den gamle `(tier, pool_index)` droppes, og `CHECK (tier IN (1,2,3,4))` er urørt.
- `races.squad` med `idx_races_season_squad`.
- `teams.u23_league_division_id` og `teams.junior_league_division_id` som FK med `ON DELETE SET NULL` og kolonne-grant.
- Seeder bevidst INGEN ungdomspuljer.

**Kode:**
- `backend/lib/squads.js`: `withSeniorSquadScope`, `isSeniorSquadRow`, `onlySeniorSquadRows`. Har fallback ved fejlkode 42703.
- Forward-guard med en ratchet-liste over uscopede læsere af `league_divisions`, og en **seed-gate**: en auto-migration der seeder ungdomspuljer, fejler i CI så længe en læser på listen er markeret `blocksYouthSeed`.
- Blokerende læsere i backend: `economyEngine.js` (`buildPoolTree` nøgler på `tier:pool_index`), `betaResetService.js`, `teamProfileEngine.js`, `sponsorContractsService.js`.
- Blokerende læsere i frontend: `StandingsPage.jsx`, `RiderRankingsPage.jsx`, `ResultaterPage.jsx`, `DashboardPage.jsx`, `RaceCentrePage.jsx`.

**Hvad A2 IKKE dækker:**
- `season_standings`, standings-beregningen, motor, præmier og udtagelse. Det står i PR-bodyen: "de skal have en trup-dimension (spor B1-B4)".
- Guarden godkender kun `withSeniorSquadScope`. En ny ungdomslæser med `.eq("squad", trup)` bliver fanget som "NY uscopet læser" (`classifyReads` kender kun scope-wrap, skrivning og enkelt-række). Det skal guarden lære (S2).

### 1.3 Sådan virker senior i dag [V]

**Stillingen:**
- `economyEngine.updateStandings` kalder RPC'en `recompute_season_standings`: fuld genberegning, placering inden for puljen og tie-break på `team_id`.
- Den kaldes efter hvert løb (`raceRunner.js`) og ved sæsonslut (`routes/api.js` ca. linje 11588).
- Der findes en Node-fallback, som også læser `races` uden trup.

**Matviews:** genopfriskes af `refreshRankingMatviewsSafe` (en RPC pr. matview). De læses kun via `backend/routes/rankings.ts` med service_role (#5176 og #5088: ingen grants til anon/authenticated).

**Sæsonslut:**
- `processSeasonEnd` bygger `buildPoolTree` uden scope.
- Derefter kører `processDivisionEnd` for tier 1..4: top `PROMOTION_SLOTS=2` op og bund `RELEGATION_SLOTS=4` ned. AI flyttes aldrig. Der skrives til `teams.division` og `league_division_id`.
- Så kører reseed og `reconcileAiTeamsForPool` pr. pulje.

**Frontend:**
- `RankingsHubPage.jsx` (T2, 1600 px) har fanerne league, riders og global.
- `StandingsPage.jsx` læser `season_standings`, `league_divisions` og `races` direkte fra Supabase. `PROMOTE_N = 2` og `RELEGATE_N = 4` er hårdkodet (linje 413-414).
- `RiderRankingsPage.jsx` læser via `useRiderRankings` og `/api/rankings/riders`.

### 1.4 Senior-læsere der begynder at se ungdom, hvis intet gøres [V]

| Læser | Hvad der sker ved første ungdomsresultat |
|---|---|
| `recompute_season_standings` | U23-point tæller med i seniorstillingen og dermed i op/ned, `payDivisionBonuses`, bestyrelse, sponsorbase (#4376) og `global_rank_mv` |
| `rider_rankings_mv` | U23-ryttere dukker op i senior-rytterranglisten og i `/rankings/riders?top=5` |
| `team_standings_ext_mv` | Ungdomspodier og holdkonkurrence tæller i senior-standings |
| `team_race_points_mv` + `StandingsPage` races-læseren | Ungdomsløb kommer med i progressionsgrafen og løbslisten |
| `dashboard_*`, `get_season_recap`, `get_season_documentary_facts` | Dashboard, sæson-recap og krønike blander trupper |
| `sponsorRaceDayIncome.js:185` (alle afsluttede løb i sæsonen) | Ungdomsløb udbetaler sponsor pr. løbsdag. Det er en ny guldkilde og bryder C3 |
| `boardGoalContext.js`, `reputationReplay.js`, `achievementEngine.js` | Bestyrelsesmål og omdømme regnes på ungdomsresultater |

---

## 2. De tre leverancer

### 2.0 Arkitekt-valg (tekniske, ikke ejer-spørgsmål)

**V1. Hvor bor ungdomsstillingerne?**
- **A (anbefalet): egen tabel `youth_season_standings`.**
  - Fordel: seniorlæserne ændres ikke (28 backend- og 19 frontend-filer). Nøglen `(season_id, team_id)`, `global_rank_mv`, `ai_active_season_status` og `payDivisionBonuses` er urørte, så senior er upåvirket fra starten.
  - Pris: en tabel og en RPC mere, og spec §6.2 skal rettes.
- **B (spec §6.2): `season_standings.squad` med nøglen `(season_id, team_id, squad)`.**
  - Pris: hver af de ca. 47 læsere skal filtrere, og en glemt læser er en ny guldkilde. `global_rank_mv`'s `current_pts`-join giver to rækker pr. hold, så det unikke indeks på `team_id` vælter REFRESH og Global Rank fryser. `StandingsPage` (linje 185-187) overskriver holdets række med den sidste, altså rækken med færrest point.
- Fravalgt: B. Spec §6.2 er et planlægger-design, ikke en ejer-låst beslutning (§2 lister de låste).

**V2. Ungdoms-rytterrangliste:** eget matview `youth_rider_rankings_mv` med nøglen `(season_id, squad, rider_id)`. Seniorens matviews får `ra.squad = 'senior'`. Det følger spec §6.3 ("U23-ranglisten er egen view ... `race_points` genbruges uændret"). Point følger løbets trup, ikke rytterens. En rytter der flyttes op midt i sæsonen, står derfor korrekt i begge lister.

**V3. U23 og junior i én kode:** trup-parametre `u23`/`junior` fra start, og en mapping fra trup til FK-kolonne ét sted.

**V4. Ungdomsdata læses via API:** `backend/routes/rankings.ts` bruges, ikke direkte Supabase. Det følger spec §3.3 (nye tabeller har RLS slået til uden public policy) og #5176-retningen.

### 2a. Standings (holdstillinger pr. ungdomsliga/pulje)

**Datamodel:**
- A2 giver: puljer med trup og holdets ungdoms-FK.
- Mangler: `youth_season_standings (season_id, team_id, squad CHECK IN ('u23','junior'), league_division_id, tier, total_points, stage_wins, gc_wins, races_completed, rank_in_pool, updated_at)`.
  - `UNIQUE (season_id, team_id, squad)`, FK til hold `ON DELETE CASCADE`, FK til pulje `ON DELETE SET NULL`.
  - Indeks på `(season_id, squad, league_division_id)`.
  - RLS slået til uden public policy. `NOTIFY pgrst`.
  - `league_division_id` og `tier` er et snapshot af puljen, så historikken overlever op/nedrykning.
- Mangler også: seed af ungdomspuljer og holdenes ungdoms-FK (A2 undlod det bevidst, se S3).

**Backend:**
- RPC `recompute_youth_season_standings(p_season_id)`:
  - Mængdebaseret, samme tilskrivning som senior (`coalesce(rr.team_id, rytterens hold)`).
  - Kun løb med `r.squad IN ('u23','junior')` og kun hold med ungdomspulje for den trup.
  - Parkerede hold udelades (`league_division_id IS NULL`, jf. #4592).
  - Placering deles op pr. trup og pulje. Ingen `penalty_points`. Kun service_role.
- `backend/lib/youthStandings.js` med `updateYouthStandingsSafe`: best-effort med Sentry, må aldrig vælte en senior-afgørelse, og tolererer at RPC'en mangler.
- Kaldes fra `economyEngine.updateStandings` efter senior-genberegningen. Før seed skriver den 0 rækker.

**API:** `GET /rankings/youth/standings?season_id&squad` med holdnavn, puljens label og tier. Feltet `zones` (op/ned-pladser) sendes kun når ungdoms-op/ned-kontakten er tændt, så UI'en aldrig lover en oprykning der ikke kører.

**Frontend (T2, begge sider er T2 ifølge spec §7 og HANDOFF 2):**
- Komponenten `YouthStandingsTable`: ZONES-opskriften fra artboard 3e. Eget hold som `tr.cz-me`, aldrig guld. Tabular figures, EN først og DA under.
- Monteres på (a) **Standings-fanen på U23 team- og Junior team-siden** (#5519's `SquadPage.tsx`, kun egen pulje) og (b) **Standings-fanen på Youth races** (vælg pulje eller "All pools", samlet).
- Zonetallene læses fra API'et. De kopieres ikke fra `StandingsPage`s hårdkodede 2 og 4.
- Visningsnavnet (`[Club] U23` / `[Club] Juniors`, HANDOFF §2.6) tages fra #5519's helper og kopieres ikke.

**Afhængigheder:**
- A2 skal være merged og applied.
- S1 (ellers er testen af at senior er urørt meningsløs).
- Seed (S3) for at der er data.
- A3 (kalenderpakker pr. trup, intet issue fundet 23/9) for at der findes ungdomsløb.
- B1/B2 (udtagelse og AI-fyld) for felter.
- #4619-backfill for menneskeholdenes ungdomsryttere og A6 (#5518) for AI-holdenes.
- C1 afgør pyramideformen.
- Koden kan bygges og testes mod PGlite-fixtures uden nogen af dem.

**Besluttet:**
- Egen pyramide pr. trup med op/ned på egne resultater: spec §2 nr. 7, YOUTH_RULES §2.3.
- Ingen præmier i v1: spec §2 nr. 6, §5.4.
- `race_points` genbruges: spec §6.3.
- Holdets ungdomspulje spejler seniorpuljen ved S4-start: spec §6.1.
- Vises i truppens faner og på Youth races: spec §2 nr. 15, HANDOFF 5.

**Ejer-valg:** antal ungdomsdivisioner pr. trup (C1 og ejer-go, YOUTH_RULES §6 pkt. 3).

**Teknisk default (intet ejer-spørgsmål):** hold uden ungdomsryttere står i stillingen med 0 point. Det følger af spec §6.1, hvor alle hold har en pulje. Der hænger ingen penge på.

### 2b. Rytterranglister (individuelle point)

**Datamodel:** A2's `races.squad` er nok.
- Nyt: `youth_rider_rankings_mv` med samme kolonner som `rider_rankings_mv` plus `squad`, bygget på `WHERE ra.squad <> 'senior'`.
- Unikt indeks `(season_id, squad, rider_id)` og indeks `(season_id, squad, points DESC)`.
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated` eksplicit (lektien fra #5088: Supabase giver automatisk grants ved CREATE).
- Refresh-funktion `refresh_youth_rider_rankings_mv()` til service_role.

**Backend:** tilføj matviewet til `REFRESH_RPCS` i `refreshRankingMatviews.js`.

**API:** `GET /rankings/youth/riders?season_id&squad[&pool_id]`.
- "Pr. gruppe" findes ved opslag på rytterens nuværende holds ungdoms-FK, samme model som senior bruger (`team.league_division_id`).
- "Samlet" er listen uden `pool_id`.

**Frontend:** `YouthRiderRankingsTable` på Rankings-fanen på Youth races (pulje eller alle).
- Kolonner: point og sejre. Ingen præmiekolonne (#4620: "points, ikke penge").

**Afhængigheder:** A2, S1 (ellers står U23-ryttere også i senior-listen), A3 og B1/B2 for data.

**Besluttet:**
- "Ungdomsranglister vises pr. gruppe og samlet": YOUTH_RULES §2.3.
- Egen view, U23-point holdes ude af Global Rank: spec §6.3.

**Ejer-valg:** ingen nye.

### 2c. Op- og nedrykning ved sæsonslut

**Datamodel:**
- A2 giver `teams.u23_/junior_league_division_id`.
- Mangler: intet strukturelt. Historikken ligger i `youth_season_standings` (pulje-snapshot pr. sæson).

**Backend:**
- `buildPoolTree(client, { squad = 'senior' })` skal være trup-bevidst (S2). Det lukker også en seed-blokering.
- Ny `backend/lib/youthPromotion.js`:
  - En ren planlægger, samme træ-regel som `processDivisionEnd`: top N op til forælderpuljen, bund M ned fordelt på børnene. AI flyttes ikke. Nederste tier rykker ikke ned.
  - En skriver der KUN sætter trupens FK-kolonne. Ingen `division`, ingen AI-reconcile, ingen divisionsbonus, ingen bestyrelse.
  - Notifikationer med nye i18n-nøgler i EN og DA.
- Hook i `processSeasonEnd` efter senior-blokken, bag kontakten `season_end_youth_movement` (default off). Mønster: `poolReseedFlag.js`.
- Dry-run-script der read-only viser ejeren flytningerne før S4 slutter.

**Frontend:** zonerne på `YouthStandingsTable` kommer via API'et (2a), og i18n-notifikationerne skal findes. Ingen ny side.

**Afhængigheder:** S2, S4 og seed.
- Første kørsel er ved S4-slut (roadbook: "counted at the end of the season"), ikke ved cutover.
- **Merges efter S3→S4-cutover**, så sæsonslut-stien for S3 er urørt, når den kører.

**Besluttet:** egen op/ned på egne resultater (spec §2 nr. 7). Ingen penge i ungdomsligaen (C3).

**Ejer-valg:** antal op/ned-pladser pr. ungdomspulje (spillervendt tal, se §5).

---

## 3. Byggerækkefølge i spor

Fælles for alle spor:
- **Forudsætning:** PR #5525 (A2) er merged, applied af `auto-migrate.yml` og post-verificeret.
- **Migrationsfilernes dato skal ligge efter `2026-09-24-5517`.**
- "Færdig" betyder: bag kontakt, så kan den tændes og er testet tændt. Uden kontakt, så beviser testen at senior er urørt.

### S1 · Senior-vagt på resultat-aggregater (SKAL lande før første ungdomsresultat)
- **Issue:** `[trupper] Seniorstilling, rangliste-matviews og dashboard/recap tæller kun seniorløb (før første ungdomsløb)`
- **Scope:** én idempotent migration.
  - Genskaber `recompute_season_standings`, `dashboard_rider_ranking`, `dashboard_my_team_season_races`, `get_season_recap` og `get_season_documentary_facts` med `r.squad = 'senior'`. Udgangspunktet er prods `pg_get_functiondef`, ikke repo-filerne (de kan være ændret senere).
  - DROP og CREATE af `rider_rankings_mv`, `team_standings_ext_mv` og `team_race_points_mv` med filteret og samme indekser, efterfulgt af eksplicit REVOKE.
  - `get_rider_race_days` er bevidst urørt: løbsdage tæller for alle trupper.
  - Resultatet er det samme som i dag, fordi alle løb er senior.
- **Ejerskab:**
  - `database/2026-09-25-<N>-senior-only-result-aggregates.sql` (ny)
  - `backend/lib/seniorResultAggregates.integration.test.js` (ny)
  - `backend/lib/testdb/createTestDb.js`
- **Verifikation:**
  - PGlite: et ungdomsløb med resultater ændrer hverken seniorstilling eller matviews. Kontrol: samme løb markeret senior SKAL ændre dem.
  - Før merge (read-only mod prod): ny definition EXCEPT nuværende matview giver 0 rækker.
  - `verify-lock ... verify-local.ps1` (TIER FULL) og `preflight-pr.ps1`.
  - Post-verify: grants, advisors, og at de fire refresh-RPC'er kører.
- **Kontakt:** ingen (resultatet er uændret i dag).
- **Model:** opus.

### S2 · Seed-blokerende læsere + trup-bevidst pulje-træ
- **Issue:** `[trupper] Seed-blokerende pulje-læsere scopes (backend + frontend) og buildPoolTree får trup-parameter`
- **Scope:**
  - A2's liste over `blocksYouthSeed`-læsere tømmes. Backend bruger `withSeniorSquadScope`. Frontend læser `league_divisions` og `races` med senior-filter (samme `or`-filter som #5330).
  - `buildPoolTree` får `{ squad }`.
  - Node-fallbacken i `updateStandings` scopes.
  - A2-guarden lærer at godkende eksplicit `.eq("squad", <trup>)`, så ungdomslæsere kan skrives.
  - Resultatet er det samme som i dag.
- **Ejerskab:**
  - `backend/lib/economyEngine.js` (kun `buildPoolTree`, reseed-label-opslaget og races-læseren i fallbacken)
  - `backend/lib/betaResetService.js`, `backend/lib/teamProfileEngine.js`, `backend/lib/sponsorContractsService.js`
  - `frontend/src/pages/StandingsPage.jsx`, `RiderRankingsPage.jsx`, `ResultaterPage.jsx`, `DashboardPage.jsx`, `RaceCentrePage.jsx` (kun de nævnte læsere)
  - A2's guard-test (ratchet-listen)
  - Tilhørende tests
- **Verifikation:**
  - Adfærdstests med ungdomspuljer i fixtures: senior-oprykning ender aldrig i en ungdomspulje, et nyt holds indgangspulje er aldrig en ungdomspulje, sponsor-divisoren er urørt. Kontrol mod et scope der ikke filtrerer.
  - Frontend: lint, `node --test`, build.
  - TIER FULL.
- **Kontakt:** ingen.
- **Model:** opus.
- **OBS:** må ikke køre samtidig med #4153 (ejer `economyEngine.js` i bølge 5-carry). Tjek åbne PR'er for overlap i de fem sider ved start.

### S3 · Seed af ungdomspuljer (EJER-GATED)
- **Issue:** `[trupper] Seed U23-puljer + holdenes ungdoms-FK, nye og parkerede hold (efter C1 og ejer-go)`
- **Scope:**
  - Migration med INSERT i `league_divisions` (`squad='u23'`) i den form ejeren valgte efter C1. Labels følger det eksisterende mønster, EN.
  - UPDATE af `teams.u23_league_division_id` som spejling af seniorpuljen (spec §6.1). Ved færre ungdomstiers foldes de nederste senior-tiers ind med pulje-ratio.
  - AI-hold får kun en pulje, hvis de har en U23-trup (A6).
  - Nyt hold (`teamProfileEngine`) får ungdomspulje efter samme regel. Parkering (`managerParking.js`) og beta-reset nulstiller ungdoms-FK.
  - Read-only dry-run-script viser ejeren fordelingen (hold pr. pulje, menneske/AI).
  - Junior får sin egen seed-migration senere.
- **Ejerskab:**
  - `database/2026-09-2x-<N>-seed-youth-pools-u23.sql`
  - `backend/lib/teamProfileEngine.js`, `backend/lib/managerParking.js`, `backend/lib/betaResetService.js`
  - `backend/scripts/youthPoolSeedDryRun.js` (ny)
  - `docs/SEASON_CUTOVER_RUNBOOK.md` (trinnet)
- **Verifikation:**
  - Seed-gaten er grøn (kræver S2).
  - Dry-run vist til ejeren, derefter ejer-go på netop dette skridt, derefter merge.
  - Post-verify-SQL: tal pr. pulje, ingen hold i to ungdomspuljer, ingen senior-FK ændret.
- **Timing:** merges i runbooken efter S3's `processSeasonEnd` og før S4-kalenderen genereres (#4270).
- **Model:** opus.

### S4 · Ungdomsstillinger (data + API)
- **Issue:** `[trupper] Ungdomsstillinger: youth_season_standings + genberegning efter hvert ungdomsløb + /rankings/youth/standings`
- **Scope:**
  - Tabel og RPC som i 2a.
  - `youthStandings.js` kaldes fra `updateStandings`.
  - `youthLeagueRules.js`: mapping fra trup til FK-kolonne, og op/ned-pladserne som SIM-STARTPUNKT (ejer-valg E2).
  - `youthMovementFlag.js` (læser, fravær betyder off).
  - Route i `rankings.ts` med zod-validering.
- **Ejerskab:**
  - `database/2026-09-2x-<N>-youth-season-standings.sql`
  - `backend/lib/youthStandings.js`, `backend/lib/youthLeagueRules.js`, `backend/lib/youthMovementFlag.js`, hver med tests
  - `backend/lib/economyEngine.js` (kun hooket i `updateStandings`)
  - `backend/routes/rankings.ts` med test
  - `backend/lib/testdb/createTestDb.js`
  - `database/schema-snapshot.json`
- **Verifikation:**
  - PGlite: to U23-puljer og to junior-puljer med resultater giver korrekt placering pr. pulje, senior er urørt (kontrol), genkørsel giver samme resultat, og et parkeret hold er udeladt.
  - Route-kontrakttests.
  - EXPLAIN af SELECT-delen mod prod read-only.
  - TIER FULL.
- **Kontakt:** ingen (ingen læser i UI før S7/S8).
- **Model:** opus.
- **Afhænger af:** S1 og S2 (fil-rækkefølge i `economyEngine.js` og `createTestDb.js`).

### S5 · Ungdoms-rytterrangliste (data + API)
- **Issue:** `[trupper] Ungdoms-rytterrangliste: youth_rider_rankings_mv + refresh + /rankings/youth/riders`
- **Scope:** som i 2b.
- **Ejerskab:**
  - `database/2026-09-2x-<N>-youth-rider-rankings-mv.sql`
  - `backend/lib/refreshRankingMatviews.js` med test
  - `backend/routes/rankings.ts` med test
  - `backend/lib/testdb/createTestDb.js`
- **Verifikation:**
  - PGlite: en U23-rytter står i ungdomslisten og ikke i senior-listen. En rytter flyttet op midt i sæsonen står i begge med de rigtige point.
  - Grants efter apply: ingen anon/authenticated.
  - Refresh-tid målt mod prod-kopi før og efter A6-fordoblingen (G6-klassen).
- **Kontakt:** ingen.
- **Model:** sonnet med eksplicit grant-tjekliste i prompten.
- **Afhænger af:** S1 og S4 (samme filer).

### S6 · Ungdoms-op/nedrykning ved sæsonslut
- **Issue:** `[trupper] U23-/junior-op- og nedrykning ved sæsonslut bag season_end_youth_movement`
- **Scope:** som i 2c. `/rankings/youth/standings` begynder automatisk at sende `zones`, når kontakten tændes (læseren fra S4).
- **Ejerskab:**
  - `backend/lib/youthPromotion.js` med test
  - `backend/lib/economyEngine.js` (kun hooket i `processSeasonEnd`)
  - `database/2026-09-2x-<N>-youth-movement-flag.sql` (app_config-række, off)
  - `frontend/public/locales/en/backendMessages.json` og `frontend/public/locales/da/backendMessages.json`
  - `backend/scripts/youthSeasonEndDryRun.js` (ny)
  - `docs/FEATURE_REGISTRY.yml` + `node scripts/generate-feature-status.mjs`
- **Verifikation:**
  - Ren planlægger: 2 op og 4 ned pr. pulje, AI sprunget over, nederste tier rykker ikke ned, form 1/2/4.
  - Integration: kontakt off giver ingen skrivninger (S3-slut uændret). Kontakt on skriver kun trupens FK. `division` og `league_division_id` er urørt (kontrol).
  - Notifikationsnøgler findes på EN og DA. TIER FULL.
- **Kontakt:** `season_end_youth_movement`, default off, testet tændt.
- **Model:** opus.
- **Merge:** efter S3→S4-cutover.

### S7 · Standings-fanen på U23/Junior-siden
- **Issue:** `[trupper] Standings-fanen på U23 team- og Junior team-siden viser egen ungdomspulje`
- **Scope:**
  - `YouthStandingsTable` (artboard 3e) og youth-klient i `rankingsClient.ts` og `rankingsApi.ts`.
  - Erstatter #5519's EmptyState på Standings-fanen.
  - Tom tilstand når holdet ingen pulje har eller der ingen løb er endnu. Ingen falske tal.
- **Ejerskab:**
  - `frontend/src/components/youth/YouthStandingsTable.tsx` med test
  - `frontend/src/lib/rankingsClient.ts`, `frontend/src/lib/rankingsApi.ts`
  - `frontend/src/pages/SquadPage.tsx` (kun Standings-fanens indhold)
  - `frontend/public/locales/en/squad.json` og `frontend/public/locales/da/squad.json`
  - `frontend/tests/e2e/youth-standings.spec.ts`
- **Verifikation:**
  - lint, `node --test`, build, Playwright i alle 3 projekter med kontakten tændt i preview-mock.
  - TASTE-tjekliste.
  - **Ejer-visuelt go** på billeder med ægte data (1440 og 390).
- **Kontakt:** `youth_squad_pages` (#5519).
- **Model:** sonnet.
- **Afhænger af:** #5519 merged og S4's API-kontrakt. Kan bygges mod mock og merges efter S4.

### S8 · Youth races-siden: Standings og Rankings
- **Issue:** `[trupper] Youth races under Results: Standings og Rankings pr. pulje og samlet (bag youth_races_page)`
- **Scope:**
  - T2-side med Select (U23 team / Junior team) og fanerne Calendar · Results · Standings · Rankings (HANDOFF 5).
  - Calendar og Results viser EmptyState, indtil B5 leverer dem.
  - Rankings har undervalget Teams (samlet stilling) og Riders (`YouthRiderRankingsTable`).
  - Nyt nav-punkt under Results.
  - Guld-knappen `Set tactics` hører til B5's Calendar og tilføjes ikke her uden funktion.
- **Ejerskab:**
  - `frontend/src/pages/YouthRacesPage.tsx`
  - `frontend/src/components/youth/YouthRiderRankingsTable.tsx`
  - `frontend/src/App.jsx` (route)
  - `frontend/src/components/layout/**` (nav)
  - `backend/lib/youthRacesPageFlag.js`
  - `database/2026-09-2x-<N>-youth-races-page-flag.sql`
  - `backend/lib/stageFlagCatalog.js` og display-flags-handleren i `backend/routes/api.js`
  - youth-locales
  - `frontend/tests/e2e/youth-races-page.spec.ts`
- **Verifikation:** som S7 plus FEATURE_REGISTRY-post. Ejer-visuelt go.
- **Kontakt:** `youth_races_page`, default off, testet tændt.
- **Model:** sonnet.
- **Afhænger af:** S7 (samme klient og locales) og S5 (riders-endpoint). #5519 skal være merged (ejer `components/layout/**`).

### S9 · Senior-vagt i JS-læsere af `race_results` (uden for rangliste-scope, blokerer tænding af ungdomsløb)
- **Issue:** `[trupper] Sponsor pr. løbsdag, bestyrelsesmål og omdømme tæller kun seniorløb (C3)`
- **Scope:**
  - `sponsorRaceDayIncome.js` og `boardGoalContext.js` begrænses til seniorløb via `withSeniorSquadScope`. `reputationReplay.js` gøres senior-only som v1-default.
  - Hører til spec B4/C3-klassen (præmie-grenen). Nævnt her, fordi det er samme fælde som S1.
- **Ejerskab:** de tre filer med tests.
- **Verifikation:** ungdomsløb giver 0 kr. og intet bestyrelses- eller omdømmesignal (kontrol).
- **Kontakt:** ingen.
- **Model:** opus.

### Bølgeplan (maks 4 laner, ingen fil-overlap)

| Bølge | Laner | Start når |
|---|---|---|
| U1 | S1 ∥ S2 ∥ S9 | A2 er merged og applied. S2 ikke samtidig med #4153 |
| U2 | S4 (efter S1) ∥ S3 (efter S2, C1 og ejer-go) ∥ S7 (efter #5519) | U1 er merged |
| U3 | S5 (efter S4) ∥ S6 (efter S2 og S4, merge efter cutover) ∥ S8 (bygges parallelt, merges efter S5 og S7) | U2 er merged |

`createTestDb.js` rører S1, S4 og S5, og `economyEngine.js` rører S2, S4 og S6. Begge kæder er derfor bevidst i rækkefølge.

**Junior:** samme kode. Den tændes med en junior-seed (S3b), når junior-kalenderen (#4621/A3), junior-udtagelse (sæsonalder 17 eller mere, B1) og junior-C1 er klar.

**Close-out pr. bølge (bølgereglen: ingen patch note i PR'erne):**
- Patch note og `help.json` (en+da) om ungdomsligaer, ranglister og op/ned.
- YOUTH_RULES §2.3/§4 (efter #5518, som ejer filen i bølge 4).
- Spec §6.2 rettes til V1.

---

## 4. Før S4-cutover vs. venter på ejeren

| Spor | Før cutover uden nye ejer-valg? | Hvad mangler for at tænde |
|---|---|---|
| S1 senior-vagt | **Ja, og hårdt: før første ungdomsløb afgøres** | Intet |
| S2 blokerende læsere | Ja | Intet |
| S9 sponsor/bestyrelse | Ja (hårdt før ungdomsløb tændes, C3) | Intet |
| S4 ungdomsstillinger | Ja | Data kommer med seed og ungdomsløb |
| S5 ungdoms-rytterrangliste | Ja | Samme |
| S7 Standings-fane | Ja, bag `youth_squad_pages` | Ejer-visuelt go (billeder, ikke tal) |
| S8 Youth races | Ja, bag `youth_races_page` | Ejer-visuelt go |
| S6 op/ned | Kode ja (kontakt off). **Merge efter cutover** | Ejerens pladstal (E2) før kontakten tændes, senest før S4 slutter |
| S3 seed | **Nej** | Ejer-go på pyramideform efter C1 (#5518) og go på selve seed-merge |
| Præmier/bonus i ungdomsløb | Nej, ikke i v1 | Ejerens beslutning efter S4-økonomidata (roadbook, spec §5.4) |

---

## 5. Ejer-valg (ét ad gangen)

**E1. Pyramideform pr. trup efter C1.**
- Den låste regel er: start 1/2/4/8, og skær antal divisioner kun hvis C1 fejler (spec §2 nr. 14).
- Ejeren giver derfor go på C1-resultatet fra #5518, ikke et frit valg.
- Vis samtidig, at ungdomspuljerne i tier 1-3 bliver rene menneskepuljer ved spejling, fordi AI-hold kun står i tier 4 i dag.
- **Anbefaling:** den største form C1 består.

**E2. Op/ned-pladser pr. ungdomspulje.**
- **A: som senior, 2 op og 4 ned.** Samme regel overalt, og zonerne ser ens ud.
- **B: færre, fx 1 op og 2 ned.** Mindre udskiftning i små puljer.
- **Anbefaling: A som SIM-STARTPUNKT.**

**E3. Junior-go:** samme som E1 for junior, når junior-C1 er målt.

**E4. Præmier:** ikke nu (låst: spec §2 nr. 6 og roadbook "once I have seen the numbers").

---

## 6. Risici

1. **`season_standings ON CONFLICT (season_id, team_id)`** antager én række pr. hold [V].
   - Lægges ungdom ind der, skal nøglen ændres, og alle ca. 47 læsere skal filtreres.
   - `global_rank_mv` får dubletter på det unikke indeks `team_id`, så REFRESH fejler og Global Rank fryser [V].
   - `StandingsPage` viser den forkerte række [V].
   - **Håndtering:** V1 (egen tabel), så senior er upåvirket fra starten.
2. **Senior-lækage via `race_results`** (§1.4) [V]. Uden S1 og S9 flytter ungdomsresultater senior-op/ned, divisionsbonus, bestyrelse, sponsorbase og Global Rank, og sponsor pr. løbsdag bliver en ny guldkilde (C3). **Håndtering:** S1 og S9 før første ungdomsløb afgøres, med kontroltests.
3. **Pulje-træets nøgle `tier:pool_index` kolliderer efter seed** [V]. Senior-oprykning kunne sætte et holds `league_division_id` til en ungdomspulje. **Håndtering:** S2. A2's seed-gate blokerer seed i CI, indtil S2 er merged.
4. **Frontendens direkte læsere** (StandingsPage: `league_divisions`, `season_standings`, `races`) viser ungdomspuljer som faner og ungdomsløb i grafen [V]. **Håndtering:** S2. `.eq("squad", …)` giver fejl 42703, hvis frontend deployer før A2's migration er applied, så S2 merges først efter A2-apply.
5. **Genopbygning af matviews i S1:** DROP og CREATE giver grants automatisk igen, så REVOKE skal gentages (#5088/#5176). Læsere venter på låsen under migrationen, og `rankings.ts` prøver kun igen ved lock-timeout. **Håndtering:** eksplicit REVOKE, post-verify af grants og advisor, og kør migrationen uden for løbsafvikling.
6. **Migrationsrækkefølge:** S1/S4/S5 refererer `races.squad`. En fil dateret før A2's, eller en merge før A2 er applied, gør at auto-migrate fejler.
7. **Sæsonslut ved cutover:** S3's `processSeasonEnd` kører ved cutover.
   - S2 rører `buildPoolTree`, men resultatet er det samme, bevist med test.
   - S6 merges først efter cutover.
   - S3-seed placeres i runbooken efter S3's sæsonslut og før S4-kalenderen.
8. **AI-hold i ungdomspyramiden:** AI flyttes ikke, og nye AI-hold fra reconcile har ingen ungdomstrup, så de får ingen pulje. Når AI-hold pensioneres, krymper ungdomspuljerne (FK `SET NULL`). **Accept i v1**, målt i S6's dry-run.
9. **Parkerede og nye hold:** uden S3's regler står parkerede hold med 0 point og optager pladser, og nye hold mangler i stillingen. **Håndtering:** S3 og RPC-filteret i S4.
10. **Tynde felter i menneskepuljer:** så længe #4619-backfill og A6 ikke er kørt, er de fleste ungdomsstillinger 0-rækker. Det er C1-spørgsmålet og hører til E1-go-kortet.
11. **"Pr. gruppe" i rytterranglisten** slås op via holdets nuværende pulje, ikke via et snapshot fra løbsdagen. Efter op/ned ændres tilskrivningen i historiske sæsoner. Samme begrænsning som senior. Dokumentér den.
12. **Tie-break på `team_id`** afgør op/ned ved pointlighed, præcis som for senior. Nævn det i hjælpeteksten.
13. **Refresh-belastning:** endnu et matview pr. afgjort løb, og A6 fordobler rytterbestanden. Mål det i S5 (G6-klassen).
14. **Kopier af tal:** `StandingsPage` hårdkoder 2 og 4. Ungdomszonerne læses fra API'et og kopieres ikke.
15. **Fil-overlap med igangværende bølger:**
    - `squads.js` ejes af #5432.
    - `YOUTH_RULES.md` ejes af #5518.
    - `SquadPage.tsx`, `components/layout/**`, `stageFlagCatalog.js` og `api.js` display-flags ejes af #5519.
    - `economyEngine.js` ejes af #4153.
    - Sporene ovenfor er lagt efter disse.

---

## 7. Kilder

- Spec 2026-09-15 §2, §3.2, §3.3, §6.1-§6.3, §7, §8, §10.
- `docs/YOUTH_RULES.md` §2.3, §2.6, §4, §6.
- `docs/design/youth-tiers/HANDOFF.md` punkt 2, 5, 7 og ZONES-noten.
- `docs/design/PAGE_TEMPLATES.md` T2.
- Roadbook-plan 15/9.
- PR #5525 (diff læst 23/9).
- Issues #5517, #5518, #5519, #5432, #4620, #4621, #2492.
- `backend/lib/economyEngine.js` (`updateStandings`, `processSeasonEnd`, `buildPoolTree`, `processDivisionEnd`), `database/2026-07-12-recompute-standings-rpc.sql`, `database/2026-07-04-ranking-matviews.sql`, `backend/routes/rankings.ts`, `backend/lib/refreshRankingMatviews.js`, `backend/lib/sponsorRaceDayIncome.js:185`, `frontend/src/pages/RankingsHubPage.jsx`, `StandingsPage.jsx:128-187, 413-414`, `frontend/src/hooks/useRiderRankings.js`.
- Prod-SELECT 23/9: kolonner, constraints, afhængigheder, matview-definitioner, funktionslister og tællinger.

---
