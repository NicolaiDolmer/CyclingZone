# Spec: ungdomsløb live ved S4 (U23 + junior i egne ligaer med egen kalender)

> Cloud-session 24/9. Byggeklar spec, ingen kode. Refs #2492 #5536 #4620 #4621. Mål: LIVE ved S4-start 28/9.
> Bygger på `docs/superpowers/plans/2026-09-23-u23-junior-ranglister-plan.md` (plan S1-S9), `docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md` og `docs/YOUTH_RULES.md` §2.3.
> Linjenumre er fra `main` @ `03f3da9`.

## Formål (én linje)

U23- og juniortrupperne kører deres egne løb i egne puljer fra S4-start, uden at et eneste ungdomsresultat lækker ind i seniorstillingen, pengene eller Global Rank.

## Ejer-beslutninger (citeret)

- **24/9 kl. ca. 10:35** ([#2492-kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/2492#issuecomment-5810468544)):
  > "ungdomsløbene (U23/junior i egne ligaer med egen kalender) skal være LIVE ved S4-start 28/9 sammen med resten. Intet udskydes. Bygges PARALLELT i næste bølge: S2 #5536, ungdomspuljer, kalender pr. trup fra katalogerne (36 U23 + 18 junior), AI-holdenes U23-/juniorryttere (#5283-tabellen → A6 --apply på ejer-go), udtagelse til ungdomsløb. Vagterne S1 (#5606) og S9 (#5609) er merget 24/9."
- **2/9** (`YOUTH_RULES.md` §2.3): egen kalender pr. trup på samme motor · udtagelse som i dag (assistent default, manuel valgfri) · taktik som senior · **ingen præmiepenge i v1** · egen pyramide pr. trup med op/nedrykning · felt-gaten C1 er hård: "Fejler den, skæres antal divisioner, aldrig antallet af løb til nul".
- **15/9** (spec §10): 10.1 = alt live 28/9 (flag-forslaget `u23_racing_enabled` afvist) · 10.4 = AI-U23-trup på 6-9 ryttere · 10.5 = U23 1-2 løb/uge · 10.6 = U23-loft 12.
- **#5536** (issue-tekst): "Bit-identisk i dag. [...] Må ikke køre samtidig med #4153 (economyEngine.js)."

## Tilstand i prod (read-only SELECT 24/9)

| | Tal |
|---|---|
| `league_divisions` | kun `squad = 'senior'` (1/2/4/8). Ingen ungdomspuljer. |
| `race_pool` | senior 224 · **u23 36** · **junior 18** (katalogerne er seedet) |
| Menneskehold med U23-ryttere | 92 hold, 264 ryttere. **Kun 7 hold har ≥ 6** (`MIN_RACE_ENTRIES = 6`, `backend/lib/raceAutopick.js:47`), maks 7 |
| Menneskehold med juniorer | 90 hold, 282 ryttere. **Kun 14 hold har ≥ 6** (før 17-års-filteret), maks 8 |
| AI-hold med ungdomsryttere | **0** (101 AI-hold, alle senior). A6 er ikke kørt. |
| Flag | `youth_squad_pages` = beta. Intet ungdomsløbs-flag findes (`stageFlagCatalog.js`, `FEATURE_REGISTRY.yml:470-478` "three-squads" = spec). |

**Konsekvens:** uden A6 kan næsten ingen hold stille et ungdomsfelt. A6 (AI-ungdomstrupper) er ikke pynt, det er det der gør felterne kørelige.

## Allerede leveret (merget)

- **S1** (#5606): senior-vagt på SQL-aggregater og 3 matviews (`database/2026-09-25-5535-senior-only-result-aggregates.sql`).
- **S9** (#5609): sponsor pr. løbsdag, bestyrelsesmål og omdømme tæller kun seniorløb (`sponsorRaceDayIncome.js`, `boardGoalContext.js`, `reputationReplay.js`, `reputationHook.js`).
- **A2** (#5525): `squad` på puljer, løb og hold (`database/2026-09-24-5517-squad-leagues-races-teams.sql`).
- **A6-generatoren** er bygget, ikke kørt: `backend/scripts/generateYouthSquadsS4.js`.

## Hvad der mangler, i kode-rækkefølge

1. **S2: scope seed-blokerende pulje-læsere** (#5536). Uden den er CI's seed-gate rød, og ungdomspuljer kan ikke seedes.
2. **Ungdomspuljer seedes** (plan S3) + holdenes ungdoms-puljetilknytning.
3. **Præmievagt** (C3/B4): ungdomsløb må ikke udbetale præmiepenge.
4. **Udtagelse**: eligibility og pulje-match kender trup; junior kun fra sæsonalder 17.
5. **Kalender pr. trup** genereres fra katalogerne, efter seniorkalenderen.
6. **A6 --apply** (AI-ungdomstrupper) på ejer-go, efter transitionen (kræver at S4 er aktiv).
7. **Stilling/rangliste/visning** (plan S4, S5, S7, S8).

Trin 1-5 skal ligge før "Start næste sæson" 28/9; trin 6 lige efter; trin 7 før første ungdomsløb afgøres.

## Kodeændringer (fil:linje)

### Y1: S2 backend-læsere + guard (#5536)

Seed-blokerende læsere (`blocksYouthSeed: true` i `backend/lib/squadSeniorReaders.test.js:174-219`):
- `backend/lib/betaResetService.js:243-246` (`allocateLeaguePools` :237): `.from("league_divisions").select("id").eq("tier", …)` → `withSeniorSquadScope`.
- `backend/lib/teamProfileEngine.js:182-185` (`pickDivisionForNewTeam`): senior-scope. **Samme fil som S4-strukturens spor A2**, se spor-tabellen.
- `backend/lib/sponsorContractsService.js:118-120` + løbslæseren :105-108 (fodrer samme divisor): senior-scope.
- Guard: `classifyReads` (`squadSeniorReaders.test.js:146-164`) skal godkende et eksplicit `.eq("squad", <trup>)` som scoped. Ratchet-listen sænkes pr. rettet fil.
- Hjælper findes: `withSeniorSquadScope` `backend/lib/squads.js:534-547`, `scopeToSeniorSquad` :508, filterstreng `backend/lib/racePoolCatalog.js:31`.

**`backend/lib/economyEngine.js` er låst** (lokal bølge), men har 2 af de blokerende læsere: `buildPoolTree` :2492-2522 (kaldt :1576, :2546, :2680) og reseed-label :2715-2716, plus Node-fallbacken i `updateStandings` :2846. **Seed-gaten kan ikke blive grøn, før den del er lavet.** Anbefaling: den lokale session tager economyEngine-delen af S2 som første ting efter sin bølge, i samme PR som S4-strukturens A5 (`buildPoolTree` + `retired_at`), fordi det er samme funktion.

### Y2: S2 frontend-læsere (samme sider som S4-strukturens pulje-filter)

Ingen frontend-hjælper findes; lav én: **ny** `frontend/src/lib/seniorScope.ts` med samme `or`-filter (`squad.is.null,squad.eq.senior`) + `retired_at is null` for aktiv sæson (fra `spec-s4-struktur-2026-09-24.md`, risiko 3).
- `frontend/src/pages/StandingsPage.jsx`: puljer :137, løb :174-177, `season_standings` :167-172.
- `frontend/src/pages/RiderRankingsPage.jsx:145` (pulje-vælger).
- `frontend/src/pages/ResultaterPage.jsx`: puljer :191, afsluttede løb :262-266.
- `frontend/src/pages/DashboardPage.jsx:524` (puljer; løbene :456, :498 er allerede pulje-scoped).
- `frontend/src/pages/RaceCentrePage.jsx:141` (puljer); løbene :138-140 kommer via `race_stage_schedule` :125-130, så **ungdomsløb ville dukke op i Race Centre** uden filter.

### Y3: ungdomspuljer + tilknytning (plan S3)

- **Ny migration** `database/2026-09-25-4620-youth-pools-seed.sql`: `insert into league_divisions (squad, tier, pool_index, …)` for u23 og junior + `teams.u23_league_division_id` / `teams.junior_league_division_id` (kolonnerne ligger i planens S3, l.280-299). Seed-gaten (`squadSeniorReaders.test.js:348-361`) stopper migrationen, til Y1 + economyEngine-delen er grønne. Det er meningen.
- **Ny** `backend/lib/youthPoolAssignment.js` (ren): hvilket hold i hvilken ungdomspulje. Menneskehold: spejl seniorpuljen (spec 2026-09-15 §6.1) eller fordel efter behov. AI-hold: fordel efter behov (C1 23/9: "Fordeles AI-trupperne efter behov, holder større former").
- **Ny** `backend/scripts/seedYouthPools.js`: dry-run default, `--apply --owner-go`.
- **Pyramideform = ejer-valg** (YOUTH_RULES §6 pkt. 3). Ingen evidens her for felt-tallene efter A6; `backend/scripts/measureYouthFieldGate.mjs` skal køres med A6-dry-run-populationen. Se "Ejer-valg" nederst.

### Y4: præmievagt + udtagelse (senior bliver bit-identisk)

- Præmier (C3/B4, ikke bygget): `backend/lib/raceRunner.js:203, 224` og `backend/lib/raceResultsEngine.js:83` sætter `prize_money = pts * PRIZE_PER_POINT` uden trup-vagt; `backend/lib/prizePayoutEngine.js:49` summerer det. Tilføj `if (race.squad && race.squad !== "senior") prize = 0` ved kilden (spec §5.4).
- `backend/lib/riderEligibility.js`: `applyRiderEligibilityFilter` :31 → `applyRosterVisibilityFilter` :49-51 → `squads.applySeniorSquadFilter` (`squads.js:261`). Ny påkrævet `squad`-parameter (spec §5.1, ca. 14 kaldesteder), default `"senior"` så alle eksisterende kald er uændrede. Junior: kun sæsonalder ≥ 17 (`YOUTH_RULES.md` §1 l.67).
- `backend/lib/raceBinding.js:322` `teamInRacePool({ teamDivisionId, racePoolId })`: vælg holdets pulje efter løbets `squad` (senior → `league_division_id`, u23 → `u23_league_division_id`, junior → `junior_league_division_id`).
- `backend/lib/raceEntryGenerator.js` (assistentens auto-udtagelse): løb :169 (uscopet), gruppering pr. pulje :236-240, hold pr. `league_division_id` :263-265 og :310-315, ryttere :441-446 → trup-bevidst.
- `backend/lib/raceRunner.js` `fillMissingTeamEntries`: pulje-filter :1120-1127, ryttere :1133-1138, eksisterende tilmeldinger :1398-1402 → trup-bevidst.
- `backend/lib/raceSelection.js:130-135` (`prepareSelectionChange`).
- **Manuel udtagelse** går gennem ruter i `backend/routes/api.js` (4538-4571, 5050-5155, 5452-5504, 5609-5669). **api.js er låst.** 28/9-løsning: assistentens auto-udtagelse (default) kører ungdomsløbene; manuel udtagelse af ungdomsløb kommer, når api.js er fri. Det er i tråd med §2.3 ("assistentens auto-udtagelse er standard").

### Y5: kalender pr. trup (fra katalogerne)

- `backend/lib/tierCalendarMaterializer.js` `materializeTierCalendars` :532-567: ny `squad`-option (default `"senior"`). Scope puljer (:570), katalog (:598-601, :613), eksisterende løb og dedup (:629, :636-642) med `.eq("squad", squad)`. **Insert :740-744 skal skrive `squad`**, ellers bliver løbet senior.
- `backend/scripts/buildSeasonCalendar.js`: `--squad u23|junior` (CLI :308-326). `--replace-existing` / `replaceSeasonCalendarRows` :223 sletter i dag **hele sæsonens** løb; skal scopes til trup, ellers sletter en ungdomskørsel seniorkalenderen.
- Tæthed: U23 1-2 løb/uge, junior 1/uge (spec 10.5, `YOUTH_RULES.md` §2.3). Egne værdier ved siden af `TIER_DENSITY` / `TIER_GAME_DAY_QUOTA` (`calendarTierCaps.js`).
- `api.js:12387, :12711` afviser allerede ungdomsløb i kalender-admin; ingen ændring.
- **Samme to filer som S4-strukturens spor A3** (4 D4-puljer). Se spor-tabellen: ét kalender-spor ejer begge.

### Y6: AI-ungdomstrupper (A6) + deres puljer

- `backend/scripts/generateYouthSquadsS4.js`: `--juniors=N` påkrævet (0..10, :164-172), `--apply` kræver `--owner-go` (:176-179), kun når målsæsonen er aktiv (:35-39, `fetchActiveSeason` :542-546), idempotent pr. trup. U23-trup 6-9 (`U23_SQUAD_SIZE` :120). Kørsel = ejer, lige efter "Start næste sæson".
- Forudsætning (#5283 pkt. 2): generator-rapporten side om side med 10 prod-ryttere (`docs/RIDER_GENERATION.md:282` §8c) vist for ejeren.
- A6 laver ryttere, ikke pulje-tilknytning. Y3's `seedYouthPools.js` skal køres EFTER A6 (eller igen), så AI-holdene får `u23_/junior_league_division_id`.

### Y7: stilling, rangliste, visning (plan S4, S5, S7, S8)

- S4 `youth_season_standings` + RPC + `backend/lib/youthStandings.js` + `/rankings/youth/standings` (`backend/routes/rankings.ts`). Planen hænger opdateringen på `economyEngine.updateStandings` (:2788), som er låst. **Alternativ uden economyEngine:** kald `refreshYouthStandings(raceId)` fra finaliseringen i `raceRunner.js` for løb med `squad != 'senior'` (Y4 ejer raceRunner.js, så det lægges dér).
- S5 `youth_rider_rankings_mv` + refresh (`backend/lib/refreshRankingMatviews.js`) + `/rankings/youth/riders`.
- S7 Standings-fanen på `frontend/src/pages/SquadPage.tsx` (i dag `EmptyState` for Calendar/Results/Standings, :108-114) bag `youth_squad_pages`.
- S8 "Youth races"-siden. Planen lægger flaget i `api.js` display-flags (:1249-1262), som er låst. Alternativ: genbrug `youth_squad_pages` til siden i v1.
- Tekster: EN først, DA under, i `squad.json` / youth-namespaces (ikke låste). Nye frontend-filer `.ts/.tsx`.

## Tests

| Spor | Test |
|---|---|
| Y1 | `squadSeniorReaders.test.js`: ratchet sænket, `.eq("squad","u23")` klassificeres som scoped. Adfærdstests med ungdomspuljer i fixtures: `betaResetService`/`teamProfileEngine`/`sponsorContractsService` ignorerer ungdomspuljer (bit-identisk senior). |
| Y2 | Unit for `seniorScope.ts`. e2e: Standings/Race Centre med en ungdomspulje + ungdomsløb i mocks viser kun senior, desktop 1440 + mobil 390. |
| Y3 | `youthPoolAssignment.test.js` (spejl/behov, ingen pulje under `MIN_RACE_ENTRIES` startende hold). Seed-gaten er selv testen for rækkefølgen. |
| Y4 | Præmie = 0 for u23/junior-løb, uændret for senior. `riderEligibility`: junior 16 afvist, 17 godkendt; senior-kald uændrede. `raceEntryGenerator`: U23-løb får U23-ryttere fra holdets U23-pulje, aldrig seniorer. `raceRunner` autofill: samme. |
| Y5 | Materializer med `squad: "u23"` skriver `races.squad = 'u23'`, rører ikke seniorløb; `--replace-existing --squad u23` sletter kun U23. Tæthed 1-2/uge. |
| Y6 | Eksisterende `generateYouthSquadsS4.test.js`; plus: pulje-tilknytning efter A6. |
| Y7 | `youthStandings.test.js`; route-tests; e2e SquadPage Standings-fanen. |

## Risici

1. **economyEngine.js er låst og står på den kritiske vej** (S2-delen og, i planen, S4-hooket). Uden den kan ungdomspuljerne ikke seedes (CI-gate). Hvis den lokale bølge ikke slipper filen i tide, er ungdomsløb ikke live 28/9. Dette skal ejeren vide nu, ikke 27/9.
2. **Træning for ungdomsryttere på løbsdage:** `backend/lib/trainingRaceDayTick.js:157-176` (`resolveTeamRaceDay`) finder løbsdage via `teams.league_division_id`, altså seniorpuljen. Ungdomsryttere trænes på seniorens løbsdags-akse. Filen er låst; `training_day_runs.squad` findes allerede (`database/2026-09-15-4847-training-day-close-trigger.sql`). Desuden afviser `backend/lib/dailyTrainingEngine.js:176-178` alt andet end trup "senior" ("rider selection is not squad-scoped (see #4620)"). Den fil ejes af løbsdags-spec'ens spor C2; ungdoms-aksen skal derfor bygges EFTER C2 i samme fil, ikke parallelt. trainingRaceDayTick-delen skal laves af den lokale session.
3. **Felterne:** 7 menneskehold har ≥ 6 U23-ryttere i dag. Uden A6 (ejer-go, lige efter transitionen) bliver U23-løbene tomme. Første ungdomsløb bør ligge nogle løbsdage inde i S4, så A6 + pulje-tilknytning kan nå at køre.
4. **Præmiepenge:** uden Y4-vagten udbetaler et ungdomsløb præmier (S9 dækkede kun sponsor/bestyrelse/omdømme).
5. **Race Centre** viser ungdomsløb blandt seniorløb uden Y2.
6. **Dobbelt-generering:** en ungdoms-kalenderkørsel med `--replace-existing` sletter i dag hele sæsonen. Y5 skal scopes, før nogen kører den.
7. **1 rytter = 1 løb pr. løbsdag** gælder på tværs af trupper. En rytter flyttet midt på en løbsdag ændrer ikke dagens udtagelse (`YOUTH_RULES.md` §2.2). Bindingen (`race_entry_days`) skal testes med én rytter i både et senior- og et U23-løb samme løbsdag (skal afvises).

## Spor-opdeling (parallelt, uden fil-overlap, på tværs af de tre specs)

| Spor | Filer (eneste ejer) | Afhænger af | Låst fil det venter på |
|---|---|---|---|
| **Y1** S2 backend | `betaResetService.js`, `sponsorContractsService.js`, `squadSeniorReaders.test.js` (+ tests). `teamProfileEngine.js`-linjen :182-185 lægges i **S4-strukturens A2** (samme fil). | intet | economyEngine-delen: **ja** |
| **Y2** frontend senior-scope | `frontend/src/lib/seniorScope.ts`, `StandingsPage.jsx`, `RiderRankingsPage.jsx`, `ResultaterPage.jsx`, `DashboardPage.jsx` (kun :524), `RaceCentrePage.jsx` (+ e2e). Tager også S4-strukturens `retired_at`-filter. | intet | ingen |
| **Y3** ungdomspuljer | migration `…-youth-pools-seed.sql`, `youthPoolAssignment.js`, `backend/scripts/seedYouthPools.js` | Y1 + economyEngine-delen (seed-gate), ejer-valg af form | indirekte |
| **Y4** præmie + udtagelse + youth-standings-hook | `raceRunner.js`, `raceResultsEngine.js`, `prizePayoutEngine.js` (kun hvis nødvendigt), `riderEligibility.js`, `raceBinding.js`, `raceSelection.js`, `raceEntryGenerator.js` (+ tests) | intet (senior-default = uændret) | manuel udtagelse: api.js |
| **Kalender-sporet (Y5 + S4-struktur A3)** | `tierCalendarMaterializer.js`, `buildSeasonCalendar.js`, `divisionCalendarGenerator.js`, `calendarTierCaps.js`, `racePoolCatalog.prod.json` + golden, `SEASON_CUTOVER_RUNBOOK.md`, `CALENDAR_RULES.md` | S4-struktur A2 (retired_at) og Y3 (ungdomspuljer findes) før **kørsel**, ikke før bygning | ingen |
| **Y6** A6-kørsel | ingen kode; runbook-trin + ejer-go | S4 aktiv | ingen |
| **Y7** stilling/rangliste/visning | migration `youth_season_standings`, `youthStandings.js`, `refreshRankingMatviews.js`, `backend/routes/rankings.ts`, `frontend/src/lib/rankingsClient.ts`/`rankingsApi.ts`, `SquadPage.tsx`, ny `YouthRacesPage.tsx`, `squad.json` (en+da) | Y3 (puljer) | ingen, hvis hooket ligger i Y4's `raceRunner.js` |

## Ejer-valg der blokerer (ét ad gangen)

1. **Pyramideform for U23 og junior** (YOUTH_RULES §6 pkt. 3). A: U23 og junior spejler seniorens nye 1/2/4/4 med AI-trupper fordelt efter behov · B: én ungdomspulje-tier pr. trup i S4 (fx 4 puljer à ca. 24 hold), op/nedrykning tændes først, når felterne er målt. 👍 A giver samme struktur overalt · 👎 A har flest puljer at fylde og C1 fejlede for den fulde form ved spejling · 👍 B er mest robust (C1 23/9: "mest robust ved de mindste former") · 👎 B har ingen op/nedrykning i S4. **Anbefaling: B for S4**, A fra S5 når felterne er målt. Ingen evidens for de konkrete felt-tal efter A6; kør `measureYouthFieldGate.mjs` med A6-dry-run-populationen før valget.
2. **Antal AI-juniorer pr. hold** (`--juniors=N`, 0-10): kræves for A6-kørslen.
