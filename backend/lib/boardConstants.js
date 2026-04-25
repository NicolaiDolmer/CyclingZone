export const PLAN_DURATIONS = {
  "1yr": 1,
  "3yr": 3,
  "5yr": 5,
};

export const PLAN_PENALTY_MODIFIERS = {
  "1yr": 1.0,
  "3yr": 0.8,
  "5yr": 0.6,
};

export const DIVISION_SQUAD_LIMITS = {
  1: { min: 20, max: 30 },
  2: { min: 14, max: 20 },
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

export const GOAL_METADATA_BY_TYPE = {
  top_n_finish: { category: "ranking", importance: "required", weight: 1.0 },
  stage_wins: { category: "results", importance: "required", weight: 1.0 },
  gc_wins: { category: "results", importance: "required", weight: 1.1 },
  min_u25_riders: { category: "identity", importance: "required", weight: 1.0 },
  min_national_riders: { category: "identity", importance: "required", weight: 1.0 },
  min_riders: { category: "identity", importance: "preferred", weight: 0.9 },
  no_outstanding_debt: { category: "economy", importance: "required", weight: 1.0 },
  sponsor_growth: { category: "economy", importance: "required", weight: 1.0 },
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

export const BOARD_IDENTITY_RIDER_SELECT = [
  "id",
  "is_u25",
  "salary",
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
