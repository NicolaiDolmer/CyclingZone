# Post-relaunch fixes — batch-design (2026-06-22)

> Status: **KLAR TIL EKSEKVERING** når den igangværende forever-relaunch-session er færdig.
> Kilde: ejer-feedback 22/6 (11 punkter) + read-only audit + ejer-beslutninger (AskUserQuestion 22/6).
> Denne fil er IKKE committet endnu — følger med i første fix-PR (relaunch-session holder git-state).

## Ejer-beslutninger (låst 22/6)

1. **Startbalance** → 500.000 CZ$. Udrulning: **UPDATE eksisterende hold nu** (+ ændr konstant for fremtiden).
2. **Akademi-frie-ungdomsryttere** → må IKKE være gratis; skal koste den viste pris.
3. **Løbskalender** → **unikke løb per division (intet overlap)** via **global de-dup nu**; udvid katalog bagefter. + UI-overblik per pulje.
4. **Fyring/opsigelse** → **buyout-gebyr** (koster penge at bryde kontrakt).
5. **Kontraktforlængelse** → **genforhandl løn fra markedsværdi**.
6. **Bestyrelsestilfredshed 50%** → by design (neutral baseline-start, sæson 1 = observation). Ingen fix.

---

## Batch A — Kode-only (normal PR, ingen reset/cleanup)

### A1 · #2 Akademi-ryttere skal koste den viste pris (BUG)
- **Root:** `backend/lib/youthMarket.js` `signFreeAgentYouth` kalder `finalize_academy_acquisition` med `p_price: 0` + `p_finance_payload.amount: 0`, mens UI viser `market_value`.
- **Fix:**
  - `youthMarket.js`: sæt `p_price = value` (= `calculateRiderMarketValue(rider)`), `p_finance_payload.amount = -value`. Tilføj balance-tjek (RPC returnerer allerede `insufficient_balance` når `p_price > balance` — verificér at det propageres).
  - `frontend/src/lib/useAcademy.js`: håndtér `insufficient_balance`-fejl fra POST `/api/academy/free-agent/sign`.
  - `frontend/src/pages/AcademyPage.jsx`: vis fejlbesked "ikke råd".
  - i18n: `frontend/public/locales/{en,da}/academy.json` (+ backendMessages hvis ny kode).
- **RPC:** rør IKKE `finalize_academy_acquisition` — håndterer både p_price>0 og =0 korrekt.

### A2 · #3a Kalender-UI: gruppér/filtrér per pulje (UI-overblik)
- **Root:** `frontend/src/pages/RacesPage.jsx` henter løb UDEN `league_division_id`-filter → alle puljers løb blandes i én liste (= synlige dubletter).
- **Fix:** query skal inkludere `league_division_id`; vis kun spillerens egen puljes løb (eller sub-faner per division, mønster fra `StandingsPage.jsx`). Uafhængig af de-dup-backend (A2 hjælper selv hvis B1 udskydes).

### A3 · #10 Fyrings-/opsigelsesknap (NY FEATURE, buyout-gebyr)
- **Findes ikke** for seniorryttere (kun akademi-release via `academyGraduation.js`).
- **Datamodel:** release = `riders.team_id = NULL` + nulstil `salary/contract_length/contract_end_season`.
- **Mønster:** følg `POST /api/transfers` + `finalize_academy_acquisition`-RPC-stilen (advisory-lock, finance_transaction, idempotency).
- **Fix:**
  - Backend: nyt `POST /api/riders/:id/release` (`backend/routes/api.js`) — `requireAuth` + `marketWriteLimiter`, owner-check, retired-check.
  - **Buyout-gebyr (foreslået formel, juster efter smag):** `gebyr = round(rider.salary * resterende_sæsoner * BUYOUT_RATE)` hvor `resterende_sæsoner = max(1, contract_end_season - current_season + 1)`, `BUYOUT_RATE ≈ 0.5`. Træk via finance_transaction (type `rider_release_fee`). Bloker hvis ikke råd.
  - Frontend: tilføj "Release"-tab i `RiderActionModal` (`frontend/src/pages/TeamPage.jsx`) med gebyr-bekræftelse.
  - i18n: `{en,da}/team.json` + backendMessages.
  - **Balance-note:** gebyr-formel er balance-følsom → kalibrér (jf. simulér-før-ship); start konservativt.

### A4 · #11 Kontraktforlængelse (NY FEATURE, genforhandl løn fra market_value)
- **Findes ikke** (rider-kontrakter er i dag "frosne"; kun sponsor-kontrakter fornyes).
- **Fix:**
  - Backend: nyt `POST /api/riders/:id/extend-contract` (`backend/routes/api.js`) — owner/retired-check, balance-tjek.
  - **Ny løn fra markedsværdi:** genbrug eksisterende salary-formel (`computeFrozenSalary` / `value * ACADEMY.SALARY_RATE`) på aktuel `market_value` → sæt ny `salary`. Forlæng `contract_end_season` (vælg længde 1-3 eller fast +1).
  - Frontend: "Extend"-handling i `TeamPage.jsx` med ny-løn-preview + bekræftelse.
  - i18n: `{en,da}/team.json` + backendMessages.
  - **Note:** bryder "frosset løn"-antagelsen bevidst (ejer-besluttet) — verificér at intet andet afhænger af uforanderlig salary.

### A5 · #4-kode Træningshistorik: ryd ved fremtidige resets (BUG-forebyggelse)
- **Root:** `backend/lib/betaResetService.js` — `training_day_runs` mangler i `RESET_DELETE_TARGETS` og slettes ikke i `runFullBetaReset`.
- **Fix:** tilføj `training_day_runs` til reset-targets + ny `resetBetaTrainingHistory(supabase)` kaldt i `runFullBetaReset`. (Selve den nuværende stale-data ryddes i Batch C2.)

---

## Batch B — Kalender de-dup (kode + re-generering af live kalender)

### B1 · #3b Global de-dup: hvert løb kun én gang per sæson
- **Root:** `backend/lib/divisionCalendarGenerator.js` `generateDivisionCalendars` kører `selectSeasonRaces` pr. pulje uafhængigt → samme løb kan vælges af flere puljer. `seasonCalendarMaterializer.js` idempotens-nøgle `(league_division_id:pool_race_id)` TILLADER samme `pool_race_id` i flere puljer.
- **Katalog-fakta (fra `scripts/race_pool_seed.csv`, 121 løb):** 49 etapeløb total. Etapeløb per klasse: TourFrance 1, GiroVuelta 2, OtherWT-A 6, -B 4, -C 2, ProSeries 26, Class1 5, Class2 3. 72 endagsløb.
- **Loft:** 7 aktive puljer × 8 etapeløb-quota = 56 > 49 ⇒ fuld unikhed på etapeløb umulig med nuværende katalog. Værst i div 3 (tier 3): 4 puljer × 8 = 32, men ProSeries+Class1 har kun 31 etapeløb (og ProSeries deles med div 2).
- **Fix (global de-dup, graceful):**
  - Lav `generateDivisionCalendars` sekventiel: efter hver puljes udvælgelse, fjern de valgte `pool_race_id` fra kataloget for efterfølgende puljer (per delt klasse-segment).
  - Udvælgelses-rækkefølge: top-tier først (færrest alternativer), eller mindste klasse-segment først, så knappe etapeløb fordeles bedst.
  - **Graceful fallback:** hvis et klasse-segment løber tør for etapeløb, får den/de sidste puljer færre etapeløb (eller fyld med endagsløb) — **log eksplicit** hvilke puljer der blev beskåret (no silent caps).
  - Beslut: skal endagsløb også være globalt unikke? (72 stk → mere plads, men deles også). Default: ja, samme de-dup-mekanisme; fald tilbage til gentagelse kun hvis tomt.
- **Re-generering:** efter merge skal kalenderen re-materialiseres for sæson 1 (ryd nuværende `races`-kalender for sæson 1 + kør generator igen). Koordineres som ops-trin (rører live data) — ikke ren deploy.
- **Tests:** udvid `divisionCalendarGenerator.test.js` + `seasonCalendarMaterializer.test.js` med "intet `pool_race_id` går igen på tværs af puljer" + "beskæring logges når katalog tømmes".

### B2 · Udvid kataloget (ejer-indhold, efter B1)
- Tilføj ~10-15 flere etapeløb til race-sheetet (især ProSeries + Class 1) så alle 7 puljer kan få fuld 8-etapeløbs-quota unikt. Re-seed via `node backend/scripts/seedRacePool.js`. Ejer-opgave (indhold).

---

## Batch C — Live prod-data (ops, ikke ren deploy)

### C1 · #1 Startbalance → 500.000
- **Kode (fremtid):** `backend/lib/economyConstants.js:54` `INITIAL_BALANCE = 500000`; `backend/lib/betaResetService.js:6` `DEFAULT_BETA_BALANCE = 500000`; `database/schema.sql:59` `DEFAULT 500000`; `docs/GAME_INVARIANTS.md:11`. **Alle 4 i sync** ellers får nye signups/resets 800k igen.
- **Data (nu):** `UPDATE teams SET balance = 500000` for relevante hold. **KUN sikkert hvis ingen har brugt penge endnu** — verificér ingen handler er sket siden relaunch (auktioner/transfers/akademi-køb). Hvis nogen HAR handlet: overvej i stedet en samlet ekstra reset.

### C2 · #4-data Ryd nuværende træningshistorik
- `DELETE FROM training_day_runs` (engangs, hele tabellen) — rydder de stale rapporter brugeren ser nu. (Batch A5 forhindrer gentagelse fremover.)

---

## Batch D — Live-verifikation (read-only, NÅR relaunch er færdig)

Kør FØR konklusion; et øjebliksbillede midt i relaunch er misvisende.

### D1 · #8 Ingen hold i div 1+2
- `SELECT division, COUNT(*) FROM teams WHERE is_ai=true GROUP BY division;` → forvent ~24 i tier 1+2.
- `SELECT tier, COUNT(*) FROM league_divisions GROUP BY tier;` → forvent puljer oprettet.
- Hvis AI-hold mangler → relaunch nåede ikke `generateAndAllocateAiTeams` (`relaunchOrchestrator.js`) → re-run AI-fyld.
- Hvis AI-hold FINDES men ikke vises → frontend-filter/RLS i `StandingsPage.jsx` (linje ~137 `is_ai === false`-filter + `pool:league_division_id`-join/GRANT).

### D2 · #6 Låste funktioner
- Tjek `app_config`: `race_engine_v2_enabled`, `daily_training_enabled`, `academy_enabled` skal være `on`. Akademi vises allerede for ejer → sandsynligvis ON. Admin-flags (`auto_calendar/auto_prize/stage_scheduler`) er ikke spiller-facing.

### D3 · #5 Holdudtagelsesknap
- Knap → `/races?tab=calendar` → klik løb → `RaceSelectionPanel`. Panel er TOMT hvis `race_engine_v2` OFF eller ingen løb med status `scheduled`.
- Verificér: scheduled løb findes for spillerens pulje + flag ON. Overvej UX: lad knappen gå direkte til næste udtagbare løb (forbedring).

---

## Batch E — Patch notes (til sidst)

### E1 · #9 Samlet v5.94-note
- v5.93 er live; mangler en samlet "post-relaunch fixes"-entry. Skriv ny version i `scripts/patch-notes-source-snapshot.json` → `node scripts/transform-patch-notes.mjs` → `frontend/src/data/patchNotes.js`. **EN+DA** for hver ændring. Opdatér `docs/NOW.md` (CI kræver det). Dæk alle brugerrettede ændringer fra batch A-C.

---

## Anbefalet rækkefølge

1. **D (verifikation)** så snart relaunch er færdig → afklar #5/#6/#8 (kan vise sig ikke at kræve kode).
2. **A (kode-only)** i én eller flere PR'er (A1-A5).
3. **B1 (de-dup)** + re-generér kalender (ops-koordineret).
4. **C (data)** — C1 startbalance + C2 træningsryd (verificér ingen handler først).
5. **B2 (katalog-udvidelse)** når ejer har indhold.
6. **E (patch notes)** dækker alt.

## Åbne kalibreringer (ikke-blokerende)
- Buyout-gebyr-formel (A3) + forlængelses-løn-formel (A4): balance-følsomme, start konservativt, juster.
- Endagsløb global unikhed (B1): ja/nej.
- Kalender re-generering: ren ops-runbook-trin.
