# Slice S-02 · Bestyrelse-redesign (sekventiel forhandling + sæson 0-lås + identitets-feedback + auto-accept)

**Status:** P0, ikke startet. Opdateret 2026-05-04.

## Mål
Tilpas bestyrelses-systemet til den nye sæson-rytme: sæson 1 = baseline (ingen plan, modifier 1.0), sæson 2+ = aktive planer forhandlet sekventielt 5yr→3yr→1yr-leveres baseret på sæson 1's identitets-data. Auto-accept ved deadline. Forhandlings-vindue lukker når 5 løbsdage er kørt.

## Runtime-evidens
- [backend/lib/boardEngine.js](backend/lib/boardEngine.js) — proposal/sign/renew/season-end-flow
- [backend/lib/boardConstants.js](backend/lib/boardConstants.js) — vægtning af KPI'er
- [backend/lib/boardEvaluation.js](backend/lib/boardEvaluation.js) — momentum + tilfredsheds-beregning
- [backend/lib/boardIdentity.js](backend/lib/boardIdentity.js) — afledt holdprofil (specialisering, U25, national kerne)
- [frontend/src/components/SetupWizardModal.jsx](frontend/src/components/SetupWizardModal.jsx) — eksisterende wizard (bygger ovenpå denne)
- [database/schema.sql](database/schema.sql) — `board_profiles`, `board_plan_snapshots`, `board_request_log`
- Nuværende v1.40-system: 3 parallelle planer kører fra sæson de oprettes (FEATURE_STATUS.md "Bestyrelse").

## Invariant der beskyttes
- Én board request pr. sæson pr. hold (DB-enforced via `board_request_log` UNIQUE INDEX).
- `budget_modifier` opdateres korrekt ved season-end for alle aktive planer (S7-B verificeret 2026-05-02).
- Eksisterende v1.40 board-tests (`backend/lib/boardEngine.test.js`) skal forblive grønne efter migration.

## Minimal change — opdelt i 2 underslices

### S-02a · Sekventiel forhandling + sæson 0-lås (1-2 sessioner)

1. **Migration `database/2026-05-XX-board-season-rhythm.sql`:**
   - Tilføj `board_profiles.activates_in_season_number INTEGER` (når denne plan aktiveres — typisk 2)
   - Tilføj `board_profiles.is_baseline BOOLEAN DEFAULT FALSE` (markerer sæson 1's baseline)
   - Tilføj `transfer_windows.board_negotiation_state TEXT CHECK (state IN ('locked', 'pending_5yr', 'pending_3yr', 'pending_1yr', 'complete'))`
2. **Beta-reset migrerer eksisterende 17 managers' planer** — alle eksisterende planer slettes (test-data, godkendt af bruger 2026-05-04).
3. **`backend/lib/boardEngine.js` udvides:**
   - Ny `createBaselineProfile(teamId, seasonId)` der opretter sæson 1's baseline-profil med `is_baseline=true`, modifier 1.0, ingen mål.
   - Ny `startSequentialNegotiation(teamId)` — sætter `transfer_windows.board_negotiation_state='pending_5yr'`.
   - Eksisterende `proposeNextPlan` retter sin "next plan type"-logik så den følger `5yr → 3yr → 1yr` rækkefølgen i stedet for "den der er udløbet først".
4. **`backend/cron.js`:** Ved sæson-1-slut, kør `startSequentialNegotiation` for hver human team.
5. **Frontend `BoardPage.jsx` + `SetupWizardModal.jsx`:** Læs `board_negotiation_state` og vis kun det aktuelle plan-type-trin. Tilføj "Næste plan: 3yr" / "Næste plan: 1yr" i wizard-headeren.

### S-02b · 1yr-auto-gen + identitets-feedback + auto-accept (1 session)

6. **`backend/lib/boardIdentity.js` udvides:**
   - Ny `computeSeasonOneIdentity(teamId, season1Id)` — kører ved 5yr-forhandling, returnerer:
     - `dominant_nationality` (mode af rytter-nationaliteter, hvis ≥30% af truppen)
     - `youth_share` (andel U25-ryttere)
     - `specialization` (sprint/gc/klassiker/allround mode af top-10-ryttere)
   - Identity feedes ind som GOAL-WEIGHTING i bestyrelsens forslag: hvis `dominant_nationality='FR'`, så vægt "fransk-rytter-ratio"-mål højere i 5yr-planens forslag.
7. **1yr-auto-gen funktion `generate1YrFromLongerPlans(teamId)`:**
   - Læser 5yr og 3yr (allerede forhandlet)
   - Splitter 3yr-mål i 3 årlige mål proportionalt + tilføjer 5yr's overordnede retning
   - Tilbyder manager **2 varianter at vælge mellem:**
     - **"Stabil"**: følger 3yr/5yr-vægtning rent
     - **"Resultatfokus nu"**: skubber økonomi/balance-mål 1 sæson + booster sportslige mål
   - Manager vælger én → 1yr-plan committes → state='complete'
8. **Auto-accept ved deadline:**
   - Cron-step i `processBoardCron`: tæller race_days kørt i sæson 1 (alle race_results, både stage og endags-løb).
   - Ved race_day_count >= 5 OG state != 'complete' → auto-accept resterende plan-typer som status quo (genbruger sidste sæsons plan; for første-gangs-managers: bestyrelsens default-forslag).
9. **Frontend `BoardPage` + Dashboard** countdown-banner: "⏰ N løbsdage tilbage før forhandlinger låser".
10. **Notifikationer:** T-3, T-1 race_day → notify manager.

## Verification path

1. **Migration tests:** Eksisterende boardEngine.test.js skal være grønne efter migration (med opdaterede fixtures).
2. **End-to-end manuelt på beta:**
   - Reset → opret sæson 1 → spil 1 løb → verificér ingen plan aktiv, modifier=1.0
   - Kør race-results-import for løb 1-5 → verificér deadline-alarm afsendt
   - Som manager: forhandl 5yr → 3yr → vælg 1yr-variant → verificér state='complete'
   - Som manager der INTET gør: kør cron 5+ race-days → verificér auto-accept fyrer
3. **Identity-feedback:** Opret testhold med 70% franske ryttere → verificér 5yr-forslag indeholder "Fransk identitet"-mål med >50% vægt.

## Out of scope
- Mid-season-join-flow for managers der joiner i sæson 3+ (P2).
- Liga-omdøb (P2).
- Ændring af KPI-vægtnings-konstanter i `boardConstants.js` — bevares.

## Forudsætninger
- S-01 (salary fix) leveret først — for at undgå at board-tests fejler pga. salary-drift.
- Beta-reset accepteret som migration-strategi for de 17 eksisterende managers' planer.

## Risiko og mitigation
- **Risiko:** Sekventiel forhandling føles tungt for managers (3 wizards i træk).
- **Mitigation:** "Hop til næste"-knap i wizard-footer; tour-steps; klar feedback "Du er på trin 2/3".
- **Risiko:** Identity-detection føles forudindtaget (manager "tvinges" mod fransk-vej).
- **Mitigation:** Identity vægter, men låser ikke — manager kan altid forhandle væk fra det, og 1yr-resultat-fokus-variant kan ignorere identity helt.

## Estimat
2-3 sessioner. Anbefalet split: S-02a (1-2) + S-02b (1).
