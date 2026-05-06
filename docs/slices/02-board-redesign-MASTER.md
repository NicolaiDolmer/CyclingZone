# S-02 · Bestyrelse-redesign — MASTER ROADMAP

**Skrevet:** 2026-05-05 efter Vision-lock-session 1A.
**Erstatter:** `02-board-redesign-sequential.md` (er nu S-02a — én sub-slice af denne master).
**Status:** ✅ Leveret som S-02a–S-02j (v2.33-v2.42, 2026-05-05). Runtime-status genafstemt 2026-05-05 via commits `d1f06fb` → `7806f20`, `docs/FEATURE_STATUS.md`, `docs/NOW.md` og patch notes. Fuld manuel S-02 e2e-smoke er ikke genkørt i denne docs-sweep.

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

### S-02b · 1yr-auto-gen + auto-accept + identity-feeding ✅ LEVERET 2026-05-05 (v2.34)
**Dep:** S-02a. **UX låst i Q-batch 1C Q18 + Q21.**
**Q-bekræftelser (2026-05-05 session):**
- A=b: `teams.season_1_identity_basis JSONB` (én sandhedslocation, ikke per-board-row)
- B=b: auto-accept default-focus afledes fra `identity_basis.primary_specialization`/youth/star
- C: T-3 ved `race_days_completed=2` (`board_update`), T-1 ved =4 (`board_critical`), auto-accept ved ≥5

**Leveret:**
- Migration `database/2026-05-05-board-1yr-autogen.sql`: `teams.season_1_identity_basis JSONB` + `notifications_type_check` udvidet med `board_critical`
- `boardIdentity.computeSeasonOneIdentity` — afleder dominant_nationality, youth_share, primary_specialization, star_profile fra sæson 1's hold (uden volatile felter som standing/competitive_tier)
- `boardIdentity.deriveDefaultFocusFromIdentity` — mapper basis → focus (youth_high → youth_development, elite_star → star_signing, gc/sprint/classics → star_signing, ellers balanced)
- `boardSequentialNegotiation.startSequentialNegotiation` udvidet: computer + persisterer identity_basis for hver human team før baseline-rows slettes (idempotent — skipper teams der allerede har basis)
- `boardGoals.annotateGoalWithIdentityBasis` — annoterer 5yr-mål med `identity_basis_rationale` (kind + short + long) for inline 'bygger på'-badge
- `boardGoals.buildBoardProposal` accepterer `identityBasis` og annoterer 5yr-mål automatisk
- `boardGoals.generate1YrFromLongerPlans` — 2 varianter ("Stabil" arver 5yr-focus, "Resultatfokus nu" forskubber til star_signing)
- `boardAutoAccept.processBoardAutoAcceptCron` — ny daglig cron-job (kører hver 30 min). T-3 reminder ved race_days_completed=2 → `notifications.type='board_update'`, T-1 ved =4 → `type='board_critical'`, auto-accept ved ≥5 → upserter `board_profiles`-row med default focus + standardmål
- `cron.js` integration: `setInterval(runBoardAutoAcceptCron, 30 * 60 * 1000)` + immediate run on startup
- `/api/board/status` returnerer `identity_basis` + `auto_accept` (race_days_left/completed/threshold) + annoterer eksisterende 5yr-mål med rationale ved page-load
- `/api/board/proposal` + `/api/board/sign` accepterer `identity_basis` så 5yr-forslag og signed-rows får annoterede mål
- BoardPage: `BoardAutoAcceptCountdown` (countdown-banner med kritisk-farve ved T-1), inline-badge på `GoalCard` (klikbar expand), wizard preview viser også badgen, `BoardFeedSection` (samler `board_update` + `board_critical` notifs)
- HelpPage: 3 nye FAQ-items (sæson 1-baseline, identity-badge, auto-accept-cron)
- 146/146 backend-tests grønne (15 nye for S-02b: computeSeasonOneIdentity stable axes, defaultFocus mapping, 5yr/1yr-annotation, generate1YrFromLongerPlans variants, identity_basis-persist + idempotent replay, auto-accept-cron T-3/T-1/auto-sign/locked-skip)

### S-02c · Navngivne board-members ✅ LEVERET 2026-05-05 (v2.35)
**Dep:** S-02a.
**Q-bekræftelser (2026-05-05 session):**
- A1=5 medlemmer fast pr. team
- A2=3 identity-matched + 2 non-conflicting wildcards (friction-akser: debt_aversion, youth_focus, results_pressure)
- A3=tildelt ved sæson-1-slut i `startSequentialNegotiation`
- A4=30 templates pr. arketype (270 total) i kode-konstant (ikke DB-tabel)
- A5=`boardArchetypes.js` (samme pattern som `BOARD_REQUEST_DEFINITIONS`)
- A6=kategori-match med fallback til formanden ved tvivl
- A7=udskift KUN formanden ved replacement-trigger (ikke alle 5)
- A8=per-team counter på `teams.consecutive_low_satisfaction_expirations`
- A9=emoji + arketype-label avatar (nul asset-arbejde)
- A10=GoalCard expand-pattern (genbruger S-02b's identity-badge-pattern)
- A11=ja, `board_update`-notif ved ny formand

**Leveret:**
- Migration `database/2026-05-05-board-members.sql`: `team_board_members`-tabel + `teams.consecutive_low_satisfaction_expirations` counter
- `boardArchetypes.js`: 9 arketyper (Sponsoraten 💰, Traditionalisten 🎩, Talentspejderen 🔭, Resultatjægeren 🏆, Pragmatikeren ⚖️, Ungdoms-idealisten 🌱, Nationalist-purist 🏳️, Klassiker-purist 🪨, GC-elsker ⛰️) med personality-akser + 8 policy-akser + category_alignment + 30 reactions/arketype = 270 templates total
- `boardMembers.js`: `selectBoardMembers` (top-3 identity + 2 non-conflicting wildcards, deterministisk), `assignBoardMembersForTeam` (idempotent), `selectDominantMember` (kategori → arketype, chairman-fallback), `sampleReactionForFeedback`/`sampleReactionForGoal` (tone/status-routing), `processReplacementTrigger` (counter increment/reset, chairman-udskiftning ved counter≥2)
- Hook i `boardSequentialNegotiation.startSequentialNegotiation`: assign 5 medlemmer pr. team efter `identity_basis` er persisted (idempotent ved replay)
- Hook i `economyEngine.processSeasonEnd`'s `planIsComplete`-branch: kald `processReplacementTrigger` med ny `newSatisfaction` + identity_basis; send notif "Bestyrelsen har valgt en ny formand: {label}" ved replacement
- `boardEvaluation.buildBoardOutlook` udvidet med `attachMembersOverlay`: tilføjer `feedback.dominant_member` + `goal_evaluations[].member_reaction` baseret på `context.assignedMembers`
- API `/api/board/status` returnerer `team_members[]` (decoreret med arketype-data) + sender `assignedMembers` til `buildBoardOutlook`
- BoardPage: `BoardMembersGrid` (5-avatar grid med chairman-badge ★), `MemberPortrait`, `MemberReactionPanel`, GoalCard udvidet med 'X reagerer'-expand, PlanCard outlook-feedback udvidet med dominant_member-citat
- Beta-reset: clearer `team_board_members` + nulstiller `consecutive_low_satisfaction_expirations` + `season_1_identity_basis`
- HelpPage: 3 nye FAQ-items (medlemmer-pool, formandens rolle, hvorfor forskellige medlemmer reagerer på forskellige mål)
- 164/164 backend-tests grønne (16 nye for S-02c: arketype-shape 9×30, conflict-detection, alignment-scoring, non-conflicting wildcards + fallback, deterministisk replay, idempotent assignment, dominant-member kategori+chairman, reaction-sampling, replacement counter increment/reset/trigger, AI-skip, end-to-end startSequentialNegotiation)

### S-02d · Udvidede mål-typer ✅ LEVERET 2026-05-05 (v2.36)
**Dep:** S-02a.
**Q-bekræftelser (2026-05-05 session):**
- A: monument_podium = cumulative over plan-perioden
- B: jersey_wins = 2/sæson 1yr, cumulative for 3yr/5yr
- C: signature_rider = tjekkes ved evaluerings-tidspunkt
- D: profitable_transfers = ≥200K netto cumulative
- E1: u25_development_delta = column-add `u25_stat_sum`+`u25_count` på `board_plan_snapshots` (snapshot pr. sæson)
- F: relative_rank = N=3 hardkodet
- G: domestic_dominance = skeleton (defer til S-02g)
- H=b: motor + tests + lille integration (3 nye 5. mål i `youth_development`/`star_signing`/`balanced`)

**Leveret:**
- Migration `database/2026-05-05-board-goal-types.sql`: `board_plan_snapshots.u25_stat_sum` + `u25_count`
- `boardConstants.js`: 7 nye entries i `GOAL_METADATA_BY_TYPE`
- `boardGoals.js`: `evaluateGoal` + `evaluateGoalProgress` + `buildGoalLabel` + `buildNegotiatedGoal` udvidet for alle 7 typer; `computeU25StatSum` ny eksport
- `generateBoardGoals` udvidet med 5. mål pr. focus: `youth_development` += `u25_development_delta`, `star_signing` += `signature_rider`, `balanced` += `relative_rank`
- Ny `boardGoalContext.js` med `loadGoalContextForBoard` — shared loader for cumulativeMonumentPodiums/JerseyWins/seasonJerseyWins/TransferBalance + planStartU25StatSum/Count + divisionManagerCount
- `economyEngine.processTeamSeasonEnd` kalder loaderen + spreader kontekst ind; snapshotter `u25_stat_sum`+`u25_count` ved sæson-slut
- `api.js /board/status` kalder loaderen pr. board (try/catch graceful degradation)
- 27 nye backend-tests (191/191 grønne total): hver af de 7 typer får true/false/null-cases + cumulative progress + integration-tests for de 3 nye 5. mål

**Ikke leveret (overført til senere slices):**
- `monument_podium`, `jersey_wins`, `profitable_transfers`, `domestic_dominance` er klar i motor + context-loader, men er endnu ikke valgt af nogen `generateBoardGoals`-pakke — venter på S-02f (DNA) eller S-02g (manager-konkurrence)
- `domestic_dominance` returnerer `awaiting_data` (kompleks "hjemland"-detektion deferred)
- `u25_development_delta` returnerer `awaiting_data` i 1. sæson af planen (ingen baseline endnu)

### S-02e · Konsekvens-tier (6 lag) ✅ LEVERET 2026-05-05 (v2.37)
**Dep:** S-02a. **Tærskler låst i Q-batch 1B Q11 (Appendix C) + Q14. Notif-routing låst i Q-batch 1C Q21.**
**Q-bekræftelser (2026-05-05 session):**
- A1: signing-restriktion-pris-tærskel = 300K (inline-detalje, master line 226 godkender inline-valg)
- A2: salary cap = total-salary frosset ved trigger-tidspunkt (re-evalueres hver sæson-end)
- A3: forced-listing protection = pop≥70 OR uci≥100 (parallel til UCI-sync)
- A4: lag 5 stack-orden = budget_modifier × pullout_factor (multiplikativ)
- A5: lag 5 expire = ved næste sæson-start efter ÉN sponsor-payment (Q11-præmis "varer resten af sæsonen")
- A6: lag 6 extra-goal = signature_rider for star_signing-fokus, ellers monument_podium

**Leveret:**
- Migration `database/2026-05-05-board-consequences.sql`: `board_consequences`-tabel m. layer (2-6) + status (active/accepted/declined/expired/fulfilled) + severity (lag-specifik) + payload JSONB + source_board_id + expires_at_season_id + unique-active-index på (team_id, layer)
- `boardConsequences.js`: `evaluateAndApplyConsequences` (master-orchestrator), `assertSigningAllowed` (lag 2-3 hard-block helper), `selectForcedListingRider` (laveste market_value m. star-protection), `getActiveSponsorPulloutFactor` (lag 5 multiplier), `expireSeasonScopedConsequences` (cleanup), `acceptBonusOffer`/`declineBonusOffer`, `markForcedListingFulfilled`, `getActiveConsequencesForTeam`, `getLayerLabel`, `isBonusOfferEligible`, `selectBonusExtraGoal`
- Hook A i `economyEngine.processTeamSeasonEnd`: efter snapshot + replacement-trigger kalder `evaluateAndApplyConsequences` med planIsComplete-context. Trigger B "double-plan-lapse" passes via `consecutiveLowExpirations: replacement.replaced ? 2 : 0`
- Hook B i `economyEngine.processSeasonStart`: pre-loader aktive lag-5-pullouts → multiplicerer ind i sponsor-payout (description annoteres med "sponsor-pullout aktiv") → bulk-expirer aktive lag-5 efter loop. Idempotent ved gentaget kald
- Hook C i `api.js`: `assertSigningAllowed` kaldes på POST /api/auctions/:id/bid + POST /api/transfers/offer + PATCH /api/transfers/offers/:id action='accept_counter'. Returner 403 m. `code='board_signing_restriction'` eller `'board_salary_cap'`
- 2 nye routes `/api/board/bonus-offer/{accept,decline}`: accept krediterer balance via `finance_transactions.type='bonus'` + tilføjer ekstra-mål med `source: 'bonus_offer'` til 1yr-board's current_goals
- `/api/board/status` returnerer `active_consequences[]` (sorted by layer) + `bonus_offer` (lag 6 udskilt)
- BoardPage: `BoardConsequencesPanel` (lag 2-3 gul, lag 4-5 rød), `BonusOfferCard` (grøn m. Acceptér/Afvis), placeret efter BoardMembersGrid før PlanCards. State `activeConsequences` + `bonusOffer` + `bonusOfferBusy`
- Beta-reset: clearer `board_consequences` (parallelt med snapshots/requests/members)
- HelpPage: 2 nye FAQ-items (kan-jeg-fyres, bonus-tilbud)
- 41 nye backend-tests (232/232 grønne total): 6 lag × (trigger-positive + trigger-negative + idempotent-replay) + assertSigningAllowed-prioritering + sponsor-pullout-stack + bonus-offer accept/decline + selectForcedListingRider star-protection

### S-02f · Klub-DNA ✅ LEVERET 2026-05-05 (v2.38)
**Dep:** S-02c. **Låst i Q-batch 1B Q10.**
**Q-bekræftelser (2026-05-05 session):**
- A: 5 DNA seedet i DB-tabel + kode-konstant (samme pattern som S-02c board_archetypes)
- B: Suggestions deterministiske — 3 slots: national_match → specialization_match → wildcard
- C: DNA-bias kun ved chairman-replacement (typisk null ved første board-members-tildeling)
- D: 5yr-tradition-mål injiceres som BONUS-mål, ikke erstatning af focus-pakken
- E: Tradition-mål dedupliceres mod base-pakken (britisk_allrounder relative_rank ≠ 'balanced'-focus dup)
- F: DNA er final indtil drift — drift-mekanik leveret som S-02f.1 opfølgnings-slice

**Leveret:**
- Migration `database/2026-05-05-board-club-dna.sql`: `team_dna` reference-tabel (5 rows seedet inline) + `teams.team_dna_key` (FK) + `teams.team_dna_chosen_at` + idx
- `boardClubDna.js`: 5 DNA-konstanter (skandinavisk_udvikling, italiensk_klassiker, sprint_kommerciel, fransk_klatrer, britisk_allrounder) med policy_axes + national_affinity + specialization_affinity + member_alignment_bonus + goal_weighting + tradition_goal
- `computeDnaSuggestions(identityBasis)` — deterministisk 3-slot scoring: national_match (national_core.code i national_affinity) → specialization_match (primary_specialization i specialization_affinity) → wildcard (højest score blandt resterende)
- Hooks i `boardMembers.selectBoardMembers` + `replaceChairman`: `dnaKey`-parameter tilføjer member_alignment_bonus til alignment-score (italiensk_klassiker: +4 klassiker_purist, -2 gc_elsker)
- Hooks i `boardGoals.buildBoardProposal`: `dnaKey`-parameter injicerer `buildDnaTraditionGoal` som ekstra (importance: 'bonus') mål i 5yr-forslag (med dedup mod base-pakkens type+nationality_code) + `applyDnaWeightingToGoals` multiplicerer satisfaction_bonus + _penalty på matchende mål-typer
- `boardSequentialNegotiation.startSequentialNegotiation` passes nu `dnaKey` videre til assignBoardMembersForTeam (typisk null ved første assignment — DNA vælges først efter)
- `economyEngine.processTeamSeasonEnd` passes `dnaKey: team.team_dna_key` til processReplacementTrigger
- 2 nye routes: `GET /api/board/dna-suggestions` (returner 3 forslag eller already_chosen + identity_basis_missing-flags) + `POST /api/board/dna-choose` (idempotent — 409 hvis allerede valgt; 409 hvis identity_basis mangler; 403 for AI/bank/frozen)
- `/api/board/status` udvidet: `team_dna` (decoreret med arketype-data) + `dna_suggestions` (kun når ikke valgt og identity_basis findes)
- `/api/board/proposal` + `/api/board/sign` tager `dnaKey: team.team_dna_key` så live preview viser tradition-mål + weighting
- Frontend: `ClubDnaSelectionCard` (3-forslags-grid m. emoji + label + slot-badge + rationale + Vælg-knap) vises før plan-cards når dnaSuggestions findes; `ClubDnaBadge` (kompakt valgt-display m. emoji + long_description) vises efter valg; `chooseDna(dnaKey)` handler m. busy-state + error-display
- Beta-reset clearer team_dna_key + team_dna_chosen_at (parallelt m. identity_basis + counter)
- HelpPage: 2 nye FAQ-items (hvad er klub-DNA, hvad gør det konkret)
- 18 nye backend-tests (250/250 grønne total): konstanter (5 DNA × shape), suggestion-determinisme + national/spec/wildcard slot-tags + fallback uden identityBasis, alignment-bias verificerer at klassiker_purist scorer højere med italiensk DNA, mål-vægtning (1.6× monument_podium for italiensk), tradition-goal markering + dedup + kun-5yr-injection

**Ikke leveret (overført til S-02f.1):**
- DNA-drift-mekanik (gradvis udvikling over 5 sæsoner baseret på faktiske valg). Master-roadmap line 401: "Drift-mekanik defineres i S-02f-implementering" — fundamentet er leveret, drift kommer som mini-slice efter S-02g/h er afsluttet

### S-02g · Manager-konkurrence + mid-season aktiv påvirkning + drej-låsninger ✅ LEVERET 2026-05-05 (v2.39)
**Dep:** S-02a + S-02d. **Mid-season + tradeoff låst i Q-batch 1B Q15 + Q16.**
**Q-bekræftelser (2026-05-05 session):**
- Q-A=c: mid-season action = "Kun acknowledgement" (banner er informationskanal, ingen mekanisk effekt — manager handler via eksisterende request/loan-flows)
- Q-B=a: MAJOR pivot = kun krydsninger youth↔star (matcher shouldUseBalancedBridge-logikken). Pivots til/fra balanced er ikke MAJOR
- Q-C=a: Tradeoff hardkodet pr. request-type (`lower_results_pressure` → +1 identity_riders, `ease_identity_requirements` → +5pp sponsor_growth)
- Q-D=a: Alle 6 mini-features i én session, én commit

**Leveret:**
- Migration `database/2026-05-05-board-tradeoff-pivot.sql`: `board_profiles.tradeoff_active_until_season_id` (FK seasons) + `tradeoff_payload` (JSONB) + `major_pivot_used_at` (TIMESTAMPTZ) + index for cleanup-cron lookups
- F1: `relative_rank` rich UI ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)) — GoalCard renderer "Du staar #X af Y managers i divisionen — slaar Z (maal: N ✓)" når evaluation har `rank_in_division` + `division_manager_count`. evaluateGoalProgress udvidet til at returnere disse felter for relative_rank-typen ([boardGoals.js](backend/lib/boardGoals.js))
- F2: `boardMidSeason.js` motor + cron — `processMidSeasonReviewCron` checker hver human team ved race_days_completed >= midpoint, fyrer `board_critical`-notif "Mid-season check (sæson N)" hvis satisfaction <50 ELLER ≥50% målbare goals 'behind'. Idempotent via eksplicit notif-tabel-tjek på (user_id, type, title, related_id). Cron-interval 30 min, integration i [cron.js](backend/cron.js) med immediate run on startup
- F3: Tradeoff-låsninger — `applyTradeoffTighteningToGoals` ([boardGoals.js](backend/lib/boardGoals.js)) implementerer 2 kinds: `tighten_identity_riders` (+delta target på min_u25/min_national_riders) og `raise_sponsor_growth_target` (+delta_pct på sponsor_growth). Mål markeres `tradeoff_tightened: true` + `tradeoff_kind`. buildBoardProposal accepterer nu `tradeoffPayload`-param og applyer som sidste step. /api/board/proposal + /api/board/sign læser eksisterende board's tradeoff_payload og clearer ved sign-time. TRADEOFF_PAYLOADS_BY_REQUEST mapper request-type → payload
- F4: MAJOR pivot cool-down — `isMajorPivotRequest` returnerer true kun for more_youth_focus FRA star_signing ELLER more_results_focus FRA youth_development. resolveBoardRequest sætter `major_pivot_used_at = now()` ved approval. Availability-check blokerer videre MAJOR pivots med "Bestyrelsen har allerede accepteret en MAJOR drejning". Reset til null ved plan-renewal (frisk plan = frisk cool-down)
- F5: Window-blokering — `getBoardRequestAvailability` returnerer disabled hvis `context.raceDaysLeft <= 5`. Konstant `REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT = 5`. Kontekst pumpes fra api.js /board/status + /board/request-endpoint
- F6: Mid-cycle-låsning — for plan_type='5yr' eller '3yr', requests blokeres hvis progressPct < 50% OG abs(satisfactionDeltaPct) <= 30%. 1yr-planer har ingen mid-cycle-lås. Konstanter `MID_CYCLE_PROGRESS_THRESHOLD_PCT=50` og `MID_CYCLE_SATISFACTION_DELTA_PCT=30`
- '🔒 Strammet'-badge på GoalCard når goal.tradeoff_tightened. Beta-reset wiper alle 3 nye felter via DELETE board_profiles (eksisterende pattern, ingen ekstra ændring)
- HelpPage: 6 nye FAQ-items (mid-season-banner, MAJOR pivot cool-down, window-blokering, mid-cycle-låsning, '🔒 Strammet'-badge, live relative_rank-display)
- 36 nye backend-tests (286/286 grønne total) i [boardMidSeason.test.js](backend/lib/boardMidSeason.test.js): applyTradeoffTighteningToGoals 2 kinds + null + ikke-matchende type, isMajorPivotRequest 4 kombinationer, tradeoff+pivot-persistens i resolveBoardRequest, F4/F5/F6-guards (12 cases), buildBoardProposal tradeoff-integration, evaluateMidSeasonTrigger 3 cases, processMidSeasonReviewCron 6 cases (trigger ved midpoint, skip pre-midpoint, skip baseline+onboarding, idempotent, AI-skip, pending-board-skip)

### S-02h · Wizard-redesign — Hybrid B+A ✅ LEVERET 2026-05-05 (v2.40)
**Dep:** S-02a + S-02c. **UX-detaljer låst i Q-batch 1C Q17 + Q19 + Q20.**
**Leveret:**
- BoardPage primær view = strategisk dashboard (3 paneler side om side, **compact info-tæthed pr. Q17**: titel + tilfredshed-delta + 2-3 hovedmål + status-ikon vha. eksisterende `GOAL_STATUS_META`)
- Klik på enkelt-mål → mini-dialog modal med relevant board-member-portræt + reaktions-template
- Live preview: modifier-impact af hvert valg
- Onboarding-wizard (sæson 2): sekventielt med "Næste plan: 3yr"-progress
- **Multi-plan-fornyelse (Q19):** når 2 planer fornyes samme sæson, sekventiel modal — længste-horisont først (5yr→1yr eller 3yr→1yr), derefter 1yr automatisk efter accept. "Tilbage"-knap på 1yr-trinnet vender tilbage til længste-plan-trinnet
- **Mobile-responsiv (Q20):** 3 paneler stakker vertikalt; mini-dialog er fullscreen modal med back-knap (genbruger eksisterende Modal-pattern)
- Original close-out: 286/286 backend-tests grønne (se `docs/FEATURE_STATUS.md`).

### S-02i · Bug-fix-pass + regression-tests ✅ LEVERET 2026-05-05 (v2.41)
**Dep:** S-02a–h.
**Leveret og verificeret:**
- Bugfix: multi-plan-fornyelse (`renewalQueue`) starter med længste udløbne plan uanset klikpunkt.
- `processReplacementTrigger` og `evaluateAndApplyConsequences` gjort deps-injectable i `processTeamSeasonEnd`.
- 7 nye regression-tests for `processSeasonEnd`; original close-out: 293/293 backend-tests grønne (se `docs/FEATURE_STATUS.md`).
- Ikke genkørt i denne docs-sweep: fuld manuel S-02 e2e/soak.

### S-02j · Polish ✅ LEVERET 2026-05-05 (v2.42)
**Dep:** S-02i.
**Leveret:**
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
- `BoardPage.jsx` blev redesignet i S-02h; state-shape blev bevaret
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

## Estimat og faktisk status

**Oprindeligt estimat:** ~10-12 sessioner over 4-6 uger ved 2-3 sessioner/uge.
- Vision-lock: 1 session ✅ (denne)
- Q-batch 1B + 1C: ✅ lukket
- Implementering S-02a–i: ✅ leveret
- Polish S-02j: ✅ leveret

**Status 2026-05-05:** S-02 er komplet (10/10 slices). Se `docs/FEATURE_STATUS.md` for runtime feature truth og `docs/NOW.md` for næste arbejde.

---

## Næste session

S-02 er lukket. Næste session bør vælge et åbent issue (`gh issue list --label "claude:todo" --state open`) i stedet for at starte S-02a igen. Backlog-fil arkiveret 2026-05-06 per [#68](https://github.com/NicolaiDolmer/CyclingZone/issues/68).

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
