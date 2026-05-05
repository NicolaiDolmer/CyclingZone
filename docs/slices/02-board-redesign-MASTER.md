# S-02 · Bestyrelse-redesign — MASTER ROADMAP

**Skrevet:** 2026-05-05 efter Vision-lock-session 1A.
**Erstatter:** `02-board-redesign-sequential.md` (er nu S-02a — én sub-slice af denne master).
**Status:** Vision låst. Mekanik- og UX-spørgsmål åbne (Q-batch 1B + 1C). Ingen kode endnu.

---

## Nordstjerne

**"Verdens bedste bestyrelses-funktion til et cykelmanager-spil — Football Manager-inspireret immersion, men simpelt at læse på overfladen."**

Manageren skal føle: *"Jeg bygger et hold over tid, og bestyrelsen reagerer realistisk som personer — ikke kun på om jeg vinder."*

---

## Vision-lock — låste beslutninger (Q-batch 1A, 2026-05-05)

| # | Spørgsmål | Beslutning |
|---|-----------|------------|
| 1 | Navngivne board-members? | **Ja — 5-7 håndlavede arketyper**, hver med 30-50 reaktions-templates. Tildeles ved klub-oprettelse. Udskiftes ved 2× plan-udløb i træk under 30% tilfredshed. |
| 2 | Plan-rytme | **Sæson 1 = baseline (intet pres)**. Sæson 2 = onboarding-forhandling sekventielt 5yr→3yr→1yr. Derefter 1yr hver sæson, 3yr hver 3., 5yr hver 5. — naturligt forskudt. |
| 3 | "Drej men skift ikke" | **3 låse:** (a) én MAJOR retning-skift pr. plan-livscyklus, (b) board requests blokeret i sidste 5 race-days før sæsonslut, (c) mid-cycle 5yr/3yr-låsning indtil ≥50% gennemført ELLER >30% satisfaction-delta åbner re-orientering. |
| 4 | Konsekvens-dybde | **6-lags tier (mild→hård):** sponsor-modifier · salary cap · signing-restriktioner · tvunget listing · sponsor-pull-out-event · bonus-budget-tilbud (positiv). Aldrig fyring. |
| 5 | Manglende V1-features | **Alle med:** stjernekrav som mål · monument-podie · etape-trøjer (point/bjerg/young) · profil-signering · profitable transfers · U25-udviklingsdelta · klub-DNA · manager-konkurrence-mål · mid-season aktiv påvirkning · tradeoff-låsninger. |
| 6 | Migration | **Full reset** af alle eksisterende managers' board-data (planer, satisfaction, snapshots, cumulative_stats, request_log). |
| 7 | Wizard-model | **Hybrid B+A:** primær = strategisk dashboard (3 paneler 5yr/3yr/1yr side om side, klikbare mål). Forhandling af enkelt-mål åbner mini-dialog hvor relevant board-member "taler". Veteran-venligt + immersivt. |
| 8 | AI-hold | **Manager-only.** Ingen AI-board for AI-/bank-hold. |

**Skalerings-præmis:** Manager-tal vokser løbende (~19 nu, mere efter open beta). Al kode skal håndtere variabelt antal managers — ingen hardcoded loops eller arrays baseret på fast antal.

---

## Sub-slice-roadmap (9 implementerings-slices + polish)

Hver sub-slice = 1 session. Total: ~10-12 sessioner. Dependencies markeret.

### S-02a · Foundation: Sekventiel forhandling + sæson-1-baseline
**Dep:** ingen.
**Erstatter:** `02-board-redesign-sequential.md`.
**Leverer:**
- Migration: `board_profiles.activates_in_season_number`, `is_baseline`, `transfer_windows.board_negotiation_state`
- `boardEngine`: `createBaselineProfile`, `startSequentialNegotiation`; `proposeNextPlan` følger 5yr→3yr→1yr-rækkefølge
- `cron.js`: ved sæson-1-slut, kør `startSequentialNegotiation` for hver human team
- Frontend: `BoardPage` + wizard læser `board_negotiation_state`, viser kun aktuelt trin
- Beta-reset: alle eksisterende planer slettes (godkendt full reset)

### S-02b · 1yr-auto-gen + auto-accept + identity-feeding
**Dep:** S-02a.
**Leverer:**
- `boardIdentity.computeSeasonOneIdentity` — afleder dominant_nationality, youth_share, specialization fra sæson 1's hold
- Identity feedes ind som goal-weighting i 5yr-forslag
- `generate1YrFromLongerPlans` — 2 varianter ("Stabil" / "Resultatfokus nu")
- Auto-accept-cron ved race_day_count ≥ 5
- Notifikationer T-3, T-1 race_day
- Countdown-banner

### S-02c · Navngivne board-members
**Dep:** S-02a.
**Leverer:**
- DB: `board_members` (5-7 arketyper-rows seedet) + `team_board_members` (mapping team→members med tildelings-tidspunkt)
- Hver arketype har personality-akser + reaktions-template-pool
- `boardEvaluation` udvidet til at sample reaktion fra dominerende medlem ved feedback-build
- UI: avatar-grid (lille) på BoardPage; mini-dialogs ved enkelt-mål-forhandling
- Udskiftnings-trigger: 2× plan-udløb i træk under 30% tilfredshed → ny formand

### S-02d · Udvidede mål-typer
**Dep:** S-02a.
**Leverer (7 nye mål-typer):**
- `monument_podium` — top-3 i monument-løb (race_class)
- `jersey_wins` — point/bjerg/young-trøje-vinder pr. etapeløb
- `signature_rider` — én rytter med popularity ≥ N på holdet
- `profitable_transfers` — netto transfer-balance ≥ N over plan-perioden
- `u25_development_delta` — gennemsnitlig stat-gain hos U25-ryttere ≥ N pr. sæson
- `relative_rank` — slut foran mindst N andre managere (manager-konkurrence)
- `domestic_dominance` — vind ≥ N hjemlandsløb pr. sæson
- `evaluateGoal` + `evaluateGoalProgress` udvidet for hver type
- `goal-types` integration-test så hver type evaluerer både true og false-cases

### S-02e · Konsekvens-tier (6 lag)
**Dep:** S-02a.
**Leverer:**
- DB: `board_consequences` (active per team) — type, severity, expires_at
- `economyEngine` checker aktive consequences ved sæson-start (modifier), ved finance-tx (signing-cap), ved auction-bid (signing-restriktion)
- Salary cap: hard-block i transfer/auction-flow ved tilfredshed <40
- Tvunget listing: cron ved sæson-slut + tilfredshed <15 → automatisk listing af én navngivet rytter (laveste sportslige værdi)
- Sponsor-pull-out: narrativ event + permanent -10% sponsor resten af sæsonen
- Bonus-budget-tilbud (positiv): bestyrelse offer-table, manager kan acceptere → +budget mod ekstra-mål

### S-02f · Klub-DNA (håndlavede klub-identiteter)
**Dep:** S-02c.
**Leverer:**
- DB: `team_dna` (5-7 håndlavede arketyper, fx "Skandinavisk udviklingshold", "Italiensk klassiker-traditionalist", "Sprint-fokuseret kommerciel")
- Tildeles ved klub-oprettelse (manager vælger ELLER auto-tildel baseret på sæson-1-identitet)
- DNA påvirker board-medlems-akser, mål-vægtning, klub-tradition-mål
- DNA kan udvikles over 5 sæsoner (gradvis drift baseret på faktiske valg) — men ikke skifte arketype frit

### S-02g · Manager-konkurrence + mid-season aktiv påvirkning + drej-låsninger
**Dep:** S-02a + S-02d.
**Leverer:**
- `relative_rank`-mål bruger live manager-rangering (allerede i `season_standings`)
- Mid-season review (race_day = midpoint): justerer request-godkendelses-sandsynlighed for resten af sæsonen
- Cool-down: én MAJOR focus-skift pr. plan-livscyklus (DB-tracker: `board_profiles.major_pivot_used_at`)
- Evaluerings-vindue-blokering: requests umulige i sidste 5 race-days
- Mid-cycle 5yr/3yr-låsning: kræver ≥50% plan-gennemført ELLER >30% satisfaction-delta

### S-02h · Wizard-redesign — Hybrid B+A
**Dep:** S-02a + S-02c.
**Leverer:**
- BoardPage primær view = strategisk dashboard (3 paneler side om side)
- Klik på enkelt-mål → mini-dialog modal med relevant board-member-portræt + reaktions-template
- Live preview: modifier-impact af hvert valg
- Onboarding-wizard (sæson 2): sekventielt med "Næste plan: 3yr"-progress
- Mobile-responsiv (3 paneler stakker vertikalt)

### S-02i · Bug-fix-pass + komplet manuel e2e-test + soak-gate
**Dep:** S-02a–h.
**Leverer:**
- Manuel test: alle plan-livscyklusser × alle board-arketyper × alle mål-typer × alle konsekvens-tiers
- Regression-tests for `economyEngine.processSeasonEnd` (alle nye paths)
- Soak-gate: 60-min e2e-smoke FØR launch-gate-flag
- Bug-pass: alt fundet under test rettes inline

### S-02j · Polish (kan splittes i 2)
**Dep:** S-02i.
**Leverer:**
- Onboarding-tour-trin på BoardPage (opdateret efter wizard-redesign)
- HelpPage opdateret: bestyrelses-sektion fuld omskrevet
- PatchNotesPage: alle v2.33+ entries
- Doc-drift sweep: ARCHITECTURE, DOMAIN_REFERENCE, FEATURE_STATUS, NOW

---

## Åbne spørgsmål — Q-batch 1B (mekanik) + 1C (UX)

**Q-batch 1B — Mekanik (næste session):**
1. Hvilke 5-7 board-arketyper? Personlighed-akser + signaturreaktioner pr. arketype.
2. Hvilke 5-7 klub-DNA-arketyper? Hvordan tildeles (manager-valg eller auto)?
3. Mål-type-detaljer: hvilke konkrete tærskler for monument-podie, profil-signering, U25-delta? (kan også først lukkes i S-02d).
4. Konsekvens-tier-tærskler: præcis tilfredshed-grænse for hver tier? Hvor længe varer en sponsor-pull-out?
5. Bonus-budget-tilbud: hvor ofte? Hvor meget? Hvilke mål kan triggere det?
6. Manager-konkurrence-mål: skal det være division-internt (mod nærmeste rivaler) eller cross-division (mod alle managers)?
7. Mid-season review: skal banner-besked "Bestyrelsen er ikke imponeret af halvvejs-status" være automatisk, eller manager-trigget?
8. Tradeoff-låsninger: hvis manager beder om "lower_results_pressure" og det godkendes, skal næste sæsons mål automatisk være strammere? Hvor længe varer tradeoffen?

**Q-batch 1C — UX (efter 1B):**
1. Wizard hybrid B+A konkret layout — wireframe-niveau.
2. Identity-feeding-formidling: hvordan vises "din franske kerne påvirker 5yr-forslaget" i UI?
3. Plan-fornyelse-flow når flere planer udløber samme sæson (sæson 6: 5yr+1yr): seriel modal eller delt skærm?
4. Mobile-flow for 3-panel-dashboard.
5. Notifikations-design: hvor mange board-relaterede notifikationer er for mange?

---

## Arkitektur-noter — hvad genbruges, hvad er nyt

**Genbruges (per master-prompt: "Build on top, don't replace"):**
- `boardConstants.js` (KPI-vægtning bevares, kun nye konstanter tilføjes)
- `boardGoals.js` (eksisterende mål-typer bevares, nye tilføjes via samme metadata-pattern)
- `boardEvaluation.js` (engine-pipeline bevares, nye signal-justeringer plugges ind)
- `boardIdentity.js` (`computeSeasonOneIdentity` tilføjes som ny funktion)
- `boardRequests.js` (4 eksisterende requests bevares + ny tilføjes pr. konsekvens-event)
- `BoardPage.jsx` skal til redesign (S-02h) men bevarer state-shape
- DB: `board_profiles`, `board_plan_snapshots`, `board_request_log` bevares; nye tabeller tilføjes ved siden af.

**Nyt:**
- DB: `board_members`, `team_board_members`, `board_consequences`, `team_dna`
- `boardMembers.js` (sample-reaktion + udskiftnings-logik)
- `boardConsequences.js` (tier-engine, hooks ind i `economyEngine` + `auctionFinalization` + `transferExecution`)
- `boardWizardModel.js` (hybrid B+A state-machine)

---

## Migration-strategi

1. Hver sub-slice får sin egen `database/2026-XX-XX-board-*.sql` fil med atomic schema-ændringer.
2. Auto-migrate workflow (allerede live, v2.25) kører dem ved push.
3. Beta-reset i S-02a clearer alle managers' board-data via udvidet `betaResetService`.
4. Eksisterende managers får ny baseline-profil ved næste sæson-1-trigger.
5. Ingen data-tab er kritisk fordi vi reseter alligevel — men `board_plan_snapshots` historik bevares i archive-tabel for nostalgi.

---

## Skalerings-præmis — kod for variabelt manager-tal

- Ingen kode-loops over fast manager-antal.
- Cron-jobs der itererer human teams skal være pagineret eller streame fra DB.
- DB-queries skal være indekseret på `team_id` for board-tabeller.
- UI-komponenter der viser "alle managers" (manager-konkurrence-mål) skal lazy-loade.
- Test-fixtures bruger 3-5 hold for hurtig iteration; live-mængde testes i S-02i soak-gate.

---

## Estimat

**~10-12 sessioner over 4-6 uger** ved 2-3 sessioner/uge.
- Vision-lock: 1 session ✅ (denne)
- Q-batch 1B + 1C: 2 sessioner kun spørgsmål
- Implementering S-02a–i: 9 sessioner kode
- Polish S-02j: 1-2 sessioner

**Hver session = ÉN sub-slice komplet + commit + push.** Per `feedback_session_working_method` og close-out-rytme.

---

## Næste session — start her

```
"Fortsæt S-02 vision-lock — Q-batch 1B mekanik"
```

Claude læser denne master-doc + stiller næste batch spørgsmål. INGEN kode i Q-batch-sessioner.

---

## Appendix A — Plan-rytme-cyklus

**Beslutning #2 udfoldet konkret.** Sæson 1 = baseline, sæson 2 = onboarding (sekventiel 5yr→3yr→1yr). Derefter forskudt naturlig rytme:

| Sæson | 5yr | 3yr | 1yr | Bemærkning |
|-------|-----|-----|-----|------------|
| 1 | — | — | — | **Baseline.** Modifier 1.0, ingen mål. Identitet observeres. |
| 2 | NY | NY | NY | **Onboarding sekventielt** (én-gangs tung sæson). 5yr→3yr→1yr-flow. |
| 3 | aktiv | aktiv | NY | Kun 1yr fornyes |
| 4 | aktiv | aktiv | NY | Kun 1yr fornyes |
| 5 | aktiv | NY (3yr lever sæson 2-4) | NY | 3yr + 1yr |
| 6 | aktiv | aktiv | NY | Kun 1yr |
| 7 | NY (5yr lever sæson 2-6) | aktiv | NY | 5yr + 1yr |
| 8 | aktiv | NY (3yr lever sæson 5-7) | NY | 3yr + 1yr |
| 9 | aktiv | aktiv | NY | Kun 1yr |
| 10 | aktiv | aktiv | NY | Kun 1yr |
| 11 | aktiv | NY (3yr lever sæson 8-10) | NY | 3yr + 1yr |
| 12 | NY (5yr lever sæson 7-11) | aktiv | NY | 5yr + 1yr |

**Mønster efter onboarding:** Hver sæson har 1-2 forhandlinger. Aldrig 3 igen efter sæson 2. Det giver flydende manager-rytme.

**Auto-accept:** Hvis manager ikke handler inden race_day_count ≥ 5 i sæson, fyrer cron auto-accept (status quo for fornyelser, default-forslag for første-gangs-managers).

---

## Appendix B — Wizard-modeller (rationale for hybrid B+A)

**Beslutning #7 udfoldet.** Tre modeller blev præsenteret ved Q-batch 1A. Bruger valgte hybrid B+A.

### Model A — "Bestyrelses-rummet" (FM Conversation)
- Top: avatar-grid med dine 5 board-members
- Hver stiller 1-2 spørgsmål baseret på personlighed
- Multiple-choice svar med realtime-reaktion ("Henrik nikker. Maria ryster på hovedet.")
- Slut: kontrakt-side
- **Pro:** Maks immersion, narrative
- **Con:** Tungt at bygge (mange templates), risiko for repetitivt efter 5 sæsoner

### Model B — "Strategisk dashboard" (valgt som primær)
- Ét view, 3 paneler: 5yr-vision · 3yr-retning · 1yr-mål side om side
- Klik på enkelt-mål → mini-dialog
- Live preview: "Hvis du vælger dette mål, ændres modifier til ×1.12"
- **Pro:** Skalerbar, transparent, scaler godt for veteraner
- **Con:** Mindre wow-effekt første gang

### Model C — "Quest-flow" (sekventiel — det nuværende, polished)
- Progress-bar, board-member-portræt der "leverer" hvert mål, animationer
- 1 mål pr. trin
- **Pro:** Klart for nybegyndere, mindst arbejde
- **Con:** Repetitivt, lange forhandlinger

### Hybrid B+A (valgt)
- **Primær interface = B** (dashboard, hurtig overblik over alle 3 planer)
- Når manager forhandler et enkelt-mål → **mini-dialog fra A** åbner med relevant board-member-avatar + reaktions-template
- **Veteran-venligt** (B) + **immersivt** (A) uden at bygge fuld konversations-engine
- **Onboarding-wizard sæson 2** bruger sekventiel B-flow med "Næste plan: 3yr"-progress-banner
- **Mobile:** 3 paneler stakker vertikalt; mini-dialog er fullscreen modal

---

## Appendix C — 6-lags konsekvens-tier (beslutning #4 udfoldet)

| Lag | Trigger | Konsekvens | Type |
|-----|---------|------------|------|
| 1 | Tilfredshed-baseret | Sponsor-modifier ±20% | **Live (passiv)** |
| 2 | Tilfredshed <40 | Salary cap (hold-løntop pålægges) | Hard-block i transfer/auction |
| 3 | Tilfredshed <30 | Signing-restriktion (køb >X pris kræver bestyrelses-godkendelse) | Hard-block med override-flow |
| 4 | Tilfredshed <15 | Tvunget listing (én navngivet rytter listes til salg) | Cron sæson-slut |
| 5 | Tilfredshed <10 ELLER 2× plan-udløb under 30% | Sponsor-pull-out narrativ event + permanent -10% sponsor resten af sæsonen | Single event |
| 6 | Tilfredshed >75 + specifikt mål nås | Bonus-budget-tilbud (+budget mod ekstra-mål) | **Positiv konsekvens** |

Aldrig fyring. Severity stiger gradvist med tilfredshed-fald. Lag 6 belønner overpræstation — FM-style.

---

## Appendix D — Klub-DNA tildelings-flow (beslutning til Q-batch 1B)

5-7 håndlavede arketyper er besluttet, men konkrete arketyper og tildelings-mekanik er åbne for Q-batch 1B. Foreløbig tankegang:

- **Tildelings-tidspunkt:** Ved klub-oprettelse (signup) ELLER ved sæson 2-onboarding (når sæson-1-identitet er klar)
- **Manager-valg vs auto:** Foreslår *manager vælger fra 3 forslag*, hvor de 3 forslag er afledt af sæson-1-rytter-data
- **Udvikling over tid:** DNA kan drifte gradvist over 5 sæsoner baseret på faktiske valg, men ikke skifte arketype frit
- Konkrete arketyper besluttes i Q-batch 1B
