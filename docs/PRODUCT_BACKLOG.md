# PRODUCT BACKLOG — Cycling Zone

_Formål: Kanonisk, token-effektiv roadmap for launch-kritisk arbejde og prioriterede kandidater._
_Regel: Færdige detaljer bor i `docs/FEATURE_STATUS.md` eller `docs/archive/`; denne fil må ikke vokse til done-history._

---

## Launch Roadmap

1. **Docs/context cleanup** ✅ aktivt lukket i denne docs-only slice
   - Slank backloggen til roadmap + candidate queues.
   - Ret stale context i core docs.
   - Fjern gamle pause-/ventestatusser og detaljeret done-history.

2. **Season-end side-effects repair before tuning**
   - ✅ Read-only live sanity bekræfter sæson 6-data (`98` races, `18` completed, `709` result rows, `25` standings rows).
   - ✅ Local preview-runtime mod live read-only data bekræfter løn/loan-interest/sponsor projection uden live write.
   - ✅ Contract audit fandt og fik repo-fix for finance-/notification type drift.
   - ✅ `processSeasonEnd` loader nu season-end teams/riders/board separat, fejler hårdt på Supabase errors og har regressionstest for live-like rider-load failure.
   - ✅ Admin repair endpoint er deployed og kan resume missing finance/board side effects uden division/status writes eller duplicate snapshots.
   - ✅ Live DB migration for finance-/notification types er applied.
   - ✅ Live repair er kørt med admin auth for sæson 6: `success=true`, `teamsProcessed=24`, `existingSalaryTransactions=5`, `existingBoardSnapshots=72`, `existingBoardSnapshotBoards=72`.
   - ⏳ Mangler admin/service-visible post-repair verification af finance rows, balances og finance-loans, fordi read-only RLS stadig viser `finance_transactions=0`.

3. **Economy baseline & simulation**
   - ✅ Read-only baseline er gennemført med sæson 7 teams/lån og sæson 6 resultater.
   - ✅ Gentagelig script: `backend/scripts/economyBaselineSimulation.js` (`npm run economy:baseline -- --markdown` fra `backend`).
   - ✅ Rapport: `docs/archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md`.
   - Korrektur: vi har et pointsystem for resultater, men ikke et færdigt præmiepenge-design. “Prize” tal i baseline må ikke behandles som færdig økonomi.
   - Resultat: current rules ser for hårde ud for aktive kompetente hold over lean Division 3, men større økonomituning skal vente til rigtige præmiepenge indgår i modellen.
   - Kandidatretning er kun scenarie-input, ikke beslutning: salary rate ca. `15% -> 10%`, division-aware sponsor D1 `600k` / D2 `400k` / D3 `260k`, og manuelle gældslofter D1 `1.2M` / D2 `900k` / D3 `600k`.

4. **Prize-money economy**
   - Design/implementér CZ$-præmiepenge før større økonomituning.
   - Adskil tydeligt resultatpoint fra kontante præmieudbetalinger.
   - Definér payout-skala pr. race class/result type og genkør baseline.

5. **Economy tuning implementation**
   - Vælg konkrete tal efter baseline med rigtige præmiepenge, ikke før.
   - Mulige knobs: startbalance, sponsor, salary rate, prize scale, debt ceilings, loan fees/renter og emergency loan behavior.
   - Centralisér økonomikonstanter/config hvis runtime stadig spreder dem.

6. **Post-economy launch readiness**
   - Re-run beta-reset/live sanity efter tuning.
   - Løft derefter prioriterede Data Depth-kandidater.

---

## Active Slice

### Post-repair verification

**Mål:** Verificér at live sæson 6 repair faktisk har de rigtige finance-/board-side effects, før økonomituning starter.

**Manager-værdi:** Økonomiændringer bliver fair og launchbare, fordi vi først ved om resultater, præmier, standings, lån, sponsor og board faktisk hænger sammen.

**Berørte runtime-paths:**
- Admin xlsx/Sheets import → `backend/lib/raceResultsEngine.js`
- Season-end preview/end → `backend/lib/economyEngine.js` + admin routes
- Finance loans/rider loans → `backend/lib/loanEngine.js`
- Resultater/Rangliste/Løbsarkiv UI

**Live facts efter season-end 2026-04-29:**
- Sæson 6 er `completed`; `Ankuva CT` og `Liams geder` er rykket op til Division 2.
- Den oprindelige root cause var `processSeasonEnd` med embedded `teams.riders(...)` uden error-check; dette er fixed og deployed.
- Live repair endpoint er kørt succesfuldt med admin auth.
- Read-only postcheck efter repair viser `board_plan_snapshots=72` og 24 teams med snapshots.
- Read-only postcheck kan stadig ikke se season 6 `finance_transactions`; dette vurderes som RLS/visibility-gap, men skal verificeres via admin/service-visible path før economy baseline.
- `Ankuva CT` og `Liams geder` står fortsat i Division 2 efter repair; ingen ekstra division movement set i read-only postcheck.

**Acceptance før economy baseline:**
- ✅ Live DB constraint migration er applied.
- ✅ `processSeasonEnd` fejler hårdt på load errors og loader teams/riders/board_profiles deterministisk.
- ✅ Regressionstest dækker live-like multiple-relationship error og finance/board execution.
- ✅ Sæson 6 repair har kørt finance/board only via deployed admin endpoint.
- ⏳ Admin/service-visible verification skal bekræfte salary rows, loan interest as debt, emergency loans, balances og notifications.
- ✅ Read-only postcheck bekræfter board snapshots og ingen ekstra division movement for de to kendte oprykkere.

---

## Next Slices

### Economy baseline & simulation

**Status:** ✅ Gennemført som `investigation` 2026-04-29.

**Remaining caveat:** Season 6 admin/service-visible post-repair finance verification er stadig launch-gate før live tuning/deploy, fordi read-only RLS ikke kan bevise finance rows.

**Output før implementation:**
- ✅ Scenario table for Division 1/2/3 med live current rules og lokal strict-fair candidate.
- ✅ Forecast for cash-in/cash-out over én sæsoncyklus.
- ✅ Anbefalet tuningpakke med konkrete tal og forventet effekt.

**Proof:** `docs/archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md` og `backend/scripts/economyBaselineSimulation.js`.

### Economy tuning implementation

**Task lane:** `small_feature` eller `refactor_safe`, afhængigt af om tal kun ændres eller config centraliseres.

**Blocked by:** Prize-money economy skal laves først, så større tuning ikke kalibreres mod et resultatpointsystem i stedet for faktiske CZ$-præmiepenge.

**Minimum tests:**
- Season start/end
- Loan engine
- Prize finance
- Salary recalculation
- Beta reset
- Finance UI/build hvis frontend påvirkes

---

## Candidate Queues

### Launch-Critical Candidates

- **Season 6 finance verification** — trigger: før økonomituning; admin/service-visible check af salary, loan-interest-as-debt, emergency loans, balances og notifications.
- **Prize-money economy** — trigger: før større økonomituning; pointsystemet findes, men CZ$-præmiepenge skal designes/implementeres og baseline skal køres igen.
- **Profile & Indstillinger route audit** — trigger: før launch sanity; `ProfilePage.jsx` findes, men `App.jsx` router aktuelt `/profile` via `ProfileRedirect`.
- **XLSX dependency/upload hardening** — trigger: før offentlig beta med admin upload i drift; `xlsx` har kendte high-severity advisories.
- **Docs/Help/Patch drift audit** — trigger: efter economy tuning og før release notes/lancering.

### Data Depth Candidates

- **Teams PCM mapping** — trigger: når økonomi og season-flow er stabile.
- **Cyclists PCM mapping** — trigger: sammen med eller lige efter team mapping.
- **3-sæsoners glidende gennemsnit for rangliste** — trigger: når flere sæsoner har sammenlignelige resultater.
- **External/pro-team result mapping policy** — trigger: før teamresultater skal påvirke managerhold i stedet for tekst-only historik.

### Engagement Candidates

- **Inbox/activity consolidation v2** — trigger: når launch-critical flows er stabile; må ikke genåbne chat mellem managers som default.
- **Discord-name matching** — trigger: når managerprofil/presence poleres.
- **Richer notification filters** — trigger: efter inbox IA er låst.

### Polish Candidates

- **Dark mode decision** — trigger: design/IA-afklaring før UI-retuning.
- **Rytteroversigt stat-line UI issue** — trigger: UI polish batch.
- **Secret achievement presentation audit** — trigger: hvis runtime igen viser hemmelige achievements før unlock.

---

## Locked Product Defaults

- `Liga` beholdes som navn indtil videre.
- Managers kan ikke sende beskeder til hinanden.
- `Min aktivitet` forbliver separat side under `Marked`.
- `Indbakke` er kun til systemhændelser, notifikationer og aktivitetsopsamling.
- Almindelige auktioner kræver minimum `Værdi`.
- Når en manager starter auktion på en AI-, bank- eller fri rytter, er startprisen også managerens første førende bud.
- `Garanteret salg` er eneste undtagelse og må fortsat bruge 50%.
- Økonomien skal tunes som **stram men fair**, ikke som let beta-start eller hardcore sim.
- Concrete economy numbers vælges først efter live data + simulation.

---

## Archived Done Proof

- `docs/archive/UCI_R1_SCRAPER_TOP_3000_DONE_PROOF.md`
- `docs/archive/RECENT_DONE_PROOF_2026-04-29.md`
- Runtime feature truth: `docs/FEATURE_STATUS.md`
