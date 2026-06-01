# Slice · Præmiepenge end-to-end-audit + brugbar preview

**Status:** 🆕 Planlægning + Fase 1 kørt (2026-06-01). **Ingen kode skrevet** — denne fil er gennemgangs-planen. Epic: [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893) (Fase 1-fund dokumenteret der). Kodning af præmie-ændringer starter først når audit-fund er bekræftet og scope er låst med ejer.

**Mål:** Sikre at *alt* under præmiepenge er korrekt — beregning, udbetaling, datakonsistens, notering — og at ProSeries-løbenes kategorier er rigtige. Plus en forbedret, brugbar post-import preview.

**Ejer-beslutninger (AskUserQuestion 2026-06-01):**
1. **Preview:** Forbedre den *eksisterende* post-import preview (ikke nyt forhånds-værktøj).
2. **Kategori-tjek:** Kun **ProSeries** vs. ægte **UCI 2026**-kalender.
3. **Output:** Dette dokument + opdelte GitHub-issues.
4. **Reconciliation-scope:** Sæson 1 og frem (ingen ældre data — beta startede i sæson 1).
5. **Issue-strategi:** Opret kun **epic nu**; under-issues skæres efter de faktiske fund i Fase 1+2 (ikke spekulativt).
6. **ProSeries-tjek:** Claude laver **web-udkast** (UCI 2026-kalender side-by-side mod seed-CSV); ejer validerer.
7. **Udbetaling:** Ingen præmier udbetales før hele gennemgangen er færdig og godkendt. (Korrektion 2026-06-01.)

## Krav-tilføjelser (ejer, 2026-06-01 runde 2)

**R1 — AI/holdsløse ryttere skal stige i værdi + løn (uden at hold modtager penge).**
- **Status: ✅ virker allerede for præmie-delen.** `updateRiderValues` ([economyEngine.js:1172-1208](backend/lib/economyEngine.js)) summerer `race_results.prize_money` pr. `rider_id` **uden team_id-filter** → `prize_earnings_bonus`. `market_value = max(5,uci_points)×4000 + prize_earnings_bonus` og `salary = round(market_value × 0.10)` er GENERATED kolonner der gælder *alle* ryttere.
- **Afklaret (ejer 2026-06-01):** `uci_points` forbliver **kun virkeligheden** (Google Sheets) — race-point driver IKKE uci_points. Værdi-formlen er uændret: ægte uci_points + spil-bidrag. Fri/AI-præmie udbetales **ikke** (bekræftet), men tæller for værdi/løn.

**R3 — Værdi-opdatering skal ske SAMTIDIG med præmie-udbetaling (ejer 2026-06-01).**
- **I dag:** `updateRiderValues` kører kun ved **sæson-slut** (`processDivisionEnd`) som snit af op til 3 *completed* sæsoner.
- **Ønske:** rytter-værdier genberegnes i samme øjeblik admin udbetaler præmier (`paySeasonPrizesToDate`).
- **Afklaret (ejer 2026-06-01):** behold **gennemsnits-modellen** (snit over sæsoner) — den aktive sæson skal indgå i gennemsnittet løbende, **ikke** lægges oveni som en ekstra fuld sum. Den løbende opdatering må ikke bryde "gennemsnit af sæsoner"-princippet.
- ⚠️ **Design-nuance:** nuværende beregning ser kun *completed* sæsoner. Den aktive sæson skal nu tælle som en (løbende voksende) sæson i snittet → præcis vægtning (tæller aktiv sæson som fuld divisor fra dag 1?) afklares i design.

**R2 — Sammenkædet/relativ point-model med master-kategori (UX — gør det brugervenligt).**
- **Problem i dag:** ~1.500-2.000 absolutte point-felter, redigeret **ét ad gangen** (PUT pr. id i `RacePointsAdminSection.jsx`). At ændre noget = mange manuelle handlinger.
- **Ønske (ejer 2026-06-01):** Sæt **én master-kategori (fx Tour de France)** fuldt ud — point pr. placering **+ ratioer mellem result-typer** ("pointtrøje = 250% af etapesejr", "bjergtrøje = X% af etapesejr"). Definér derefter **per-kategori-skalering** så **alle andre kategorier kaskaderer automatisk nedad** efter deres niveau (Giro/Vuelta = a%, Monuments = b%, ProSeries = c% … af masteren). Ændrer man masteren, følger resten med.
- **To ratio-akser:** (1) mellem result-typer inden for en kategori; (2) mellem kategorier (master → afledte).
- **Eksisterende grundlag:** `uciRacePointDefaults.js` har *allerede* hardcoded begge slags ratio (sekundære klassementer = ~% af GC; kategorier afledt af hinanden) — konceptet findes, bare ikke bruger-styret/dynamisk.
- **Foreløbigt omfang (ikke designet endnu):** DB (master-værdier + ratio-tabel/-felter, eller derived-lag) · nyt bulk-/generate-endpoint der kaskaderer · ny master+ratio-builder-UI med preview. `expectedPrizeCalculator` + læse-siden uændret. → Egen design-runde + under-issue; sandsynligvis den tungeste del.

---

## Systemkortlægning (verificeret i kode 2026-06-01)

**Kæden:**
```
race_pool (kategori) → seasonRaceSelection → races (sæson-instans)
   → import resultater (XLSX / Google Sheets / PCM)
   → race_results.prize_money = points × PRIZE_PER_POINT (1.500 CZ$)
   → admin: preview → pay-prizes-to-date
   → finance_transactions (type='prize') → teams.balance
```

**Nøglefiler:**
| Område | Fil |
|--------|-----|
| Præmie-konstant | `backend/lib/raceResultsEngine.js:13` (+ dublet i `adminImportResultsHandler.js`) |
| Point-defaults pr. klasse | `backend/lib/uciRacePointDefaults.js` |
| Import → prize_money | `adminImportResultsHandler.js`, `raceResultsEngine.js`, `raceResultsSheetSync.js` |
| Preview + payout | `backend/lib/prizePayoutEngine.js` |
| Atomisk balance-skrivning | `backend/lib/balanceRpc.js` + `database/2026-05-09-balance-rpc.sql` |
| Dobbeltudbetaling-gate | `database/2026-05-02-prize-payout-control.sql` (`prize_paid_at`) + `idempotency_key` |
| Admin-UI | `frontend/src/pages/admin/AdminEconomyTab.jsx` ("Præmie-udbetaling") |
| Kategori-data | `scripts/race_pool_seed.csv`, `database/2026-05-09-race-pool.sql`, `backend/lib/racePoolImport.js`, `frontend/src/lib/uciRaceClasses.js` |
| Forhånds-estimat | `frontend/src/lib/expectedPrizeCalculator.js` (race-card badges) |

**9 kategorier:** TourFrance · GiroVuelta · Monuments · OtherWorldTour A/B/C · **ProSeries** · Class1 · Class2.

**Risici allerede synlige (skal verificeres, ikke antages):**
- `PRIZE_PER_POINT` defineret **2 steder** → drift-risiko.
- `race_class` denormaliseret i **race_pool + races + race_points + frontend** → konsistens-risiko.
- Områdets bug-historik: v3.66 sheet-sync skrev `prize_money` **uden** ×1500.
- Preview henter "pending" fra `race_results`, men "paid" fra `finance_transactions` — **to kilder, aldrig reconciled**.
- Preview kræver `status='completed'` — løb i anden status er usynlige.
- `GAME_INVARIANTS.md` nævner ikke `PRIZE_PER_POINT`.

---

## Arbejdsdeling

### 🤖 Hvad Claude verificerer (objektivt — kode/data)
- **A. Beregnings-korrekthed:** at `prize_money = points × 1500` i *alle* import-stier (XLSX, Google Sheets, PCM); at PRIZE_PER_POINT-dubletten har samme værdi; at v3.66-bug-typen ikke er tilbage.
- **B. Datakonsistens:** `race_class` ens på tværs af de 4 kilder; at alle 9 klasser har komplette `race_points`-rækker for alle relevante result-typer (ingen huller → 0-præmie).
- **C. Payout-reconciliation (prod, read-only):** for hvert betalt løb: matcher Σ`race_results.prize_money` Σ`finance_transactions(type=prize)`? Find mismatch, dobbeltbetalinger, eller løb med tomme udbetalinger.
- **D. Notering-audit:** GAME_INVARIANTS / FEATURE_STATUS / ARCHITECTURE / DOMAIN_REFERENCE — ret det der er forkert/manglende.
- **E. Preview-gap-analyse:** konkret liste over hvad nuværende preview ikke viser.
- **F. ProSeries-dataudtræk:** komplet liste af alle ProSeries-løb i seed/race_pool (navn, dato, etaper, type) — **råmateriale til din UCI-verifikation.**

### 🙋 Hvad ejer (Nicolai) verificerer (domæne / ekstern viden)
- **ProSeries-kategori-korrekthed mod ægte UCI 2026:** er hvert løb i listen reelt ProSeries? Mangler der ProSeries-løb? Er nogen fejlklassificeret? (Claude leverer listen + en tjek-skabelon.)
- **Præmie-NIVEAUER (game design):** er point-skalaen × 1500 de rigtige beløb?
- **Faktiske prod-udbetalinger:** ser tallene rigtige ud i admin-panelet?
- **Preview-scope:** vælg blandt de konkrete forbedrings-forslag (Fase 4).

### 🤝 Sammen
- Definere acceptkriterier for "korrekt præmiepenge".
- Låse preview-forbedringernes scope før kodning.

---

## Faseopdelt plan

### Fase 0 — Acceptkriterier (sammen, ingen kode)
Definér hvad "korrekt" betyder, fx: *enhver completed race har prize_money>0 på de forventede placeringer · Σresults = Σfinance pr. betalt løb · ingen rytter får præmie for et hold de ikke var på · hver kategori har fuld point-tabel.*

### Fase 1 — Beregnings- & datakonsistens-audit (Claude, read-only)
A + B ovenfor. Leverer findings-liste (✅ korrekt / ⚠️ mistænkeligt / ❌ fejl) med fil:linje.

### Fase 2 — Payout-reconciliation mod prod (Claude, read-only SQL via Supabase MCP)
C ovenfor. Leverer en reconciliations-tabel pr. sæson/løb + liste over evt. afvigelser.

### Fase 3 — ProSeries-kategori-verifikation (delt)
Claude leverer dataudtræk + tjek-skabelon (F). Ejer krydstjekker mod UCI 2026. Fund samles som rettelsesliste (seed-CSV / race_pool).

**✅ Web-udkast leveret 2026-06-01** ([#897-kommentar](https://github.com/NicolaiDolmer/CyclingZone/issues/897#issuecomment-4594442812)). Konklusion: alle 61 seed-ProSeries-løb matcher UCI 2026 ProSeries 1:1 — **0 fejlklassificerede, 0 manglende**. 3 afvigelser til ejer-beslutning: (1) **Maryland Cycling Classic** reklassificeret endags→3-dages etapeløb i UCI 2026 (eneste reelle type-mismatch; men løbet er status-usikkert) · (2) **Tour of Norway** aflyst 2026 (finansiering trukket) · (3) **Surf Coast Classic** klasse korrekt men 2026-udgave aflyst (brandfare). Afventer ejer-validering før evt. seed-CSV-rettelse.

### Fase 4 — Preview-forbedring: design (sammen, ingen kode endnu)
Konkrete kandidater til den forbedrede post-import preview:
1. **Rytter/placerings-breakdown** pr. hold pr. løb (hvorfor får holdet beløbet — hvilke placeringer/trøjer).
2. **Forventet-vs-faktisk:** vis beregnet pulje fra `race_points` ved siden af importeret `prize_money` → fanger import-fejl (fx ×1500-bug).
3. **Reconciliation-kolonne:** Σresults vs. Σfinance for betalte løb, med ⚠️ ved mismatch.
4. **Sanity-warnings:** løb hvor alle prize_money=0, manglende placeringer, eller skæv fordeling.
5. **Sæson- + kategori-totaler:** samlet udbetalt/udestående pr. kategori.
6. **Status-bredde:** vis også ikke-completed løb (med tydelig markering).
7. (Evt.) **Eksport** til CSV.
→ Ejer vælger hvilke der er i scope.

### Fase 5 — Notering-audit (Claude)
D ovenfor. Docs-only, kan landes løbende.

### Fase 6 — Implementering (først efter scope-lås)
Rettelser fra Fase 1-3 + preview-forbedringer fra Fase 4. **Kun her skrives kode.** PR-flow, tests, patch notes.

---

## GitHub-issues (oprettet 2026-06-01)
- **Epic [#893](https://github.com/NicolaiDolmer/CyclingZone/issues/893)** — parent, linker dette dokument.
- **[#894](https://github.com/NicolaiDolmer/CyclingZone/issues/894)** — R2: master-kategori relativ point-model (tungest; design FØR kode).
- **[#895](https://github.com/NicolaiDolmer/CyclingZone/issues/895)** — R3: værdi opdateres ved udbetaling (gennemsnits-model).
- **[#896](https://github.com/NicolaiDolmer/CyclingZone/issues/896)** — forbedret post-import preview.
- **[#897](https://github.com/NicolaiDolmer/CyclingZone/issues/897)** — ProSeries vs UCI 2026 (web-udkast + ejer-validering).
- **[#898](https://github.com/NicolaiDolmer/CyclingZone/issues/898)** — datakvalitet (PRIZE_PER_POINT single-source · manglende-rytter-rækker · result_type-ensretning). **✅ Adresseret (kode-PR):** backend SSOT = `economyConstants.js` (raceResultsEngine re-eksporterer), frontend SSOT = `expectedPrizeCalculator.js`; sheet-sync `Klassiker`→`gc`. **Data-fund (prod, read-only):** 0 forældreløse præmie-rækker — FK `race_results_rider_id_fkey ON DELETE SET NULL` gør dem strukturelt umulige, så Fase 1's "4 rækker / 60.000 CZ$" er ikke reproducerbart (alle 6711 rytter-rækker matcher; 360 NULL-rækker = legitime `team`-resultater). 0 inkonsistente single-race `result_type` (alle 1677 = `gc`). **→ ingen data-migration nødvendig.**

## Åbne afklaringspunkter
- Acceptkriterier (Fase 0) ikke fastlagt endnu — Claude foreslår, ejer godkender.
- Preview-forbedringernes konkrete scope (Fase 4) ikke valgt — Claude-anbefaling: forventet-vs-faktisk + reconciliation-kolonne som kerne.
- ~~Reconciliation-scope~~ ✅ afklaret: sæson 1 og frem.
