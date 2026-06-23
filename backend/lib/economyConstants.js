// Single source of truth for økonomi-konstanter brugt på tværs af engines.
// Alle værdier matcher database/schema.sql defaults eller landed migrations.
// Ændring her kræver tilsvarende migration mod prod (se docs/CONVENTIONS.md).

// teams.sponsor_income DEFAULT i database/schema.sql + 2026-04-25-economy-retuning.sql.
// E2 (strict_fair_v1): nu kun LEGACY fallback-gulv — sæson-1 sponsor er division-
// skaleret via SPONSOR_INCOME_BY_DIVISION (computeSponsorForSeason intro-gren).
export const SPONSOR_INCOME_BASE = 240000;

// E2 balance-retune (strict_fair_v1, ejer-valgt 2026-06-15): sæson-1/intro-sponsor
// skaleres med division, så et kompetent hold er bæredygtigt (D1 ~break-even, D2/D3
// overskud) i stedet for at tabe ~750k/sæson på flad 240k. Autoritativ for intro-
// sæsonen i sponsorEngine.computeSponsorForSeason — den stored teams.sponsor_income-
// kolonne er kun fallback. Sæson-2+ bruger den separate variable-model (sponsorEngine).
//
// #1441 A6-kalibrering (2026-06-17): D3 hævet 260k → 340k. Den friske relaunch-
// population giver HVER trup 8 ryttere (starterSquadAllocator.SQUAD_SIZE, division-
// blind snake-draft) med en frossen lønbyrde ≈ 316k/hold i ALLE divisioner. D3-sponsoren
// (260k) lå under lønbyrden, så D3-net var negativ selv ved upkeep=0 → §4.1 kilde-re-tune
// var påkrævet for at lukke D3-loopet (spec §3.2/§4.1). Verificeret af moneySupplyScorecard
// (syntetisk fresh-population-projektion, --synthetic).
// #1608 forever-relaunch FORM-FRYS (granit, ejer-godkendt 2026-06-21 — MÅ IKKE ÆNDRES):
// tier 4 = bunden (nye managere ind fra bunden). 315k er kalibreret mod den frosne
// fresh-roster-lønbyrde ≈ 316k/hold (samme 8-rytter-allokering som tier 1-3), så tier 4
// rammer net break-even ved upkeep=0. Tier 1-3-tallene er granit fra #1441 A6 og urørt.
export const SPONSOR_INCOME_BY_DIVISION = { 1: 600000, 2: 400000, 3: 340000, 4: 315000 };

// #1441 Fase 1 — løbende upkeep (gold sink). Division-tier-skaleret, IKKE live
// roster-værdi (undgår auto-eskalerende feedback-loop).
//
// A6-KALIBRERET (2026-06-17) mod syntetisk fresh-population (ikke de gamle frosne
// live-lønninger): D1 250k→440k, D2 110k→140k, D3 30k→40k. Konveks "blød bund" (§3.1):
// den stejle top (D1) bærer anti-inflations-lasten. Mod en fresh roster-lønbyrde ≈ 316k/hold
// + repræsentativ præmie (D1 160k/D2 70k/D3 25k) rammer nettoen: D1 ≈ +3,6k (break-even,
// |net|≤30k ✅), D2 ≈ +13,6k ✅, D3 ≈ +8,6k ✅ (alle i §2.2 net-mål). Låst af
// moneySupplyScorecard --synthetic. Præmie er det blødeste input — se scorecard-noten.
// #1608 forever-relaunch FORM-FRYS (granit, ejer-godkendt 2026-06-21 — MÅ IKKE ÆNDRES):
// tier 4 upkeep = 0 (ingen gold sink i bunden — sponsoren bærer hele break-even-balancen).
export const UPKEEP_BY_DIVISION = { 1: 440000, 2: 140000, 3: 40000, 4: 0 };

// #1441 Fase 1 — FINAL sponsor-payout-loft (post board_modifier × pullout).
// S2+ = D1 750k gross × 1.2 = 900k; S1/intro = D1 600k gross × 1.2 = 720k.
// Forward-guard mod board-modifier-bypass; ingen DB-default spejler dette.
export const FINAL_SPONSOR_PAYOUT_CEILING = Object.freeze({ S1: 720000, S2_PLUS: 900000 });

// Maks board-satisfaction-modifier (bekræftet boardEvaluation.js satisfactionToModifier:
// ≥80 satisfaction → 1.20). Bruges som kontrakt-bevidst sponsor-loft-faktor (#1663):
// ceiling = guaranteed_base × MAX_BOARD_MODIFIER (guarder board-modifier-bypass uden at
// cappe legitim renown-skalering).
export const MAX_BOARD_MODIFIER = 1.20;

// teams.balance DEFAULT i database/schema.sql + 2026-04-25-economy-retuning.sql.
// Også brugt som DEFAULT_BETA_BALANCE i betaResetService.js.
// #1717 (ejer-besluttet 2026-06-22): sænket 800000 → 500000 (forever-relaunch).
export const INITIAL_BALANCE = 500000;

// Rytter-værdi (#1101 cutover 2026-06-10): market_value/salary er GENERATED fra
// base_value (model v3, riderValuationModel.json) — uci_points er afkoblet.
// Runtime-fallback: RIDER_BASE_VALUE_FALLBACK i marketUtils.js (spejler DB'ens COALESCE).

// Stjernerytter-definition (#1205): market_value >= denne tærskel. Delt diskriminator
// for force-sale-beskyttelse (boardConsequences lag 4) og team_star-achievementet —
// samme "Value" som spillerne ser i UI. Re-kalibreret 2026-06-10 (#1210, ejer valgte A)
// mod den fiktive launch-population (800 ryttere, post-#1209): >=8M = 12 ryttere (1,5%)
// = samme grænse som generatorens superstjerne-bånd, så "superstjerner er beskyttede"
// er ét begreb (5M ramte 2,5% efter re-tunen). Player-facing copy (achievements, help)
// nævner beløbet — ændres tærsklen skal copy + docs/GAME_INVARIANTS.md følge med.
export const STAR_RIDER_MARKET_VALUE = 8_000_000;

// Præmie per UCI-point ved race-import (prizePayoutEngine).
export const PRIZE_PER_POINT = 1500;

// Rente på negativ balance ved sæsonslut.
export const NEGATIVE_BALANCE_INTEREST_RATE = 0.10;

// Loan debt-loft per division (loan_config-tabel + 2026-04-30-economy-light-tune-v176.sql).
// Bruges som soft-tjek; loan_config er kanonisk runtime-værdi.
// #1608 forever-relaunch FORM-FRYS (granit, ejer-godkendt 2026-06-21 — MÅ IKKE ÆNDRES):
// tier 4 debt-loft = 400k (lavest, matcher loan_config-rækkerne i
// database/2026-06-21-tier4-economy.sql). Tier 1-3 er granit fra economy-light-tune-v176.
export const DEBT_CEILING_BY_DIVISION = { 1: 1200000, 2: 900000, 3: 600000, 4: 400000 };

// Divisions-struktur. Div 1 = toppen (bedst), MAX_DIVISION = bunden.
// Centraliseret her (#962) så fyld-fra-toppen og op/nedrykning deler samme bounds.
export const MIN_DIVISION = 1;
// #1608 forever-relaunch FORM-FRYS (granit, ejer-godkendt 2026-06-21): 4-tier-pyramide.
// Tier 4 = bunden. #1152: per-pulje op/nedrykning (processDivisionEnd) + AI-fyld-sweep
// (reconcileAiTeamsForPool) håndterer nu hold-bevægelse pr. pulje (binær-træ via pool_index).
export const MAX_DIVISION = 4;

// #1688 forever-relaunch (ejer-besluttet 2026-06-22): ægte managere kommer ind i
// MANAGER_ENTRY_DIVISION — IKKE i den strukturelle bund (MAX_DIVISION). Med nuværende
// spillertal fyldes div 4 ikke med AI; managerne koncentreres i div 3 (fyldigere felter,
// ~770 færre fyld-ryttere). Div 4 forbliver tom headroom og aktiveres ved skala (op/-
// nedrykning + signup-division revurderes når div 3 nærmer sig kapacitet). MAX_DIVISION
// (=4) er stadig den strukturelle bund for økonomi + op/nedrykning.
export const MANAGER_ENTRY_DIVISION = 3;

// Mål-antal "rigtige" hold pr. division for fyld-fra-toppen (#962). Kun aktive,
// ikke-test menneske-hold tæller med — samme filter som ranglisten (AI, test og
// frosne hold ignoreres). Div 1..MAX_DIVISION-1 har hård cap; bund-divisionen
// (MAX_DIVISION) er overflow og må vokse forbi dette tal (blød cap), så der altid
// er plads til nye hold.
export const DIVISION_CAPACITY = 20;

// #1608 forever-relaunch FORM-FRYS (granit, ejer-godkendt 2026-06-21): pulje-target =
// race-feltcap = 24. Hver pulje (league_divisions-række) sigter mod 24 hold; tallet
// forener #1608's 24-cap (race-feltinddeling) med pulje-kapaciteten, så standings-puljen
// og race-feltet altid har samme størrelse. Erstatter DIVISION_CAPACITY=20 som
// pulje-kapacitet (DIVISION_CAPACITY bevares til den eksisterende tier-brede
// fyld-fra-toppen indtil pulje-bevidst allokering lander, #1608-children Task 6/9).
export const POOL_TARGET_SIZE = 24;

// Første sæson-slut hvor op/nedrykninger må ske.
// #1152 (ejer-besluttet 2026-06-23): AKTIVERET NU — intet er låst mere. Op/nedrykning
// kører fra første sæson-slut (transition 1→2). Den per-pulje binær-træ-model
// (op 2 → forælder-pulje, ned 4 delt 2+2 → børne-puljer) er gennemregnet + simuleret
// i superpowers/specs/2026-06-23-promotion-relegation-design.md. Gate er ren
// applikationskode i economyEngine.processDivisionEnd (ingen migration).
export const FIRST_PROMOTION_RELEGATION_SEASON = 1;

// -- Saeson-skift kontrol-flags (#1155, ejer-beslutning 2026-06-08) ------------
// Tre bevidste produktbeslutninger for det foerste rigtige saeson-skift (S1->S2).
// Alle er rene applikationskode-gates (ingen migration) og taendes igen ved at
// saette true + deploy. Holdt som flags frem for slettet kode saa de er trivielle
// at genaktivere naar systemerne er klar.

// Saeson-transition skal vaere en BEVIDST manuel admin-handling -- aldrig en cron.
// Sat false efter at den automatiske cron 2026-05-21 fyrede 4 skift i traek
// (0->1->2->3->4). Vindue-luk, final whistle og squad-tjek forbliver automatiske;
// kun selve skiftet til ny saeson kraever nu et eksplicit admin-tryk.
export const SEASON_AUTO_TRANSITION_ENABLED = false;

// Rytter-vaerdi-genberegning (prize_earnings_bonus /3, #1156) ved saeson-slut.
// Slaaet fra indtil vaerdimodellen giver mening at koere ved transition (ejeren
// haandterer vaerdier separat indtil da). Naar true: processSeasonEnd kalder
// updateRiderValues som foer.
export const SEASON_VALUE_RECALC_ENABLED = false;

// Passiv rytterudvikling (#1137) ved saeson-start (kun saeson >= 2). AKTIVERET ved
// forever-relaunch 2026-06-22 (ejer-direktiv): unified peakAge=28 (PROGRESSION_CONFIG).
// processSeasonStart koerer developRidersForSeason; effektueres foerst ved saeson 1->2-
// transitionen (~4 uger), saa ryttere aldres/udvikles/pensioneres mod deres peak.
export const SEASON_RIDER_PROGRESSION_ENABLED = true;

// -- Forever-relaunch saeson-1-opstarts-gates (#1678, ejer-direktiv 2026-06-21) -----
// To rene applikationskode-flags (samme moenster som SEASON_AUTO_TRANSITION_ENABLED:
// genaktivering = saet false/true + deploy, ingen migration). De gaelder KUN
// engangs-opstarten af saeson 1 (transition 0->1) — IKKE de loebende net-kurver, som
// moneySupplyScorecard --synthetic-only granit-laaser.
//
// (1) Spring saeson-1 sponsor-udbetalingen over for hold der ALLEREDE har faaet
//     startkapital (INITIAL_BALANCE). Ejer-direktiv: undgaa dobbelt-indtaegt ved
//     opstart (800k start + sponsor i samme oejeblik). Kun saeson 1 (seasonNumber===1)
//     og kun naar holdets balance == INITIAL_BALANCE (umodificeret startkapital — har
//     holdet allerede brugt/tjent penge, er det ikke laengere "lige faaet startkapital").
export const SEASON1_SKIP_SPONSOR_IF_STARTING_CAPITAL = true;

// (2) Ingen upkeep (gold sink) FOER saesonen reelt gaar i gang (foerste loebsdag).
//     Ejer-direktiv: hold betaler ikke driftsomkostninger i opstartsfasen. Naar false:
//     upkeep-debiten i processTeamSeasonPayroll springes over hvis saesonen endnu ikke
//     har afviklet sit foerste loeb (races med completed-resultater i den aktive saeson).
//     Saet true for at gen-aktivere upkeep-ved-saeson-start som foer #1678.
export const UPKEEP_BEFORE_FIRST_RACE_ENABLED = false;

// Senior-kontrakt løn-rate. E2 (strict_fair_v1): sænket 0.10 → 0.067 (×0.67) så
// lønbyrden matcher den division-skalerede sponsor. Løn er FROSSEN ved signering
// (#1309: salary er en plain INTEGER, ikke længere GENERATED) — denne rate bruges
// af contractSeed.computeFrozenSalary (seed + on-acquire) og marketUtils.resolveRiderSalary
// (free-agent-estimat). Ungdoms-/akademi-løn har sin EGEN rate (academyFlag.ACADEMY.SALARY_RATE)
// og er IKKE påvirket. Ændring her → opdatér frontend-spejl marketValues.getRiderSalary.
export const SALARY_RATE = 0.067;

// ============================================================
// 07d Fase A: audit-trail enums.
// MUST matche database/2026-05-09-audit-log-foundation.sql CHECK constraints.
// Tilføjelse her uden migration → INSERT fejler på prod.
// ============================================================

// admin_log.action_type — alle ad-hoc admin-handlinger der skal være sporbare.
export const ADMIN_ACTION_TYPE = Object.freeze({
  AUCTION_CANCEL: "auction_cancel",
  TRANSFER_OFFER_ADMIN_CANCEL: "transfer_offer_admin_cancel",
  SWAP_OFFER_ADMIN_CANCEL: "swap_offer_admin_cancel",
  LOAN_AGREEMENT_ADMIN_CANCEL: "loan_agreement_admin_cancel",
  AUCTION_CONFIG_UPDATE: "auction_config_update",
  MARKET_PAUSE: "market_pause",
  MARKET_RESUME: "market_resume",
  BALANCE_ADJUSTMENT: "balance_adjustment",
  USER_DELETED: "user_deleted",
  ROLE_CHANGED: "role_changed",
  RACE_DELETED: "race_deleted",
  RACE_EDITED: "race_edited",
  RACE_RESULTS_IMPORTED: "race_results_imported",
  RACE_RESULTS_APPROVED: "race_results_approved",
  BETA_RESET: "beta_reset",
  PRIZE_FORCE_PAID: "prize_force_paid",
  SEASON_REPAIRED: "season_repaired",
  SEASON_STARTED: "season_started",
  SEASON_ENDED: "season_ended",
  DISCORD_WEBHOOK_ADDED: "discord_webhook_added",
  DISCORD_WEBHOOK_REMOVED: "discord_webhook_removed",
  MANUAL_OVERRIDE: "manual_override",
  ECONOMY_EXPORT: "economy_export",
  TEAM_DATA_EDITED: "team_data_edited",
  RIDER_DATA_EDITED: "rider_data_edited",
  SEASON_TRANSITION: "season_transition",
  RACE_POINTS_EDITED: "race_points_edited",
  RACE_POINT_MODEL_EDITED: "race_point_model_edited",
  RACE_POINTS_REGENERATED: "race_points_regenerated",
  TEAM_FROZEN: "team_frozen",
  TEAM_UNFROZEN: "team_unfrozen",
});

// finance_transactions.actor_type — hvem genererede pengebevægelsen.
export const FINANCE_ACTOR_TYPE = Object.freeze({
  CRON: "cron",
  API: "api",
  ADMIN: "admin",
  SYSTEM: "system",
  MIGRATION: "migration",
});

// finance_transactions.related_entity_type — hvad pengene er knyttet til.
export const FINANCE_RELATED_ENTITY = Object.freeze({
  AUCTION: "auction",
  LOAN: "loan",
  TRANSFER: "transfer",
  SWAP: "swap",
  RACE: "race",
  SEASON: "season",
  MANUAL: "manual",
});

// finance_transactions.reason_code — hvorfor pengene flyttede.
// Klar til 07d Fase B / 07c-RPC der populerer audit-kolonner i alle 16 write-paths.
//
// NB om "MUST matche database CHECK constraints" (gælder type/actor_type/
// related_entity_type): reason_code har BEVIDST INGEN CHECK-constraint i
// databasen (verificeret 2026-06-22: database/2026-05-09-audit-log-foundation.sql
// tilføjer KUN CHECK på actor_type + related_entity_type — reason_code er en
// fri nullable TEXT). En NY reason-værdi her kræver derfor INGEN migration.
export const FINANCE_REASON = Object.freeze({
  // Sæson-baserede payouts (cron)
  SEASON_START_SPONSOR: "season_start_sponsor",
  SEASON_START_UPKEEP: "season_start_upkeep",
  SEASON_END_SALARY: "season_end_salary",
  SEASON_END_DIVISION_BONUS: "season_end_division_bonus",
  SEASON_END_NEGATIVE_INTEREST: "season_end_negative_interest",
  SEASON_END_LOAN_INTEREST: "season_end_loan_interest",
  STARTING_BUDGET: "starting_budget",
  // Race-baserede payouts
  RACE_PRIZE_PAYOUT: "race_prize_payout",
  SPONSOR_RACE_DAY: "sponsor_race_day",
  // Auctions
  AUCTION_WINNER_PAYMENT: "auction_winner_payment",
  AUCTION_SELLER_PAYOUT: "auction_seller_payout",
  AUCTION_GUARANTEED_BANK_SALE: "auction_guaranteed_bank_sale",
  // Transfers
  TRANSFER_PURCHASE: "transfer_purchase",
  TRANSFER_SALE: "transfer_sale",
  SWAP_CASH_DELTA: "swap_cash_delta",
  // Rytter-handlinger (manager-initieret)
  RIDER_RELEASE_BUYOUT: "rider_release_buyout", // #1719 fyrings-/opsigelsesgebyr
  // Lejeaftaler
  LOAN_FEE_PAID: "loan_fee_paid",
  LOAN_FEE_RECEIVED: "loan_fee_received",
  LOAN_FEE_REFUNDED: "loan_fee_refunded",
  // Lån (debt)
  LOAN_PRINCIPAL_RECEIVED: "loan_principal_received",
  LOAN_REPAYMENT: "loan_repayment",
  LOAN_BUYOUT: "loan_buyout",
  LOAN_ORIGINATION_FEE: "loan_origination_fee",
  EMERGENCY_LOAN_RECEIVED: "emergency_loan_received",
  // Squad-enforcement (cron — window-close)
  SQUAD_AUTO_PURCHASE: "squad_auto_purchase",
  SQUAD_AUTO_SALE: "squad_auto_sale",
  SQUAD_VIOLATION_FINE: "squad_violation_fine",
  // Board (manager-initieret bonus-tilbud)
  BOARD_BONUS_ACCEPTED: "board_bonus_accepted",
  // Admin
  ADMIN_BALANCE_ADJUSTMENT: "admin_balance_adjustment",
  ADMIN_FORCE_PRIZE: "admin_force_prize",
  ADMIN_BETA_RESET: "admin_beta_reset",
});
