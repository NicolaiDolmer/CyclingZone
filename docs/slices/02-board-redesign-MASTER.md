# S-02 · Bestyrelse-redesign — MASTER ROADMAP

**Skrevet:** 2026-05-05 efter Vision-lock-session 1A.
**Erstatter:** `02-board-redesign-sequential.md` (er nu S-02a — én sub-slice af denne master).
**Status:** Vision + mekanik + UX låst (Q-batch 1A + 1B + 1C ✅ 2026-05-05). Ingen kode endnu — næste session = S-02a foundation.

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

## Vision-lock — låste beslutninger (Q-batch 1B, 2026-05-05)

| # | Spørgsmål | Beslutning |
|---|-----------|------------|
| 9 | Board-arketyper — antal + navne | **9 arketyper** (op fra 5-7 i 1A): Sponsoraten · Traditionalisten · Talentspejderen · Resultatjægeren · Pragmatikeren · Ungdoms-idealisten · Nationalist-purist · Klassiker-purist · GC-elsker. ~270-450 reaktions-templates total (30-50 pr. arketype). Personlighed-akser pr. arketype besluttes i S-02c-implementering. |
| 10 | Klub-DNA — antal + tildeling | **5 DNA:** Skandinavisk udviklingshold · Italiensk klassiker-traditionalist · Sprint-fokuseret kommerciel · Fransk klatrer-arv · Britisk all-rounder. Manager vælger fra 3 forslag i sæson 2. Forslag afledt af `national_core` + `primary_specialization` fra sæson-1 `identity_profile` (allerede beregnet i `boardIdentity.deriveTeamIdentityProfile`). |
| 11 | Konsekvens-tier-tærskler | **Appendix C låst som-er:** <40 salary cap · <30 signing-restriktion · <15 tvunget listing · <10 sponsor-pull-out (varer resten af sæson, nulstilles ved næste sæson-start). Matcher eksisterende `satisfactionToModifier`-grænser (40/20). |
| 12 | Manager-konkurrence-scope | **Division-internt.** `relative_rank`-mål bruger eksisterende `season_standings.rank_in_division`. 0 ny ranking-beregning. Skalerer fra ~19 → 100+ managers uden cross-division-støj. |
| 13 | Mål-tærskler — 3 nye typer uden naturlig DB-anker | **Anbefalet pakke:** `monument_podium` = top-3 i ≥1 Monuments-løb pr. plan-cyklus (race_class='Monuments') · `signature_rider` = 1 rytter med popularity ≥75 · `u25_development_delta` = gnsn. ≥3 stat-points/sæson på U25-ryttere. |
| 14 | Bonus-budget-tilbud (lag 6 positiv) | **Sjældent + mærkbart:** maks 1 tilbud/sæson når satisfaction >75 OG ≥75% af aktive plan-mål er på 'ahead'-status. +200K budget mod 1 ekstra-mål (vind 1 monument ELLER sign 1 stjerne pop ≥75). Manager kan afvise. ~25% af 800K start-balance — mærkbart uden gamebreaking. |
| 15 | Mid-season review-trigger | **Auto-banner ved halvvejs.** Cron tjekker satisfaction + mål-status ved race_day=midpoint. Hvis satisfaction <50 ELLER ≥50% af mål er 'behind' → besked i Indbakke 'Skal handles' med 1-2 mulige actions (anmod om budget-lån ELLER acceptér tightened deadline). Konsistent for alle managers, ingen forglemmelse. |
| 16 | Tradeoff-låsninger (efter request-godkendelse) | **1 sæson stramning.** Hvis fx `lower_results_pressure` godkendes → næste sæsons identitetskrav er strammere (+1 til U25/national_riders ELLER -5% sponsor_growth-target). Tradeoff sletter sig efter den ene sæson — ren transaktion. Manager kan gentage hver 2. sæson. Matcher eksisterende `tradeoff_preview`-tekster i `boardConstants.BOARD_REQUEST_DEFINITIONS`. |

---

## Vision-lock — låste beslutninger (Q-batch 1C UX, 2026-05-05)

| # | Spørgsmål | Beslutning |
|---|-----------|------------|
| 17 | Wizard hybrid B+A info-tæthed pr. plan-panel | **Compact dashboard.** Hvert panel viser: plan-titel + tilfredshed-delta + **2-3 hovedmål** + status-ikon (✓/!/~/○ matcher eksisterende `GOAL_STATUS_META` i `BoardPage.jsx`). Klik på enkelt-mål → mini-dialog med fulde mål-detaljer + dominerende board-member-reaktion. Side-om-side scaler godt for veteraner; mini-dialog leverer immersion uden at fylde dashboard. |
| 18 | Identity-feeding-formidling i 5yr-forslag | **Inline 'bygger på'-badge** på hvert relevant mål-kort. Format: `"Bygger på din franske kerne (5/8 ryttere)"`. Badge er klikbar → expand med fuld forklaring (hvilke ryttere bidrager, hvilken `national_core.share_pct`-tærskel ramt). Manageren føler sig 'set' uden tungt UI. Genbruger data fra `boardIdentity.deriveTeamIdentityProfile`. |
| 19 | Multi-plan-fornyelse-flow (sæson 5+7+11+12 har 2 planer der fornyes samme sæson) | **Sekventiel modal.** Den længste plan-horisont forhandles først (5yr eller 3yr), derefter åbner 1yr automatisk efter accept. Manager kan gå tilbage til længste-plan-trinnet fra 1yr-trinnet via "Tilbage"-knap. Matcher onboarding-pattern fra sæson 2 (5yr→3yr→1yr). Holder hver beslutning fokuseret. |
| 20 | Mobile-flow for 3-panel-dashboard | **Vertikal stack + fullscreen modal** (bekræfter Appendix B). Paneler stakker under hinanden (5yr → 3yr → 1yr top-down). Klik på mål åbner fullscreen modal med back-knap. Genbruger eksisterende Modal-pattern. Mini-dialog er fullscreen for at undgå tap-target-problemer. |
| 21 | Notifikations-volume — styringsmodel | **Tier-styret.** Tidskritisk action-required → Indbakke 'Skal handles' (eksisterende v2.30-tier): auto-accept T-1, mid-season banner pr. Q15, konsekvens-event lag 4-5, bonus-tilbud lag 6. Info-only → dedikeret **'Bestyrelse'-feed på BoardPage** (T-3 reminder, plan-evaluering-resumé, satisfaction-delta-snapshots, board-member-reaktioner). ~3-4 Indbakke-notifs/sæson. Genbruger `notifications.type='board_update'` (eksisterende, cron.js:77) + nyt `type='board_critical'` for Skal-handles-routing. |

---

## Sub-slice-roadmap (9 implementerings-slices + polish)

Hver sub-slice = 1 session. Total: ~10-12 sessioner. Dependencies markeret.

### S-02a · Foundation: Sekventiel forhandling + sæson-1-baseline ✅ LEVERET 2026-05-05 (v2.33)
**Dep:** ingen.
**Erstatter:** `02-board-redesign-sequential.md`.
**Q-afklaringer (2026-05-05):**
- Q-A: trigger inline i `processSeasonEnd` (ikke cron) — éns truth-path
- Q-B: global fase-lås på `transfer_windows.board_negotiation_state` (per-team-fremdrift via row-eksistens)
- Q-C: `activates_in_season_number` droppet (YAGNI)

**Leveret:**
- Migration `database/2026-05-05-board-foundation.sql`: `board_profiles.is_baseline` + `plan_type='baseline'` + `transfer_windows.board_negotiation_state` (locked/pending_5yr/pending_3yr/pending_1yr/complete)
- `boardEngine.createBaselineProfile` + `startSequentialNegotiation` (ny fil `boardSequentialNegotiation.js`, eksporteret via facade)
- `economyEngine.processSeasonEnd`: skip baseline-rows i evaluerings-loop + kald `startSequentialNegotiation` ved sæson 1-slut
- `transfer-window/open` arver state fra forrige window
- Frontend: `BoardPage` viser observations-banner i baseline-fasen, skjuler plan-kort. Wizard auto-åbner kun ved `!is_baseline_phase`
- Beta-reset: 1 baseline-row pr. team (i stedet for 3 plan-rows)
- 131/131 backend-tests grønne, 5 nye tests for createBaselineProfile + startSequentialNegotiation + processSeasonEnd-integration

### S-02b · 1yr-auto-gen + auto-accept + identity-feeding
**Dep:** S-02a. **UX låst i Q-batch 1C Q18 + Q21.**
**Leverer:**
- `boardIdentity.computeSeasonOneIdentity` — afleder dominant_nationality, youth_share, specialization fra sæson 1's hold
- Identity feedes ind som goal-weighting i 5yr-forslag
- **Inline 'bygger på'-badge (Q18)** på hvert relevant 5yr-mål-kort: `"Bygger på din franske kerne (5/8 ryttere)"`. Klikbar → expand med fuld forklaring
- `generate1YrFromLongerPlans` — 2 varianter ("Stabil" / "Resultatfokus nu")
- Auto-accept-cron ved race_day_count ≥ 5
- **Tier-styrede notifs (Q21):** T-1 race_day → 'Skal handles' (`type='board_critical'`); T-3 race_day + auto-accept-resumé → BoardPage 'Bestyrelse'-feed (`type='board_update'`)
- Countdown-banner

### S-02c · Navngivne board-members
**Dep:** S-02a.
**Leverer:**
- DB: `board_members` (9 arketyper-rows seedet — se Q-batch 1B Q9) + `team_board_members` (mapping team→members med tildelings-tidspunkt)
- Hver arketype har personality-akser (besluttes inline i denne slice ud fra arketype-navn) + reaktions-template-pool (30-50 templates × 9 = ~270-450 templates total)
- `boardEvaluation` udvidet til at sample reaktion fra dominerende medlem ved feedback-build
- UI: avatar-grid (lille) på BoardPage; mini-dialogs ved enkelt-mål-forhandling
- Udskiftnings-trigger: 2× plan-udløb i træk under 30% tilfredshed → ny formand

### S-02d · Udvidede mål-typer
**Dep:** S-02a.
**Leverer (7 nye mål-typer — tærskler låst i Q-batch 1B Q13):**
- `monument_podium` — top-3 i ≥1 Monuments-løb pr. plan-cyklus (race_class='Monuments', result_type='gc')
- `jersey_wins` — point/bjerg/young-trøje-vinder pr. etapeløb (result_type IN ('points','mountain','young'))
- `signature_rider` — 1 rytter med popularity ≥ 75 på holdet
- `profitable_transfers` — netto transfer-balance ≥ N over plan-perioden (N besluttes i implementering)
- `u25_development_delta` — gennemsnitlig stat-gain ≥ 3 stat-points/sæson hos U25-ryttere
- `relative_rank` — slut foran mindst N andre managere i din division (Q-batch 1B Q12: division-internt, bruger `season_standings.rank_in_division`)
- `domestic_dominance` — vind ≥ N hjemlandsløb pr. sæson (N besluttes i implementering)
- `evaluateGoal` + `evaluateGoalProgress` udvidet for hver type
- `goal-types` integration-test så hver type evaluerer både true og false-cases

### S-02e · Konsekvens-tier (6 lag)
**Dep:** S-02a. **Tærskler låst i Q-batch 1B Q11 (Appendix C) + Q14. Notif-routing låst i Q-batch 1C Q21.**
**Leverer:**
- DB: `board_consequences` (active per team) — type, severity, expires_at
- `economyEngine` checker aktive consequences ved sæson-start (modifier), ved finance-tx (signing-cap), ved auction-bid (signing-restriktion)
- Salary cap: hard-block i transfer/auction-flow ved tilfredshed <40
- Signing-restriktion: ved tilfredshed <30 kræver køb >X pris bestyrelses-godkendelse
- Tvunget listing: cron ved sæson-slut + tilfredshed <15 → automatisk listing af én navngivet rytter (laveste sportslige værdi)
- Sponsor-pull-out: narrativ event + -10% sponsor resten af sæsonen, nulstilles ved næste sæson-start
- Bonus-budget-tilbud (positiv, lag 6): maks 1/sæson når satisfaction >75 OG ≥75% mål 'ahead' → +200K budget mod 1 ekstra-mål (vind 1 monument ELLER sign 1 stjerne pop ≥75). Manager kan afvise.
- **Notif-routing (Q21):** lag 4 (tvunget listing) + lag 5 (sponsor-pull-out) + lag 6 (bonus-tilbud) → 'Skal handles' (`type='board_critical'`). Lag 1-3 (passive modifiers + auction-restriktioner) = ingen notif, kun synlige som warning på BoardPage 'Bestyrelse'-feed.

### S-02f · Klub-DNA (håndlavede klub-identiteter)
**Dep:** S-02c. **Låst i Q-batch 1B Q10.**
**Leverer:**
- DB: `team_dna` (5 håndlavede arketyper-rows seedet): Skandinavisk udviklingshold · Italiensk klassiker-traditionalist · Sprint-fokuseret kommerciel · Fransk klatrer-arv · Britisk all-rounder
- Tildelings-flow: ved sæson-2-onboarding (efter sæson 1's identity er observeret) → manager vælger fra 3 forslag
- 3 forslag afledes af `national_core` + `primary_specialization` fra `boardIdentity.deriveTeamIdentityProfile`
- DNA påvirker board-medlems-akser, mål-vægtning, klub-tradition-mål
- DNA kan udvikles over 5 sæsoner (gradvis drift baseret på faktiske valg) — men ikke skifte arketype frit

### S-02g · Manager-konkurrence + mid-season aktiv påvirkning + drej-låsninger
**Dep:** S-02a + S-02d. **Mid-season + tradeoff låst i Q-batch 1B Q15 + Q16.**
**Leverer:**
- `relative_rank`-mål bruger live division-intern rangering fra `season_standings.rank_in_division` (Q12)
- Mid-season auto-banner ved race_day=midpoint: hvis satisfaction <50 ELLER ≥50% mål 'behind' → besked i Indbakke 'Skal handles' med 1-2 actions (anmod om budget-lån ELLER acceptér tightened deadline)
- Tradeoff-låsninger: efter request-godkendelse (fx `lower_results_pressure`) → 1 sæson stramning af identitetskrav (+1 til U25/national_riders ELLER -5% sponsor_growth-target). DB-felt: `board_profiles.tradeoff_active_until_season_id`
- Cool-down: én MAJOR focus-skift pr. plan-livscyklus (DB-tracker: `board_profiles.major_pivot_used_at`)
- Evaluerings-vindue-blokering: requests umulige i sidste 5 race-days
- Mid-cycle 5yr/3yr-låsning: kræver ≥50% plan-gennemført ELLER >30% satisfaction-delta

### S-02h · Wizard-redesign — Hybrid B+A
**Dep:** S-02a + S-02c. **UX-detaljer låst i Q-batch 1C Q17 + Q19 + Q20.**
**Leverer:**
- BoardPage primær view = strategisk dashboard (3 paneler side om side, **compact info-tæthed pr. Q17**: titel + tilfredshed-delta + 2-3 hovedmål + status-ikon vha. eksisterende `GOAL_STATUS_META`)
- Klik på enkelt-mål → mini-dialog modal med relevant board-member-portræt + reaktions-template
- Live preview: modifier-impact af hvert valg
- Onboarding-wizard (sæson 2): sekventielt med "Næste plan: 3yr"-progress
- **Multi-plan-fornyelse (Q19):** når 2 planer fornyes samme sæson, sekventiel modal — længste-horisont først (5yr→1yr eller 3yr→1yr), derefter 1yr automatisk efter accept. "Tilbage"-knap på 1yr-trinnet vender tilbage til længste-plan-trinnet
- **Mobile-responsiv (Q20):** 3 paneler stakker vertikalt; mini-dialog er fullscreen modal med back-knap (genbruger eksisterende Modal-pattern)

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

## Detaljer der lukkes inline i implementerings-slices

**Q-batch 1A + 1B + 1C ✅ alle lukket 2026-05-05.** Se beslutnings-tabeller ovenfor (Q1-21). Disse detaljer kræver ikke yderligere Q-session — afgøres inline når sub-slicen implementeres:

- Personlighed-akser pr. board-arketype (S-02c)
- Reaktions-templates (~270-450 stk i S-02c)
- `profitable_transfers` + `domestic_dominance` N-tærskler (S-02d)
- Identity-badge expand-content layout (S-02b — Q18 låser inline-badge, expand-detail er CSS/copy-arbejde)
- `type='board_critical'` schema-detalje + DB-migration (S-02b — Q21 låser tier-routing)
- "Tilbage"-knap state-machine i sekventiel multi-plan-fornyelse (S-02h — Q19 låser flow, state-machine er implementerings-detalje)

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
"Start S-02a — Foundation: sekventiel forhandling + sæson-1-baseline"
```

Q-batch 1A + 1B + 1C ✅ alle lukket. Næste session = første implementerings-slice. Claude læser denne master-doc + S-02a-leverer-listen ovenfor og bygger:
- Migration `database/2026-XX-XX-board-foundation.sql` (board_profiles.activates_in_season_number, is_baseline; transfer_windows.board_negotiation_state)
- `boardEngine.createBaselineProfile`, `startSequentialNegotiation`, `proposeNextPlan` (5yr→3yr→1yr-orden)
- `cron.js` sæson-1-slut → `startSequentialNegotiation` for hver human team
- `BoardPage` + wizard læser `board_negotiation_state`, viser kun aktuelt trin
- Beta-reset: alle eksisterende planer slettes (godkendt full reset i Q6)

Efter S-02a kan brugeren vælge S-02b (1yr-auto-gen + identity-feeding) eller S-02c (board-members) — begge har kun S-02a som dep og kan parallelt-køres af Codex/Claude.

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

## Appendix D — Klub-DNA tildelings-flow (Q-batch 1B Q10 — låst)

**5 håndlavede DNA-arketyper:**
1. **Skandinavisk udviklingshold** — youth-fokus, lavere sponsor-pres, national_core nordisk
2. **Italiensk klassiker-traditionalist** — klassiker-prestige, monument-podie-vægtet, national_core ITA
3. **Sprint-fokuseret kommerciel** — sprint-specialization, høj sponsor-vækst-krav, kommerciel-aggressiv
4. **Fransk klatrer-arv** — GC/bjerg-fokus, Tour de France-prestige, national_core FRA
5. **Britisk all-rounder** — balanceret, all-discipline, performance-orienteret

**Tildelings-flow:**
- **Tidspunkt:** Sæson-2-onboarding (efter sæson 1's `identity_profile` er observeret)
- **Mekanik:** Manager præsenteres for 3 forslag i wizard. De 3 forslag afledes algoritmisk:
  - Forslag 1 = bedste match til `national_core.code` (hvis etableret)
  - Forslag 2 = bedste match til `primary_specialization` (gc/sprint/classics/breakaway/youth)
  - Forslag 3 = wildcard (en af de øvrige 3 DNA, så manager altid har et "step out of mold"-valg)
- **Manager vælger frit fra de 3** — ingen påtvunget DNA, men forslagene føles "set" pga. data-grunding
- **DNA kan drifte gradvist over 5 sæsoner** baseret på faktiske valg (køb/salg/race-strategi) — men ikke skifte arketype frit. Drift-mekanik defineres i S-02f-implementering.
