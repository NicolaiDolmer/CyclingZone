# Generalprøve af sæsonskiftet S4 → S5 (25/10), kørt 17/10

Issue: #6751. Tørkørsel uden prod-skrivning. Alle prod-læsninger er SELECT via Supabase MCP eller de eksisterende tørkørsler gennem `infisical run --env=prod --silent --` (scripts uden skrive-flag). Staging (`staging-cutover`) er ikke brugt: dens data er fra 23/8 og kan ikke vise S4→S5, og ingen del krævede skrivning.

Præcise tal, holdnavne og id'er står kun privat i `balance-internals/6751/2026-10-17-generalproeve-tal.md` (gitignoreret). Her står status, mekanisme og antal på et niveau, der ikke afslører hold.

## Samlet dom

**Ikke klar til 25/10 uden handling.** Kode, tests og senior-kalender er grønne. Seks ting skal afgøres eller rettes før skiftet; fire af dem er ejer-beslutninger.

| # | Del | Status | Fund | Rettelse |
|---|---|---|---|---|
| 1 | Preflight (kode, tests, kendte risici) | gul | GO; én advarsel (#2840 dagsløn, åben, `season_upfront` er sikker). To af de manuelle SQL-blokke var forældede. | Rettet i denne PR |
| 2 | S5-kalender, senior | grøn | Findes, bundet korrekt, ingen huller eller dobbeltbookinger | – |
| 3 | S5-kalender, U23/junior | **rød** | 0 ungdomsløb for S5 | #6667 (eksisterende) |
| 4 | Løbsdags-gate (#5904) | **rød** | Ingen bestået rapport; sidste løbsdag fejler i dry-run | #6772 |
| 5 | Op/nedrykning | **rød** | D3 → D4-nedrykning udebliver | #6771 |
| 6 | Transitions-readiness (vinduets markører) | **rød** | S4-vinduet mangler `closed_at`/`squad_enforcement_completed_at` | #5855 (eksisterende) |
| 7 | Oprykning/graduering | gul | Uden flaget sælges/frigives en del ungdomsryttere ved fuld trup | #6710 (flag 18/10) |
| 8 | Kontraktudløb | gul | Stort udløb; samlet varsel ikke sendt siden juli; tørkørslen tæller ikke ungdom | #6774 |
| 9 | Bestyrelse | gul | 20 S3-mandater står stadig aktive | #6773 |
| 10 | Akademi-drift ved S5-løn | gul | Flaget står stadig off fra S3→S4-undtagelsen | #6775 |
| 11 | Aldring/pension | grøn | Prøvekørslen kører; kontrollerne er 0/0. Flag-valget er ejerens (planen: 23/10) | – |
| 12 | Akademi (graduering, intake) | grøn | 0 manglende graduerings-vinduer; køen kører | – |
| 13 | Præmier og økonomi | grøn | Alle afsluttede seniorløb er udbetalt; transitionsplanen regner uden fejl | – |
| 14 | Parkering + puljestørrelse | grøn | Parkering kører som designet; league-size-auditten har 0 fund | – |
| 15 | Søndagens værdikørsel 25/10 | grøn | Venter på skiftet (#5842/PR #6403) | – |

## 1. Preflight

**Kørt:** `pwsh -File scripts/preflight-season-cutover.ps1 -FromSeasonNumber 4 -ToSeasonNumber 5` (13 testfiler, kode-tilstedeværelse, GitHub-status). Derefter de manuelle SQL-blokke read-only mod prod.

**Resultat:** GO, 10 ok / 1 advarsel / 0 NO-GO. Flagene står som runbooken forventer: `season_end_skip_division_movement` off, `auto_calendar_enabled` mangler (= off, så transitionen bygger ikke kalenderen igen), form-reset `decay` med claim-guard (#3266 lukket), `wage_deduction_mode = season_upfront`, `stage_scheduler`, `auto_prize` og `auto_entry_generator` on.

**Fund (rettet her):**
- Blokken for D4-destinationspuljer brugte `races.division`, som ikke findes. Forespørgslen fejlede mod prod.
- Puljetræet for D3 → D4 antog to D4-børn pr. D3-pulje (1/2/4/8). S4-formen er 1/2/4/4 uden pensionerede puljer, så forholdet er 1:1. Blokken viser nu puljetræet som `buildPoolTree` ser det, med `pool_all_real` pr. pulje.
- "Ubetalte præmier" talte U23-/juniorløb med. Ungdomsløb udbetaler aldrig præmie, så tallet kunne aldrig blive 0. Filtreret til senior.

## 2. S5-kalender, senior (grøn)

**Kørt:** `node backend/scripts/dev/calendarGoldenDiff.mjs` (offline) + SELECT på `races`, `race_stage_schedule`, `race_stage_profiles`, `league_divisions`.

- S5 er `upcoming` med start 28/10. Seniorkalenderen har løb i alle 11 aktive puljer (1/2/4/4), 0 i pensionerede puljer og 0 i fortiden.
- Hver pulje har etaper på alle 32 datoer fra 28/10 til 28/11, med et fast antal etaper pr. dag pr. division. Ingen huller.
- Ingen dobbeltbooking: 0 puljer med to etaper i samme slot, 0 overlappende Grand Tours. Etapeantal = skemarækker = profilrækker for alle løb; alle etaper har `game_day`; alle løb har `pool_race_id`.
- Den gyldne diff: identisk med snapshottet, 0 brud på hårde invarianter. **Bemærk:** diffen kører på den committede offline-fixture (S3-vinduet), ikke på prods S5-kalender. Dens "S5 benchmark-gate"-sektion er målt, ikke dømt (#6367 er åben). Den siger altså intet om S5-kalenderens profiler.

**Til ejeren:** S5 slutter 28/11, samme dato som planens S6-start ("to sæsoner på samme dato", #5833 §5 risiko 3). Det berører ikke 25/10.

## 3. S5-kalender, U23/junior (rød, eksisterende issue)

0 U23- og 0 juniorløb for S5. S4 havde begge. Ungdomsgrupperne findes (10 + 10). Byggekravene står i #6667 (felter løftes, flere U23-løbsdage, byggeregler) og skal være på plads før `--squad u23`/`--squad junior` køres. **Skal ligge før 28/10.**

## 4. Løbsdags-gaten (rød) → #6772

**Kørt:** `node backend/scripts/loadtestRaceDay.mjs` (offline). Profilen `normal` består. `season-last-day` fejler på `tick_duration` og `ticks_skipped`: seniorens og U23's afslutninger samles i ét tick kl. 15. Den profil er S4's sidste løbsdag, altså selve skiftedagen.

Runbookens blokerende gate kræver en rapport med `loadTestPassed: true`. Den eneste rapport (10/10) er `BLOCKED` på for lille resultatvolumen på staging.

## 5. Op/nedrykning (rød) → #6771

**Kørt:** SELECT på puljer og hold + kodelæsning af `processDivisionEnd`/`buildPoolTree` (`economyEngine.js`).

- D1 ↔ D2 og D2 ↔ D3 kører normalt. Ingen pulje kan overfyldes: AI-fyldet giver plads.
- **D3 → D4: ingen nedrykning.** Relegering til D4 kræver at D3-puljen er helt uden AI (`poolAllReal`). Alle fire D3-puljer har AI, så gaten er lukket i dem alle. D4 → D3-oprykningen kører stadig. Reglen er fra tiden med sovende D4-puljer; S4-formen har aktive D4-puljer. Spillervendt regel → ejer-beslutning.

## 6. Transitions-readiness (rød, eksisterende issue)

**Kørt:** `node backend/scripts/simulateSeasonTransitionDryRun.js` (dry-run returnerer efter `buildTransitionPlan`, der kun læser; verificeret i koden).

S4's transfervindue står `closed`, men uden `closed_at` og `squad_enforcement_completed_at`. `seasonTransitionReadiness.js` kræver begge, så "Udfør sæsonskifte" vil blive stoppet af gaten. Ved S3→S4 blev markørerne sat i hånden (runbookens S3→S4-læring 5). #5855 er stadig åben; uden en rettelse skal den manuelle normalisering gentages 25/10 med eget go.

Øvrigt fra planen: "Allerede transitioneret? JA" vises, fordi S5-rækken findes som `upcoming`. Det er forventet (transitionen promoverer selv rækken), men etiketten er misvisende. Carry-over: træningsplaner kopieres; holdstrategiernes prioriterede S4-løb bliver forældede og revalideres.

## 7. Oprykning/graduering (gul, eksisterende issue)

**Kørt:** `node backend/scripts/dryrun-6710-promotion-pending.js --season 5`.

Langt de fleste ungdomsryttere, der når Graduation Day, rykker op. En mindre gruppe på en håndfuld hold kan ikke, fordi måltruppen er fuld. Med `promotion_pending_enabled` off (i dag) bliver de solgt eller frigivet; med flaget on får de "Afventer oprykning". Flaget tændes efter planen 18/10 sammen med help.json (#6710). 0 akademiryttere mangler et graduerings-vindue (`detect-missed-graduates.js`).

## 8. Kontraktudløb (gul) → #6774

**Kørt:** `dryRunContractExpirySeasonEnd.js`, `notifySeasonTransitionRisk.js` (dry-run) + SELECT.

Omkring 4 af 10 seniorryttere på menneskehold har kontrakt, der udløber ved S4. Udløbne ungdomskontrakter frigives nu også (#5864). Fornyer ingen, ender langt over halvdelen af menneskeholdene under 8 seniorryttere. AI-holdenes udløbende kontrakter fornyes automatisk. Spillerne fik en "Contract expiring"-besked ved S3→S4, men det samlede risiko-varsel er ikke sendt siden 26/7. Tørkørslen tæller ikke ungdomstrupperne med og udskriver holdnavne.

## 9. Bestyrelse (gul) → #6773

**Kørt:** `proposeNextMandateDryRun.js`, `boardFormationGoalsDryRun.js` + SELECT på `board_mandates`/`board_relations`.

- Årsmødet kan foreslå S5-mandater for alle hold med aktivt mandat: 0 uden relation, 0 med mål-antal uden for 3-5. Næsten alle aktive menneskehold har et aktivt S4-mandat; et lille antal står som `proposed` med auto-accept før 25/10. Det dækker #6130 for de aktive hold.
- **Fund:** 20 S3-mandater står stadig `active`. Tørkørslen simulerede derfor nogle hold to gange. Bestyrelsesrummet vælger det senest underskrevne aktive mandat uden sæsonfilter, så nogle hold ser sandsynligvis S3-mandatet. Samme mønster kan gentage sig for forslag, der står åbne over 25/10.
- #5849/#6122 (gentagne beskeder, "3-års plan"-prompten) er åbne og rammer igen ved skiftet. Konflikt-stien i `boardMandateMeeting.js` (dublet-milepæl) er håndteret.
- Formations-dry-run (#2022, gammel `board_profiles`-model): nye hold får stadig de statiske fallback-mål i simuleringen. Om den gamle model stadig påvirker sæsonslut-vurderingen med mandatmodellen tændt, er ikke afklaret her.

## 10. Akademi-drift ved S5-løn (gul) → #6775

`academy_drift_enabled` står stadig `off` fra undtagelsen ved S3→S4. Uden en beslutning opkræves heller ingen drift ved S5-start.

## 11. Aldring og pension (grøn)

**Kørt:** `backend/scripts/dev/agingV2DryRun6110.mjs` (privat rapport i `balance-internals/6110/`) + pensions-SQL fra preflighten.

- Prøvekørslen gennemløber produktionens egen udviklingsmotor mod et øjebliksbillede. Begge kontroller holder (ingen vækst og ingen tekniske/mentale ændringer ved skiftet med det nye flag). `development_v2_aging_enabled` er off; planen (#5833 §4) lægger valget til 23/10.
- Pensionsvinduet måles på S4-alderen. Antallet af kandidater på menneskehold svarer til planens måling 16/10. #4153 (løn til ryttere, der pensioneres i samme skifte) er lukket.
- Fødselsdage/daglig aldring er ikke tændt og indgår ikke i 25/10.

## 12. Akademi: graduering og intake (grøn)

`detect-missed-graduates.js`: 0 mangler. `academyIntakeQueueHealth.mjs`: køen kører i catch-up-tilstand med de faste ugentlige kuld; ellers kun små dags-batches. Sæson-intaket (`season_academy_intake_enabled`) er off som ved de forrige skift.

## 13. Præmier og økonomi (grøn)

- 0 afsluttede S4-seniorløb uden præmieudbetaling, 0 ventende resultater, 0 halvt finaliserede løb. De resterende S4-løb afvikles frem til 25/10 kl. 15 (dansk tid).
- Transitionsplanen regner sponsor, signing-bonus og variabel pulje uden fejl. `upkeep_per_race_day` er on, så intet fladt upkeep trækkes ved sæsonstart.
- Én transition siden 27/9 og 0 form-reset-kørsler for S5: claim-guarden har en ren start.

## 14. Parkering og puljestørrelse (grøn)

`parkingDryRun.js`: et mindre antal inaktive menneskehold parkeres (flest i D3), 0 genindplaceres. Hullerne fyldes af AI. `audit-league-size-invariant.js`: 0 fund (ét AI-hold venter på igangværende løb).

## 15. Søndagens værdikørsel 25/10 (grøn)

25/10 er en søndag. `sundayValueSweep.resolveTransitionGate` blokerer, så længe den aktive sæsons sidste løb er i dag eller tidligere, og så længe ingen ny sæson er aktiv. S4's sidste løb starter 25/10, så kørslen venter til efter skiftet (én opdatering, #5842).

**Tjek før 25/10:** `season_transition_planned_at` står på 25/10 kl. 15:30 dansk tid (sommertiden slutter samme nat). Seneste S4-etape starter kl. 15:00. Bekræft at det er det ønskede tidspunkt for auktionsvagten (#4004/#5871).

## Ny orkestrering

`backend/scripts/dev/seasonTransitionRehearsal.mjs` kører delene ovenfor i fast rækkefølge (offline først, prod kun med `--prod` og kun gennem infisical) og samler status pr. trin. Den afviser ethvert trin med et skrive-flag, før første trin kører. Første prod-trin (transitionsplanen) er en vagt: er prods aktive sæson ikke `--from`, springes resten af prod-trinene over, så rapporten aldrig blander to skift. Rå output lander kun i `balance-internals/<issue>/`; konsollen viser trin, status og exit. Test: `backend/scripts/dev/seasonTransitionRehearsal.test.mjs`.

```powershell
node backend/scripts/dev/seasonTransitionRehearsal.mjs --list
node backend/scripts/dev/seasonTransitionRehearsal.mjs --prod --from=4
```

Kørsel 17/10: 1 rødt trin (løbsdags-dry-run), 3 gule (preflight, transitionsplan, oprykning), resten grønne eller kørt til aflæsning.

## Hvad generalprøven IKKE dækker

- Selve skrive-kæden (`transitionToNextSeason` uden `dryRun`, `processSeasonEnd`) er ikke kørt nogen steder. Staging har for gamle data til en meningsfuld S4→S5-kørsel.
- Den fulde staging-løbsdag (#5904) er ikke kørt.
- Ungdomskalenderne kan ikke prøves, før de er bygget.
- Tallene ændrer sig frem til 25/10. Kør orkestreringen igen 24/10.
