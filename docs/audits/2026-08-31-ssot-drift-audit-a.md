# Drift-audit del A: BOARD, ECONOMY, SPONSOR, PROGRESSION

> **Dette er en måleraport, ikke en SSOT.** Den beskriver hvor de fire eksisterende SSOT-dokumenter
> stemmer med koden, og hvor de ikke gør. Ingen af de fire dokumenter er ændret af denne audit.
>
> **Målt mod:** `origin/main` @ `b67a20ee4` (2026-08-30 kl. 20:24 CEST), samt prod-databasen
> (`ghwvkxzhsbbltzfnuhhz`) via read-only SELECT.
> **Måletidspunkt:** 2026-08-31, Europe/Copenhagen. Alle tidsstempler herunder er konverteret til
> dansk lokaltid; hvor et dokument citerer et UTC-tidspunkt, står det eksplicit.
>
> **PR #4388** (divisions-tillæg) og **PR #4421** (søndags-værdijob) er ÅBNE og indgår ikke som drift.
> De er behandlet særskilt i §6.

---

## 1. Scorecard

| Dokument | Linjer | Stikprøver taget | Bekræftet præcist | Drift fundet | Døde stier |
|---|---|---|---|---|---|
| `docs/BOARD_RULES.md` | 227 | 26 | 22 | 4 | 0 |
| `docs/ECONOMY_RULES.md` | 175 | 31 | 24 | 6 | 1 |
| `docs/SPONSOR_RULES.md` | 258 | 29 | 28 | 1 | 0 |
| `docs/PROGRESSION_RULES.md` | 159 | 33 | 31 | 2 | 0 |
| **I alt** | **819** | **119** | **105** | **13** | **1** |

**Hovedbilledet:** de fire dokumenter er markant mere præcise end typisk dokumentation i repoet.
Hver eneste konstant jeg slog op i BOARD §4 (11 tal), SPONSOR §6 (15 tal) og SPONSOR §1 (2 tal)
stemte eksakt. Driften sidder tre steder: (a) én død filsti der lover en vagt som ikke findes,
(b) en drift-tabel i ECONOMY der selv er blevet forældet fordi kilden blev rettet, og (c) et
konstant-navn i PROGRESSION der er skrevet forkert.

**Mest pålidelige kilde af de fire:** `SPONSOR_RULES.md`. 28 af 29 stikprøver eksakte, inklusive
alle fem arketypers 15 andele og alle seks divisions-tillægsbeløb (som jeg efterregnede mod
`SPONSOR_INCOME_BY_DIVISION`). Den ene afvigelse er et levende tal der er vokset med 1 siden 29/8.

---

## 2. `docs/BOARD_RULES.md`

### 2.1 Bekræftet præcist (22 stikprøver)

| Påstand i dokumentet | Målt | Kilde |
|---|---|---|
| Modifier-stigen 1,20 / 1,10 / 1,00 / 0,90 / 0,80 ved 80/60/40/20 | Eksakt | `backend/lib/boardEvaluation.js:108-114` |
| `satisfactionDelta = round((adjustedOverallScore − expectation) × 55)` | Eksakt, ordret | `backend/lib/boardEvaluation.js:119` |
| Effektiv modifier = gennemsnit af alle `completed` planers `budget_modifier` | Eksakt (filter på `negotiation_status === "completed"`, snit, 1.0 ved tom liste) | `backend/lib/sponsorEngine.js:193-202` |
| 15 måltyper, alle 15 navne | Eksakt, alle 15 findes som `case` | `backend/lib/boardGoals.js:352-410` |
| `sponsor_growth` filtreres bort for 1-årige planer (#1267) | Eksakt | `backend/lib/boardGoals.js:310-316` |
| Lag 2: loft = lønsum × **1,5**, gulv **5.000**, grace **30 dage** | Eksakt (`SALARY_CAP_HEADROOM_FACTOR`, `SALARY_CAP_FLOOR`, `NEW_MANAGER_SALARY_CAP_GRACE_DAYS`) | `backend/lib/boardConsequences.js:44,46,51` |
| Lag 3: **300.000 CZ$** | Eksakt (`SIGNING_RESTRICTION_PRICE_THRESHOLD = 300_000`) | `boardConsequences.js:30` |
| Lag 4: popularitet **≥ 70** eller stjerne-værdi | Eksakt (`FORCED_LISTING_PROTECTION_POPULARITY = 70`, star = `STAR_RIDER_MARKET_VALUE`) | `boardConsequences.js:55-56` |
| Lag 5: faktor **0,90**, multiplikativt, trigger <10 ELLER 2× planudløb <30 % | Eksakt (`SPONSOR_PULLOUT_FACTOR_BP = 900`, `PULLOUT_PLAN_LAPSE_TRIGGER = 2`, `..._SATISFACTION = 30`) | `boardConsequences.js:33,60-61` + `sponsorEngine.js:233` |
| Lag 6: **200.000 CZ$** ved ≥75 tilfredshed og ≥75 % mål | Eksakt (`BONUS_OFFER_AMOUNT = 200_000`, `BONUS_OFFER_GOALS_THRESHOLD = 0.75`) | `boardConsequences.js:36,39` |
| Tærsklerne 40 / 30 / 15 / 10 / 75 | Eksakt (`SATISFACTION_THRESHOLDS`) | `boardConsequences.js:18-24` |
| Lag 2-3 håndhæves via `assertSigningAllowed` | Eksakt, 4 kaldesteder | `boardConsequences.js:204`, `backend/routes/api.js:6755,7068,7589,7848` |
| `BoardPage.jsx:655` = tilfredshedsmålerens sponsor-modifier-undertekst | Eksakt | `frontend/src/pages/BoardPage.jsx:655` |
| `BoardPage.jsx:2822` = sponsor-CTA | Eksakt (betingelsen `sponsorState?.negotiable && ...` på 2822, `<button>` på 2823) | samme fil |
| `BoardPage.jsx:3152` = sponsor-modal | Eksakt (`<SponsorOfferModal`) | samme fil |
| `MAX_BOARD_MODIFIER = 1,20` | Eksakt | `backend/lib/economyConstants.js:67` |
| `board_mandate_model_enabled` = `off` | Eksakt | prod `app_config` |
| `board_relations` = 217, ikke opdateret siden 23/8 | Eksakt: 217 rækker, `max(updated_at)` = 2026-08-23 20:38 CEST | prod |
| `board_mandates` = 217 · `board_vision_milestones` = 2.059 · `team_board_members` = 1.085 | Eksakt, alle tre | prod |
| Backup `backup_board_profiles_3514_20260823` = 649 rækker | Eksakt | prod |
| `teams.sponsor_income` = 240.000 for alle hold, `plan_start_sponsor_income` = 240.000 for alle profiler | Bekræftet og bredere: 368 af 368 hold, 1 distinkt værdi; 1 distinkt værdi på tværs af alle 681 profiler | prod |
| 135 profiler har båret `sponsor_growth` | Eksakt: 135 | prod |
| 1.313 satisfaction-events for 217 hold 23/8 | Eksakt: 1.313 / 217 (CEST-dagen 2026-08-23) | prod |
| Modifier-fordeling D1 1,188 · D2 1,171 · D3 1,099 · D4 1,022, laveste 0,83 | Reproducerer inden for 0,011: D1 **1,177** · D2 **1,172** · D3 **1,097** · D4 **1,023**, laveste **0,833** | prod, 31/8 |
| `domestic_dominance` genereres ikke i praksis | Bekræftet: 0 profiler bærer den | prod |

### 2.2 Drift

| # | Dokumentets påstand | Faktisk værdi | Filsti |
|---|---|---|---|
| **B1** | "gennemsnittet af alle `completed` planers `budget_modifier` (**`economyEngine.js:288-292`**)" | Reglen er **flyttet** ud af `economyEngine.js` af PR #4390 (merged 30/8 kl. 17:37 CEST, commit `3137fe208`). Implementeringen bor nu i `computeBoardBaseModifier` i `sponsorEngine.js:193-202`. `economyEngine.js:293` er kun kaldestedet; linje 288-292 er en kommentar om nedryknings-faldskærmen | `backend/lib/sponsorEngine.js:193-202` vs. `backend/lib/economyEngine.js:288-293` |
| **B2** | "`board_mandate_model_enabled` **`off` siden 17/8 12:35**" og "`board_relations` oprettet **23/8 18:38**" | Begge tidspunkter er **UTC**, ikke dansk tid. Målt i CEST: flaget sat **17/8 kl. 14:35**, `board_relations` skrevet **23/8 kl. 20:38** | prod `app_config.updated_at`, `board_relations.updated_at` |
| **B3** | "270 events for 94 hold 29/8" | Hele CEST-døgnet 29/8: **885 events for 166 hold**. Dokumentets tal er en delvis dag (filen blev skrevet 29/8 kl. 14:04), men står uden det forbehold. Til sammenligning 30/8: 822 events / 166 hold | prod `board_satisfaction_events` |
| **B4** | "`boardWeekendFinalization.js` skriver dem" (som eneste kendte skriver) | Der er **6 filer** der rører tabellen: `boardWeekendFinalization.js`, `boardMandateEngine.js:237`, `raceRunner.js:1763,2498`, `pcmResultsImport.js`, `routes/api.js:14689`, `aiTeamGenerator.js`. Dokumentets delpåstand om at `boardEvaluation.js` og `economyEngine.js` ikke indeholder tabelnavnet er **korrekt** (0 hits i begge) | `backend/lib/` |

### 2.3 Huller (ikke drift, men fraværende regler)

- **Board test-mode (#805) er ikke nævnt nogen steder i dokumentet.** `isBoardTestModeActive` tvinger
  lag 1-modifieren til 1,0 for hele økonomien mens en testtilstand er aktiv
  (`backend/lib/economyEngine.js:281`, `sponsorEngine.resolveSponsorPayout({ boardTestMode })`).
  En mekanisme der kan nulstille hele bestyrelsens pengeeffekt hører i §2 eller §4.
- §3 nævner kun at `sponsor_growth` filtreres bort for 1-årige planer. `u25_development_delta`
  filtreres af samme grund (#57, `boardGoals.js:304-309`) og er ikke nævnt.
- §1's tal "680 profiler, heraf 618 completed" er nu 681 / 622 (levende tal, forventet drift over 2 døgn).

---

## 3. `docs/ECONOMY_RULES.md`

### 3.1 Bekræftet præcist (24 stikprøver)

| Påstand | Målt | Kilde |
|---|---|---|
| `SALARY_RATE_PRODUCTION = 0.35`, ét globalt tal, ingen divisions-skalering | Eksakt, med kodekommentar der eksplicit siger "INGEN DIVISIONS-SKALERING" | `backend/lib/economyConstants.js:250,278` |
| Frontend-spejlet har samme sats | Eksakt: `0.35` | `frontend/src/lib/marketValues.js:26` |
| `SALARY_RATE = 0.067` findes stadig, markeret legacy | Eksakt, og kommentaren bekræfter at `ACADEMY.SALARY_RATE` peger på den | `economyConstants.js:231,234` |
| Akademi bruger `computeFrozenSalary`, ikke `ACADEMY.SALARY_RATE` | Eksakt, begge filer importerer den | `academyIntake.js:12,480`, `academyTransfer.js:30,38` |
| `UPKEEP_BY_DIVISION = {1: 220_000, 2: 70_000, 3: 20_000, 4: 0}` | Eksakt | `economyConstants.js:56` |
| `SEASON_VALUE_RECALC_ENABLED = false` | Eksakt | `economyConstants.js:198` |
| `prize_earnings_bonus` = 3-sæsons-vindue med fast divisor 3 | Eksakt (`Σ earnings_s / 3`) | `economyEngine.js:1965-1968` |
| Genberegning ved præmie-udbetaling er ubetinget | Eksakt | `prizePayoutEngine.js:209` |
| `valuation_type ?? primary_type`, aldrig live `primary_type` alene | Eksakt, begge steder | `riderValuation.js:117`, `riderCareerNpv.js:104` |
| `FROZEN_NPV_RATE_BY_POTENTIAL` findes og bruges | Eksakt | `riderCareerNpv.js:71,73` |
| Auktion: egen rytter maks 1× værdi, bank/AI mindst 1× værdi | Eksakt | `auctionRules.js:120-137` |
| Prisbånd deaktiveret som default (`floor_pct=0`, `cap_multiple=null`) | Eksakt i kode OG i prod: `transfer_price_floor_pct = 0`, `transfer_price_cap_multiple = null` (sat 3/8 kl. 17:42 CEST) | `transferPriceBand.js:19,24` + prod |
| `contractExpiryAuction.js` findes ikke i repoet | Bekræftet: filen findes ikke | - |
| Kontraktudløb kører før payroll | Eksakt: Phase 5c (`contractExpiryRelease`) før Phase 6 (sponsor-payout + payroll) | `seasonTransition.js:1167,1195` |
| `wage_deduction_mode = season_upfront` | Bekræftet i prod (sat 3/8 kl. 23:15 CEST) | prod |
| De 8 `app_config`-nøgler i §4 | Alle 8 findes i koden | `backend/lib/` |
| `rulesNumbers.js` viser `academySalaryPct = 6.7` | Eksakt | `frontend/src/lib/rulesNumbers.js:70` |
| `SPONSOR_INCOME_BY_DIVISION`, `PRIZE_PER_POINT`, `STAR_RIDER_MARKET_VALUE` stemmer med GAME_INVARIANTS | Bekræftet, alle tre eksakte | `economyConstants.js:28,95,85` vs. `docs/GAME_INVARIANTS.md:12,26,27` |

### 3.2 Drift

| # | Dokumentets påstand | Faktisk værdi | Filsti |
|---|---|---|---|
| **E1** | §2 og §7: løn-satsens frontend/backend-paritet håndhæves af `frontend/src/lib/salaryRateParity.test.js`, listet i §7 som en af seks aktive vagter | **Filen findes ikke.** Ingen fil med det navn eksisterer i repoet (søgt i hele træet uden for `node_modules`). De eneste tre referencer til navnet er kommentarer: `economyConstants.js:277`, `marketValues.js:25` og selve `ECONOMY_RULES.md`. Vagten der skal forhindre at de to codebaser driver fra hinanden på lønsatsen **eksisterer ikke** | søgt: hele repoet |
| **E2** | §3-tabellen: "GAME_INVARIANTS.md siger `{1: 440_000, 2: 140_000, 3: 40_000}`". §8 modsigelse #3: "`UPKEEP_BY_DIVISION` i GAME_INVARIANTS.md er den gamle værdi fra før 23/8-halveringen" | **GAME_INVARIANTS er rettet.** Linjen står i dag på `{1: 220_000, 2: 70_000, 3: 20_000, 4: 0}` og bærer selv noten *"Halveret + D4-fritagelse af ejeren 23/8; denne linje stod på de gamle tal (440/140/40, ingen D4) indtil 25/8"* med kildehenvisning til `economyConstants.js:56`. Både drift-rækken og modsigelse #3 er forældede | `docs/GAME_INVARIANTS.md:29` |
| **E3** | §3: "`DEBT_CEILING_BY_DIVISION` ... stemmer overens mellem kode og GAME_INVARIANTS.md, verificeret, ingen afvigelse fundet" | Delvis uenighed: koden har **fire** divisioner `{1: 1200000, 2: 900000, 3: 600000, 4: 400000}`; GAME_INVARIANTS lister kun D1/D2/D3. **D4 = 400.000 mangler i GAME_INVARIANTS** | `economyConstants.js:105` vs. `docs/GAME_INVARIANTS.md:28` |
| **E4** | §3: `INITIAL_BALANCE` stemmer overens med GAME_INVARIANTS | Værdien stemmer (500.000), men konstant-**navnet** `INITIAL_BALANCE` optræder ikke i GAME_INVARIANTS. Dokumentet navngiver den `DEFAULT_BETA_BALANCE = 500_000` | `economyConstants.js:72` vs. `docs/GAME_INVARIANTS.md:11` |
| **E5** | §8 modsigelse #2 nævner kun `academySalaryPct = 6.7` som drift på `/rules` og `/help` | Samme fejl findes **to** steder: `salaryRatePct: 6.7` (senior-lønsatsen) står lige over med samme kommentar `// SALARY_RATE (0.067) × 100`. Modsigelsen er dobbelt så stor som dokumentet siger, og rammer også den almindelige lønsats spilleren læser | `frontend/src/lib/rulesNumbers.js:33` og `:70` |
| **E6** | §6 slutter: "Om flaget faktisk står `true` i prod pr. 25/8 er **ikke verificeret** i denne opgave" | Selvmodsigende i samme afsnit: citatblokken 8 linjer højere oppe siger *"Verificeret 29/8: `board_mandate_model_enabled = 'off'` i prod siden 17/8"*. Den gamle sætning blev ikke fjernet da §6 blev opdateret 29/8. Prod-værdi 31/8: `off` | `docs/ECONOMY_RULES.md` §6 |

### 3.3 Linjenumre der ikke længere passer (støj, ingen beslutningsrisiko)

| Dokumentets henvisning | Faktisk linje |
|---|---|
| §8 #1: `economyEngine.js:1429` | Gaten står på `economyEngine.js:1433` (kommentaren begynder 1430) |
| §8 #3: `economyConstants.js:51` | `UPKEEP_BY_DIVISION` står på `economyConstants.js:56` |

### 3.4 Åbne punkter jeg kunne lukke med en måling

§1, §4 og §8 #8 siger alle at søndags-sweepets on/off-status "ikke er verificeret". Målt i prod 31/8:

| Nøgle | Værdi | Sat (CEST) |
|---|---|---|
| `market_value_sweep_enabled` | `off` | 17/8 kl. 14:39 |
| `market_value_global_weight` | `0` | 17/8 kl. 14:39 |
| `market_value_weekly_cap` | `0.25` | 17/8 kl. 14:39 |

Sweepet er altså slukket **og** vægtet til 0. Modsigelse #8 kan lukkes.

---

## 4. `docs/SPONSOR_RULES.md`

### 4.1 Bekræftet præcist (28 stikprøver)

| Påstand | Målt | Kilde |
|---|---|---|
| `safe` 0,92 / 0,08 / 1 sæson / ingen klausuler | Eksakt | `backend/lib/sponsorOffers.js:79-85` |
| `loyal` 0,78 / 0,18 / 3 / signing 0,08 | Eksakt | `sponsorOffers.js:86-93` |
| `racing` 0,50 / 0,58 / 1 | Eksakt | `sponsorOffers.js:94-100` |
| `results` 0,60 / 0,12 / 2 · stage_win 0,035 · podium 0,014 · loft 0,53 | Eksakt, alle seks tal | `sponsorOffers.js:101-110` |
| `ambition` 0,70 / 0,20 / 2 · season_objective 0,38 · `top_40pct` | Eksakt, alle fem | `sponsorOffers.js:111-116` |
| Legacy: `predictable` 0,88/1 · `activity` 0,55/2 · `long` 0,73/3 + fallback `guaranteedFractionForLength` | Eksakt | `sponsorOffers.js:159-166` |
| `W_RESULTS = 0,45`, `MAX_MULTIPLIER = 1,40`, `clamp(1 + W × score, 1.00, MAX)` | Eksakt, formlen ordret | `renownEngine.js:12,13,45` |
| `top_half` 0,5 og `top_40pct` 0,4 lever side om side i `OBJECTIVE_THRESHOLD_FRACTION` | Eksakt | `sponsorContractsService.js:611` |
| `FULL_CALENDAR_DAYS = 60` som fallback-divisor | Eksakt, 6 fallback-kaldesteder | `sponsorOffers.js:16`, `sponsorContractsService.js:84,102,148,163,222` |
| `FINAL_SPONSOR_PAYOUT_CEILING` (720k/900k) har intet kaldested i backend | Bekræftet: kun definitionen `economyConstants.js:61` og en testkommentar. Ingen runtime-brug | grep, hele backend |
| ...men står som levende regel i `GAME_INVARIANTS.md:30` | Eksakt linjenummer | `docs/GAME_INVARIANTS.md:30` |
| Det reelle loft = `guaranteed_base × MAX_BOARD_MODIFIER` | Eksakt | `sponsorEngine.js:234-237` |
| `PARACHUTE_FACTOR = 0,5` ejer-låst | Eksakt | `economyConstants.js:38` |
| Divisions-tillæggets seks beløb: D3→D1 +130.000 · D2→D1 +100.000 · D4→D1 +142.500 · D4→D3 +12.500 · D2→D3 −30.000 · D3→D4 −12.500 | **Alle seks efterregnet korrekt** mod `SPONSOR_INCOME_BY_DIVISION = {1: 600000, 2: 400000, 3: 340000, 4: 315000}` med faktor 0,5 | `economyConstants.js:28,38` |
| §3 er ikke bygget: `signed_division` skal lagres på kontrakten | Bekræftet: kolonnen findes ikke. `sponsor_contracts` har 16 kolonner, ingen af dem `signed_division` | `database/schema-snapshot.json` |
| `renownTarget` er ikke en kolonne | Bekræftet, findes ikke i tabellen | samme |
| Idempotency-nøgle `sponsor_race_day:<raceId>:<teamId>` | Eksakt format | `sponsorRaceDayIncome.js:17,98` |
| `results_bonus_paid` håndhæver klausul-loftet | Bekræftet, kolonne findes og læses | `sponsorRaceDayIncome.js:197` |
| `resolveContractForNewSeason` er ren og delt af preview + udførelse | Bekræftet | `sponsorContractsService.js:216`, kaldt fra `seasonTransition.js:648` |
| `fetchPaidSponsorKeys` som pre-filter | Eksakt | `sponsorRaceDayIncome.js:48,206` |
| `scripts/sponsorChoiceScorecard.js` findes (manuel praksis, ikke CI-gate) | Bekræftet, filen findes | `scripts/sponsorChoiceScorecard.js` |
| Invariant-bruddet nedadtil er reelt og uden vagt | **Reproduceret 31/8** (se nedenfor) | prod |
| Alle 5 kildedokumenter i bunden | Alle 5 findes | `docs/superpowers/specs/`, `docs/audits/` |

### 4.2 Drift

| # | Dokumentets påstand | Faktisk værdi | Filsti |
|---|---|---|---|
| **S1** | §1: "Målt 29/8 brød **36 af 230 hold** den nedadtil (D1 21 · D2 8 · D3 7 · D4 0). Ingen brød den opadtil" | Målt 31/8: **37 af 233 aktive kontrakter** bryder gulvet (**D1 21 · D2 8 · D3 8 · D4 0**), 0 bryder loftet. Bruddet er altså **stadig live og vokset med ét hold i D3** siden dokumentet blev skrevet. Ingen vagt er tilføjet | prod: `sponsor_contracts` join `teams`, target udledt som `guaranteed_base / guaranteed_fraction` |

Det er den eneste afvigelse jeg fandt i dokumentet, og det er en levende måling, ikke en forkert regel.

### 4.3 Hul: §7's vagt-tabel mangler en vagt der blev bygget 30/8

PR #4390 (merged 30/8 kl. 17:37 CEST) tilføjede `backend/lib/sponsorPreviewPayoutParity.test.js`
(246 linjer): preview og faktisk payout køres mod samme in-memory-db og skal give samme tal,
inklusive modifier, pullout, loft-clamp og board test-mode. Den hører i §7's tabel ved siden af
`resolveContractForNewSeason`-rækken. Se §5 om hard rule 30 (c).

Samme PR flyttede `computeBoardBaseModifier` og `resolveSponsorPayout` ind i `sponsorEngine.js`,
hvilket er den ændring der gør BOARD_RULES' filhenvisning forkert (fund **B1**).

---

## 5. `docs/PROGRESSION_RULES.md`

### 5.1 Bekræftet præcist (31 stikprøver)

| Påstand | Målt | Kilde |
|---|---|---|
| `loftByPotential` markeret "SUPERSEDERET AF roleTags ... LÆSES IKKE AF MOTOREN" | **Ordret match** på kodekommentaren | `backend/lib/riderProgression.js:144-148` |
| `ROLE_CLASS_TAG` og `ROLE_CLASS_RATE` eksporteret side om side | Eksakt, med kodekommentar der siger netop det | `riderProgression.js:157-158,179` |
| De fem rolleklasser: signatur, sekundær, håndværk, anden rolle, svaghed | Eksakt, alle fem nøgler | `riderProgression.js:179-198` |
| `CRAFT_ABILITIES` = KUN `positioning` + `tactics` | Eksakt | `riderProgression.js:162` |
| Klassen udledes ét sted, `abilityRoleClass()` | Eksakt, med gulv-løft-invariant beskrevet i kommentaren | `riderProgression.js:199-220` |
| `craftFactor` / `neutralFactor` / `oppositeFactor` findes | Eksakt (0,95 / 0,45 / 0,12) | `riderProgression.js:151-153` |
| Potentiale styrer kun farten via `rateByPotential` + `youthRateForPotential`, lineær interpolation | Eksakt | `riderProgression.js:142,469-473` |
| `taperedAbsoluteCap`, `CAP_TAPER_CONFIG`, `peakAgeForType` | Alle tre findes | `riderProgression.js:332,300,278` |
| `taperedAbsoluteCap(cap, age=null)` returnerer cap uændret | Bekræftet i signaturen | `riderProgression.js:332` |
| 8 ryttertyper i `RIDER_TYPE_KEYS` | Bekræftet: præcis 8 | `weights/classifierWeights.js:31-40` |
| `GUARDS.highSpeciality` er rouleur-guarden, GC-guarden slettet i #3570 fase 2 | Eksakt, værdi 88, og kommentaren bekræfter sletningen | `riderTypes.js:92-93,102,147` |
| `RACE_DEV_CONFIG.devMult` | Eksakt: `{devMult: 1.15, devMultLo: 1.10, devMultHi: 1.20}` | `dailyTraining.js:51` |
| `RACE_PROFILE_ABILITY_MAP` bor i `dailyTrainingEngine.js` | Eksakt | `dailyTrainingEngine.js:80` |
| `noiseSpan` i `dailyTraining.js` | Eksakt (0,15) | `dailyTraining.js:16` |
| `race_day_engine_enabled` on siden 7/8 | **Bekræftet i prod:** `on`, sat 7/8 kl. 13:04 CEST | prod |
| `race_day_development_enabled` off for S3 (#4277) | **Bekræftet i prod:** `off`, sat 26/8 kl. 22:46 CEST | prod |
| De to flag er bevidst uafhængige | Eksakt, kodekommentaren siger det ordret | `raceDayDevelopmentFlag.js:20-22` |
| `racingToday` følger udviklings-flaget, rettet i #4375 | Bekræftet: både loader og response-spread hænger på `raceDayDevelopmentOn` | `backend/routes/api.js:2642,2721` |
| De 4 unit-testfiler i §8 | Alle 4 findes | `backend/lib/` |
| De 4 harness-filer i §8 | Alle 4 findes (`backend/scripts/rytterudviklingScorecard.js`, `backend/scripts/dev/curveHarness3564.mjs`, `backend/scripts/measureBestType3372.js`, `backend/scripts/scoutingInversionHarness.js`) | `backend/scripts/` |
| `spillervendteGates3709.mjs` | Findes | `backend/scripts/spillervendteGates3709.mjs` |
| `.github/workflows/calendar-invariant-audit.yml` som kontrast-eksempel | Findes | `.github/workflows/` |
| Audit-filen + de 6 design-specs i §10 | Alle 7 findes | `docs/audits/`, `docs/superpowers/specs/` |

### 5.2 Drift

| # | Dokumentets påstand | Faktisk værdi | Filsti |
|---|---|---|---|
| **P1** | §2: de 8 typenøgler er "climber, rouleur, sprinter, puncheur, baroudeur, **brosten**, gc, tt" | Nøglen hedder **`brostensrytter`**, ikke `brosten`. De øvrige 7 er korrekte. En sammenligning mod strengen `"brosten"` matcher intet og fejler tavst | `backend/lib/weights/classifierWeights.js:36` |
| **P2** | §2: nøglerne står i `backend/lib/riderTypes.js` | `RIDER_TYPE_KEYS` **eksporteres** derfra (`riderTypes.js:84`), men selve strengene er defineret i `backend/lib/weights/classifierWeights.js:31-40`. `riderTypes.js` gør kun `RIDER_TYPES = CLASSIFIER_WEIGHTS` | `riderTypes.js:57,82,84` |

### 5.3 Læsefælde (ingen faktuel fejl)

§5 bruger `D1`, `D2`, `D3`, `D4` om **#3459's fire leverance-faser** (D1 = løbsdags-gaten,
D2 = udviklings-tick, D3 = restitutions-konstanter, D4 = AI-hold). Det matcher kodens egen
navngivning i `raceDayDevelopmentFlag.js:3-14` eksakt, så dokumentet er korrekt. Men i de tre andre
SSOT-dokumenter i denne audit betyder D1-D4 altid **division**. En læser der går fra ECONOMY til
PROGRESSION kan læse "Løbsdags-UDVIKLINGEN (D1+D2) er slukket" som "slukket for division 1 og 2".

---

## 6. Hard rule 30 (c): blev SSOT'en opdateret i SAMME PR?

Hard rule 30 (c) står i `AGENTS.md:87`: *"ændrer arbejdet en regel, en konstant eller en kontrakt,
opdateres SSOT'en i SAMME PR som ændringen."*

Jeg gennemgik alle merged commits siden 2026-08-24 der rører de 11 kernefiler i de fire områder.
Der var tre.

| PR / commit | Merged (CEST) | Rørte | SSOT opdateret i samme PR? |
|---|---|---|---|
| **#4390** `3137fe208` "sponsor-preview viser den faktiske payout" | 30/8 kl. 17:37 | `sponsorEngine.js` (+75 linjer, ny `computeBoardBaseModifier` + `resolveSponsorPayout`), `economyEngine.js`, `seasonTransition.js`, ny `sponsorPreviewPayoutParity.test.js` | **NEJ.** Hverken `SPONSOR_RULES.md`, `ECONOMY_RULES.md` eller `BOARD_RULES.md` er i diffen. Konsekvens: fund **B1** (BOARD_RULES peger på en fil reglen er flyttet ud af) og §4.3 (SPONSOR_RULES' vagt-tabel mangler den nye paritetstest). PR-teksten siger selv *"Ingen økonomi-konstant og ingen payout-logik er ændret"*, hvilket er korrekt, men reglens **placering** og en **ny vagt** er begge ting §7-tabellerne dokumenterer |
| **#4279** `ddf70da62` "udskil løbsdags-udviklingen til eget flag" | 26/8 kl. 22:46 | `dailyTrainingEngine.js`, ny `raceDayDevelopmentFlag.js`, ny SQL-migration, help.json, patchNotes | **NEJ.** `docs/PROGRESSION_RULES.md` er ikke i diffen, selvom PR'en indførte et helt nyt feature-flag og flyttede ansvar mellem to flag. Dokumentet fandtes på det tidspunkt (oprettet 25/8 kl. 15:30) |
| **#4391** `395be6da4` "gate løbsdags-badgen på udviklings-flaget" | 30/8 kl. 08:50 | `racingTodayLookup.js`, `routes/api.js`, frontend, e2e | **JA.** `docs/PROGRESSION_RULES.md` er i diffen (6 linjer ændret), og det er dén PR der lukkede hullet efter #4279. Plus en learnings-fil |
| #4444 `a0f2f0d82` "chunk .in() kald" | 30/8 kl. 17:21 | `sponsorContractsService.js` (10 linjer, pagination) | Ikke relevant: ingen regel, konstant eller kontrakt ændret |

**Åbne PR'er (ikke drift, kommende ændringer):**

| PR | Emne | Rører SSOT i samme PR? |
|---|---|---|
| **#4388** | Divisions-tillægget (#4376). Rører `economyConstants.js`, `economyEngine.js`, `midSeasonSponsor.js`, `sponsorContractsService.js`, ny `divisionAdjustment.js`, migration `2026-08-29-division-adjustment.sql`, `schema.sql` | **JA:** `docs/SPONSOR_RULES.md` **og** `docs/GAME_INVARIANTS.md` er begge i diffen. Rule 30 (c) er overholdt |
| **#4421** | Værdier opdateres søndag kl. 06 i eget job (#4419). Rører `cron.js`, ny `sundayValueSweep.js`, `trainingSweep.js`, migration | **JA:** `docs/ECONOMY_RULES.md` er i diffen. Rule 30 (c) er overholdt |

Når de to merger, ændres §3 i SPONSOR_RULES fra "IKKE bygget endnu" til bygget, og
`sponsor_contracts` får kolonnen `signed_division`. Målingerne i §4.1 ovenfor (ingen
`signed_division`-kolonne) gælder kun `main` som den står i dag.

---

## 7. Prioriteret: hvad kan føre til en forkert beslutning?

### Kan koste penge eller data (ret først)

1. **E1: `salaryRateParity.test.js` findes ikke.** ECONOMY_RULES §7 lister den som en af seks
   aktive vagter under overskriften "Hvad der håndhæver hvad", og §2 gentager den. To kodefiler
   (`economyConstants.js:277`, `marketValues.js:25`) lover også at paritet "håndhæves" af den.
   En udvikler der ændrer `SALARY_RATE_PRODUCTION` i backend vil tro at en test fanger det hvis
   frontend-spejlet glemmes. Ingen test fanger det. Lønvisningen på markedet kan drive fra den
   faktiske løn uden at noget siger fra.
   Til sammenligning: den tilsvarende vagt for sponsor-loftet **findes** faktisk
   (`frontend/src/lib/rulesNumbers.test.js:61-62`), så mønsteret er kendt og virker andre steder.

2. **P1: typenøglen `brosten` findes ikke, den hedder `brostensrytter`.** PROGRESSION_RULES §2 er
   den eneste liste over de 8 typer i SSOT-form. Kode skrevet mod dokumentet vil sammenligne mod
   en streng der aldrig matcher, og fejlen er tavs: rytteren falder bare ud af den gren.

3. **E5: `/rules` viser den forkerte lønsats to steder, ikke ét.** Modsigelse #2 i ECONOMY_RULES
   nævner kun akademiet. `salaryRatePct: 6.7` er den sats spilleren læser som den almindelige
   lønregel. Retter man kun det dokumentet peger på, står den halve fejl tilbage.

### Kan sende arbejde det forkerte sted hen

4. **B1 + §4.3: PR #4390 flyttede regnestykket, SSOT'erne fulgte ikke med.** Den der læser
   BOARD_RULES §2 og åbner `economyEngine.js:288-292` finder en kommentar om faldskærme og må
   selv lede. Værre: §7-tabellen i SPONSOR_RULES bruges til at svare på "hvad forhindrer at det
   sker igen", og den nye paritetsvagt fra 30/8 står ikke i den, så den kan blive bygget en gang til.

5. **E2: ECONOMY_RULES beskylder GAME_INVARIANTS for at være forældet, men den er rettet.**
   To steder i dokumentet (§3-tabellen og §8 #3). Konsekvensen er dobbelt: nogen kan bruge tid på
   at "rette" en linje der er korrekt, og dokumentets samlede påstand om at GAME_INVARIANTS ikke
   kan stoles på svækkes uden grund.

6. **B5: board test-mode mangler i BOARD_RULES.** Et flag der nulstiller hele lag 1 for økonomien
   står ikke i dokumentet der beskriver lag 1. Ved en fejlsøgning af "hvorfor fik holdet ikke sin
   modifier" er den forklaring ikke tilgængelig for læseren.

### Støj (fiks ved lejlighed, ingen risiko)

7. **E3 / E4:** GAME_INVARIANTS mangler D4-gældsloftet, og navnet `INITIAL_BALANCE` optræder ikke
   der. ECONOMY_RULES' "ingen afvigelse fundet" er for stærkt formuleret, men ingen kan træffe en
   forkert beslutning på det.
8. **B2:** to UTC-tidspunkter præsenteret som lokaltid. Ingen regel ændres af det.
9. **B3:** et delvist døgns event-tal uden mærkat. Størrelsesordenen er 3× forkert, men tallet
   bruges ikke til noget.
10. **B4:** dokumentet nævner én skriver af `board_satisfaction_events`, der er seks.
11. **E6:** ECONOMY_RULES §6 modsiger sig selv om flagets status inden for samme afsnit.
12. **P2 og linjenumrene i §3.3:** filstier og linjenumre der er rykket. Ren støj.
13. **P1 i §5.3:** D1-D4 betyder faser i PROGRESSION og divisioner i de tre andre.

---

## 8. Hvad jeg IKKE nåede at måle

Skrives eksplicit, så ingen læser det ovenstående som en fuld dækning.

- **BOARD_RULES §7's åbne modsigelser #7 (#4377) og #8 (#4382)** er ikke efterprøvet mod issue-tråde
  eller kode. Jeg har ikke verificeret om flerårsmåls-tællerne ignorerer historik.
- **BOARD_RULES §6's påstand om at `boardMandateEngine.js` er den eneste runtime-skriver af
  `board_relations`** er ikke verificeret. Jeg bekræftede kun at tabellen ikke er opdateret siden 23/8.
- **SPONSOR_RULES §8 #2 (løbsdags-ratens divisor: D1 140 mod 155 faktiske osv.)** er ikke genmålt.
  Det kræver et opslag i sæsonens faktiske etapetal pr. division, som jeg ikke nåede.
- **SPONSOR_RULES §8 #3 (tilbuds-modalen viser op til 2,6× for høj rate)** er ikke genmålt mod UI.
- **SPONSOR_RULES §8 #7 (alle 24 D1-hold har `resultsScore = 1,0`)** er ikke genmålt.
- **PROGRESSION_RULES §6 række 1** beder selv læseren verificere om de to rating-skalaer stadig
  kører side om side. Det er ikke gjort her.
- **PROGRESSION_RULES §7 (specialiserings-gabet)** er ikke genmålt mod prod. Dokumentet henviser
  til audit-filens §B13, som jeg ikke åbnede.
- **ECONOMY_RULES §5's tvangsauktions-design** er kun verificeret negativt (modulet findes ikke).
  Jeg har ikke læst spec'en igennem for andre påstande.
- **Ingen af de fire dokumenters spillervendte tekst** (help.json, rules.json, locales) er krydset
  mod koden ud over `rulesNumbers.js`.
