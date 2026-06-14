export const PLAN_DURATIONS = {
  "1yr": 1,
  "3yr": 3,
  "5yr": 5,
};

// S-02a · sekventiel forhandling i sæson 2-onboarding (5yr → 3yr → 1yr).
// Per-team progression aflæses af board_profiles-rows (api.js:3093);
// window-state er global fase-lås (transfer_windows.board_negotiation_state).
export const ONBOARDING_PLAN_SEQUENCE = ["5yr", "3yr", "1yr"];

export const BOARD_NEGOTIATION_STATES = {
  LOCKED: "locked",         // sæson 1 baseline — wizard disabled
  PENDING_5YR: "pending_5yr", // sæson 2 onboarding åbnet
  PENDING_3YR: "pending_3yr",
  PENDING_1YR: "pending_1yr",
  COMPLETE: "complete",     // onboarding færdig — normal renew-flow
};

export const VALID_BOARD_NEGOTIATION_STATES = Object.values(BOARD_NEGOTIATION_STATES);

export const PLAN_PENALTY_MODIFIERS = {
  "1yr": 1.0,
  "3yr": 0.8,
  "5yr": 0.6,
};

// NB: Dette er bestyrelsens INTERNE squad-referencer (board-flavor + det
// FRIVILLIGE min_riders-mål + squad_status thin/healthy/full). Det er IKKE den
// hårde roster-floor — den blev fjernet 2026-06-05 i MARKET_SQUAD_LIMITS
// (marketUtils.js, min=0). Bestyrelsens squad-størrelse-mål er opt-in mod
// belønning og tvinger intet, så disse værdier bevares bevidst.
//
// #1267 · Re-kalibreret til den fiktive relaunch-økonomi (8-rytter-starthold +
// auktionsvækst). De gamle div-1/div-2-værdier (20-30 / 14-20) stammede fra
// PCM-æraens fulde imports og gjorde min_riders-målet strukturelt umuligt:
// reelle trupper er 8-17 (median 13), så et star_signing-target på 24 kunne
// ALDRIG nås og trak bestyrelses-tilfredsheden ned uden spiller-indflydelse
// (driver bag den 50 % konsekvens-rate, #1187-B-scorecardet). Div 3 (8-10) var
// allerede launch-passende og bevares. Empirisk verificeret via
// boardSatisfactionHarness.js --regen-goals (simulér-før-ship).
export const DIVISION_SQUAD_LIMITS = {
  1: { min: 10, max: 16 },
  2: { min: 9, max: 13 },
  3: { min: 8, max: 10 },
};

export const CATEGORY_LABELS = {
  results: "Resultater",
  economy: "Okonomi",
  identity: "Identitet",
  ranking: "Rangering",
};

export const BASE_CATEGORY_WEIGHTS = {
  results: 0.50,
  economy: 0.20,
  identity: 0.20,
  ranking: 0.10,
};

// #1238 · Kanonisk race-kategori-hierarki for board-mål: Monuments er en
// DELMÆNGDE af klassikerne. "Klassiker" = endagsløb på WorldTour-niveau:
// Monuments-klassen er pr. definition endagsløb (uciRacePointDefaults.js:
// type "Endagslob"), mens OtherWorldTour-klasserne blander endagsløb og etapeløb,
// så race_type='single' afgør dér. Én mapping — boardGoalContext (DB-queries)
// og boardGoals (evaluering/labels) peger begge her i stedet for at definere
// hver sin liste (rod-årsagen bag #1238: arketype, policy-akse og
// race-query var ude af sync).
export const MONUMENT_RACE_CLASSES = ["Monuments"];
export const CLASSIC_RACE_CLASSES = [
  "Monuments",
  "OtherWorldTourA",
  "OtherWorldTourB",
  "OtherWorldTourC",
];

export function isMonumentRace(race = {}) {
  return MONUMENT_RACE_CLASSES.includes(race?.race_class);
}

export function isClassicRace(race = {}) {
  if (!CLASSIC_RACE_CLASSES.includes(race?.race_class)) return false;
  if (isMonumentRace(race)) return true;
  return race?.race_type === "single";
}

export const GOAL_METADATA_BY_TYPE = {
  top_n_finish: { category: "ranking", importance: "required", weight: 1.0 },
  stage_wins: { category: "results", importance: "required", weight: 1.0 },
  gc_wins: { category: "results", importance: "required", weight: 1.1 },
  min_u25_riders: { category: "identity", importance: "required", weight: 1.0 },
  min_national_riders: { category: "identity", importance: "required", weight: 1.0 },
  min_riders: { category: "identity", importance: "preferred", weight: 0.9 },
  no_outstanding_debt: { category: "economy", importance: "required", weight: 1.0 },
  sponsor_growth: { category: "economy", importance: "required", weight: 1.0 },
  // S-02d · 7 nye mål-typer (Q-batch 1B Q13 + master-doc S-02d)
  monument_podium: { category: "results", importance: "required", weight: 1.2 },
  jersey_wins: { category: "results", importance: "required", weight: 1.0 },
  signature_rider: { category: "identity", importance: "required", weight: 1.0 },
  profitable_transfers: { category: "economy", importance: "required", weight: 1.0 },
  u25_development_delta: { category: "identity", importance: "required", weight: 1.0 },
  relative_rank: { category: "ranking", importance: "required", weight: 1.0 },
  domestic_dominance: { category: "results", importance: "required", weight: 1.0 },
};

export const PERSONALITY_BY_FOCUS = {
  youth_development: {
    sports_ambition: "medium",
    financial_risk: "cautious",
    identity_strength: "high",
  },
  star_signing: {
    sports_ambition: "high",
    financial_risk: "aggressive",
    identity_strength: "medium",
  },
  balanced: {
    sports_ambition: "medium",
    financial_risk: "balanced",
    identity_strength: "medium",
  },
};

export const SPECIALIZATION_LABELS = {
  gc: "GC-hold",
  sprint: "Sprinthold",
  classics: "Klassikerhold",
  breakaway: "Etapejaegerhold",
  youth: "Ungdomshold",
  balanced: "Balanceret hold",
};

export const COMPETITIVE_TIER_LABELS = {
  contender: "Resultatklar",
  competitive: "Konkurrencedygtig",
  rebuilding: "Under opbygning",
};

export const SQUAD_STATUS_LABELS = {
  thin: "Tynd trup",
  healthy: "Sund trup",
  full: "Bred trup",
};

export const LEVELS = ["low", "medium", "high"];

export const NATIONAL_CORE_IDENTITY_BONUS_BY_STRENGTH = {
  none: 0,
  low: 0.01,
  medium: 0.03,
  high: 0.05,
};

export const STAR_PROFILE_PRESTIGE_BONUS_BY_LEVEL = {
  low: 0,
  medium: 0.02,
  high: 0.04,
  elite: 0.06,
};

export const STAR_PROFILE_GOAL_PRESSURE_BY_LEVEL = {
  low: 0,
  medium: 0,
  high: 1,
  elite: 1,
};

export const STAR_PROFILE_SPONSOR_PRESSURE_BY_LEVEL = {
  low: 0,
  medium: 0,
  high: 5,
  elite: 10,
};

// NB: market_value bruges af selectForcedListingRider (sortering + asking_price,
// #1205) — manglede før, så lag 4 listede til asking_price 0. uci_points bruges
// stadig af boardIdentity.calculateRiderStarScore (frossen kolonne, skifte = separat
// kalibrerings-beslutning, se #1205 out-of-scope).
export const BOARD_IDENTITY_RIDER_SELECT = [
  "id",
  "is_u25",
  "salary",
  "market_value",
  "uci_points",
  "nationality_code",
  "popularity",
  "stat_fl",
  "stat_bj",
  "stat_kb",
  "stat_bk",
  "stat_tt",
  "stat_bro",
  "stat_sp",
  "stat_acc",
  "stat_udh",
  "stat_mod",
  "stat_res",
  "stat_ftr",
].join(", ");

export const VALID_BOARD_FOCUSES = [
  "youth_development",
  "star_signing",
  "balanced",
];

export const VALID_BOARD_PLAN_TYPES = Object.keys(PLAN_DURATIONS);

export const VALID_BOARD_REQUEST_TYPES = [
  "lower_results_pressure",
  "more_youth_focus",
  "more_results_focus",
  "ease_identity_requirements",
];

export const BOARD_REQUEST_DEFINITIONS = {
  lower_results_pressure: {
    label: "Saenk resultatpresset",
    description: "Bed bestyrelsen om lidt mere luft i de sportslige krav i den aktive plan.",
    tradeoff_preview: "Hvis de siger ja, forventer de typisk strammere okonomisk disciplin.",
  },
  more_youth_focus: {
    label: "Mere ungdomsfokus",
    description: "Skub planen i en tydeligere ungdomsretning med mere plads til udvikling.",
    tradeoff_preview: "Hvis de siger ja, bliver U25-identiteten mere central i den aktive plan.",
  },
  more_results_focus: {
    label: "Mere resultatfokus nu",
    description: "Bed bestyrelsen om at vaegte topresultater hoejere med det samme.",
    tradeoff_preview: "Det giver ikke en lettere plan - de sportslige krav bliver skarpere.",
  },
  ease_identity_requirements: {
    label: "Lemp identitetskrav",
    description: "Bed om lidt mere fleksibilitet i trupsammensaetning og identitetsmaal.",
    tradeoff_preview: "Hvis de siger ja, skruer de typisk op for det sportslige pres i stedet.",
  },
};
