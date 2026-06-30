import {
  DIVISION_SQUAD_LIMITS,
  LEVELS,
  NATIONAL_CORE_IDENTITY_BONUS_BY_STRENGTH,
  PERSONALITY_BY_FOCUS,
  SPECIALIZATION_LABELS,
  COMPETITIVE_TIER_LABELS,
  SQUAD_STATUS_LABELS,
  STAR_PROFILE_PRESTIGE_BONUS_BY_LEVEL,
  STAR_PROFILE_GOAL_PRESSURE_BY_LEVEL,
  STAR_PROFILE_SPONSOR_PRESSURE_BY_LEVEL,
} from "./boardConstants.js";
import { clamp, roundNumber, averageNumbers, averageTopScores } from "./boardUtils.js";

export function deriveBoardPersonality({ focus = "balanced", planType = "1yr" } = {}) {
  const basePersonality = PERSONALITY_BY_FOCUS[focus] || PERSONALITY_BY_FOCUS.balanced;
  let sportsAmbition = basePersonality.sports_ambition;
  let identityStrength = basePersonality.identity_strength;

  if (planType === "1yr") {
    sportsAmbition = shiftLevel(sportsAmbition, 1);
  }

  if (planType === "5yr") {
    identityStrength = shiftLevel(identityStrength, 1);
  }

  const personality = {
    sports_ambition: sportsAmbition,
    financial_risk: basePersonality.financial_risk,
    identity_strength: identityStrength,
  };

  return {
    ...personality,
    summary: describeBoardPersonality(personality),
  };
}

// S-02b · Frosset sæson-1-snapshot.
// Computes ved sæson-1-slut (i startSequentialNegotiation) og persisteres på
// teams.season_1_identity_basis. Bruges som goal-weighting input til 5yr-forslag,
// 1yr-auto-gen, identity-feeding-badge ("Bygger på din franske kerne (5/8 ryttere)")
// og default-focus ved auto-accept (Q-batch 1C Q18 + Q21).
//
// Forskel fra deriveTeamIdentityProfile:
// - Indeholder kun de stabile aksioder narrativen bygger på (ikke fuld squad-state)
// - Dropper standing/competitive_tier (dem skifter naturligt over sæsoner)
// - Tilføjer rider_count + season_number_observed for traceability i UI/expand-text
export function computeSeasonOneIdentity({ team = null, riders = [], seasonNumber = 1 } = {}) {
  const profile = deriveTeamIdentityProfile({ team, riders });

  return {
    season_number_observed: seasonNumber,
    rider_count: profile.rider_count,
    primary_specialization: profile.primary_specialization,
    primary_specialization_label: profile.primary_specialization_label,
    primary_specialization_label_key: profile.primary_specialization_label_key,
    secondary_specialization: profile.secondary_specialization,
    youth_share_pct: profile.u25_share_pct,
    youth_level: profile.youth_level,
    national_core: profile.national_core,
    star_profile: profile.star_profile,
  };
}

// S-02b · Default-focus mapping for auto-accept.
// Når en manager glemmer at handle og race_days_completed >= 5 fyrer auto-accept,
// vælger vi det fokus der bedst matcher manageren's identitet — ikke "balanced"
// blindt (Q-bekræftelse B=b 2026-05-05).
export function deriveDefaultFocusFromIdentity(identityBasis = null) {
  if (!identityBasis) return "balanced";

  if (identityBasis.youth_level === "high") {
    return "youth_development";
  }

  if (identityBasis.star_profile?.level === "high"
    || identityBasis.star_profile?.level === "elite") {
    return "star_signing";
  }

  if (identityBasis.primary_specialization === "youth") {
    return "youth_development";
  }

  if (identityBasis.primary_specialization === "gc"
    || identityBasis.primary_specialization === "sprint"
    || identityBasis.primary_specialization === "classics") {
    return "star_signing";
  }

  return "balanced";
}

export function deriveTeamIdentityProfile({ team = null, riders = [], standing = null } = {}) {
  const riderPool = Array.isArray(riders) && riders.length
    ? riders
    : Array.isArray(team?.riders)
      ? team.riders
      : [];
  const division = normalizeDivision(team?.division ?? standing?.division) ?? 3;
  const squadLimits = getDivisionSquadLimits(division);
  const normalizedRiders = riderPool.map((rider) => normalizeBoardRider(rider));
  const riderCount = normalizedRiders.length;
  const u25Count = normalizedRiders.filter((rider) => rider.is_u25).length;
  const u25Share = riderCount > 0 ? u25Count / riderCount : 0;
  const youthLevel = u25Share >= 0.45 ? "high" : u25Share >= 0.25 ? "medium" : "low";
  const squadStatus = riderCount <= squadLimits.min
    ? "thin"
    : riderCount >= Math.max(squadLimits.max - 1, squadLimits.min)
      ? "full"
      : "healthy";
  const competitiveTier = deriveCompetitiveTier({ division, standing });
  const specializationScores = calculateTeamSpecializationScores(normalizedRiders, u25Share);
  const nationalCore = calculateNationalCore(normalizedRiders);
  const starProfile = calculateStarProfile(normalizedRiders);
  const [primaryEntry, secondaryEntry] = Object.entries(specializationScores)
    .sort((a, b) => b[1] - a[1]);
  const primarySpecialization = riderCount === 0 ? "balanced" : (primaryEntry?.[0] || "balanced");
  const secondarySpecialization = riderCount === 0 ? "youth" : (secondaryEntry?.[0] || "balanced");
  // #1084 · i18n-koder ved siden af de danske labels (frontend resolver via
  // board.json med dansk råtekst som fallback — samme mønster som #917/#694).
  const squadStatusKey = SQUAD_STATUS_LABELS[squadStatus] ? squadStatus : "healthy";
  const competitiveTierKey = COMPETITIVE_TIER_LABELS[competitiveTier] ? competitiveTier : "competitive";
  const primarySpecializationKey = SPECIALIZATION_LABELS[primarySpecialization] ? primarySpecialization : "balanced";
  const secondarySpecializationKey = SPECIALIZATION_LABELS[secondarySpecialization] ? secondarySpecialization : "balanced";

  return {
    division,
    squad_limits: squadLimits,
    rider_count: riderCount,
    u25_count: u25Count,
    u25_share_pct: Math.round(u25Share * 100),
    youth_level: youthLevel,
    squad_status: squadStatus,
    squad_status_label: SQUAD_STATUS_LABELS[squadStatus] || SQUAD_STATUS_LABELS.healthy,
    squad_status_label_key: `squadStatus.${squadStatusKey}`,
    competitive_tier: competitiveTier,
    competitive_tier_label: COMPETITIVE_TIER_LABELS[competitiveTier] || COMPETITIVE_TIER_LABELS.competitive,
    competitive_tier_label_key: `competitiveTier.${competitiveTierKey}`,
    primary_specialization: primarySpecialization,
    primary_specialization_label: SPECIALIZATION_LABELS[primarySpecialization] || SPECIALIZATION_LABELS.balanced,
    primary_specialization_label_key: `specialization.${primarySpecializationKey}`,
    secondary_specialization: secondarySpecialization,
    secondary_specialization_label: SPECIALIZATION_LABELS[secondarySpecialization] || SPECIALIZATION_LABELS.balanced,
    secondary_specialization_label_key: `specialization.${secondarySpecializationKey}`,
    national_core: nationalCore,
    star_profile: starProfile,
    summary: buildIdentityProfileSummary({
      primarySpecialization,
      secondarySpecialization,
      youthLevel,
      squadStatus,
      nationalCore,
      starProfile,
    }),
    // #1084 · ICU-param-kontrakt: frontend komponerer summary-sætningen af
    // fragment-keys (identitySummary.*) ud fra disse koder; den danske
    // `summary` ovenfor er fallback for gamle klienter/manglende keys.
    summary_key: "identitySummary.template",
    summary_params: {
      primarySpecialization: primarySpecializationKey,
      secondarySpecialization: secondarySpecializationKey,
      youthLevel: ["high", "medium", "low"].includes(youthLevel) ? youthLevel : "medium",
      squadStatus: squadStatusKey,
      nationalCoreEstablished: Boolean(nationalCore?.established && nationalCore?.code),
      nationalCoreCode: nationalCore?.code || null,
      nationalCoreSharePct: nationalCore?.share_pct ?? 0,
      starProfileLevel: starProfile?.level || null,
    },
  };
}

export function getDivisionSquadLimits(division) {
  return DIVISION_SQUAD_LIMITS[normalizeDivision(division) ?? 3];
}

export function normalizeBoardRider(rider = {}) {
  const numericKeys = [
    "uci_points",
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
  ];

  const firstname = typeof rider.firstname === "string" ? rider.firstname.trim() : "";
  const lastname = typeof rider.lastname === "string" ? rider.lastname.trim() : "";

  const normalizedRider = {
    // #1889 · Bær rytter-identitet med så star_profile kan navngive profilrytterne
    // (Board-kortet viste før kun et antal). id/firstname/lastname kommer fra
    // BOARD_IDENTITY_RIDER_SELECT; tilstedeværende kolonner, ingen migration.
    id: rider.id ?? null,
    firstname,
    lastname,
    name: `${firstname} ${lastname}`.trim(),
    is_u25: Boolean(rider.is_u25),
    nationality_code: typeof rider.nationality_code === "string"
      ? rider.nationality_code.trim().toUpperCase()
      : null,
  };

  numericKeys.forEach((key) => {
    normalizedRider[key] = Number(rider?.[key] || 0);
  });

  return normalizedRider;
}

export function hasStrongNationalCore(identityProfile = null) {
  return Boolean(
    identityProfile?.national_core?.established
    && ["medium", "high"].includes(identityProfile?.national_core?.strength)
  );
}

export function hasStrongStarProfile(identityProfile = null) {
  return ["high", "elite"].includes(identityProfile?.star_profile?.level);
}

export function getNationalCoreIdentityBonus(nationalCore = null, hasExplicitNationalGoal = false) {
  if (!nationalCore?.established) return 0;

  const baseBonus = NATIONAL_CORE_IDENTITY_BONUS_BY_STRENGTH[nationalCore.strength || "none"] || 0;
  return roundNumber(hasExplicitNationalGoal ? (baseBonus * 0.5) : baseBonus);
}

export function getStarProfilePrestigeBonus(starProfile = null) {
  return STAR_PROFILE_PRESTIGE_BONUS_BY_LEVEL[starProfile?.level || "low"] || 0;
}

export function getStarProfileGoalPressure(starProfile = null) {
  return STAR_PROFILE_GOAL_PRESSURE_BY_LEVEL[starProfile?.level || "low"] || 0;
}

export function getStarProfileSponsorPressure(starProfile = null) {
  return STAR_PROFILE_SPONSOR_PRESSURE_BY_LEVEL[starProfile?.level || "low"] || 0;
}

function normalizeDivision(division) {
  const normalizedDivision = Number(division);
  return DIVISION_SQUAD_LIMITS[normalizedDivision] ? normalizedDivision : null;
}

function deriveCompetitiveTier({ division, standing } = {}) {
  const rank = standing?.rank_in_division;
  if (rank != null) {
    if (rank <= 2) return "contender";
    if (rank <= 4) return "competitive";
    return "rebuilding";
  }

  return (division ?? 3) === 1 ? "competitive" : "rebuilding";
}

function calculateNationalCore(riders = []) {
  if (!riders.length) {
    return {
      code: null,
      count: 0,
      share_pct: 0,
      strength: "none",
      established: false,
      label: "Blandet trup",
      label_key: "nationalCoreLabel.mixed",
      label_params: {},
    };
  }

  const nationalityCounts = new Map();
  riders.forEach((rider) => {
    if (!rider.nationality_code) return;
    nationalityCounts.set(
      rider.nationality_code,
      (nationalityCounts.get(rider.nationality_code) || 0) + 1
    );
  });

  const [code, count] = [...nationalityCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0] || [];

  if (!code || !count) {
    return {
      code: null,
      count: 0,
      share_pct: 0,
      strength: "none",
      established: false,
      label: "Blandet trup",
      label_key: "nationalCoreLabel.mixed",
      label_params: {},
    };
  }

  const share = count / Math.max(riders.length, 1);
  const strength = share >= 0.55 ? "high" : share >= 0.40 ? "medium" : share >= 0.30 ? "low" : "none";
  const established = count >= 4 && share >= 0.35;

  return {
    code,
    count,
    share_pct: Math.round(share * 100),
    strength,
    established,
    label: established
      ? strength === "high"
        ? `Tydelig ${code}-kerne`
        : `${code}-kerne`
      : "Blandet trup",
    // #1084 · {country}-param resolves i frontend via getCountryDisplay(code).
    label_key: established
      ? strength === "high"
        ? "nationalCoreLabel.clearCore"
        : "nationalCoreLabel.core"
      : "nationalCoreLabel.mixed",
    label_params: established ? { country: code } : {},
  };
}

// #1889 · Frosset star-rider-tærskel (score >= STAR_RIDER_SCORE_THRESHOLD).
// Vægtning + tærskel er låst per boardConstants.js / #1205 — Board-kortet
// navngiver nu de kvalificerende ryttere men ÆNDRER IKKE udvælgelsen.
const STAR_RIDER_SCORE_THRESHOLD = 68;

function calculateStarProfile(riders = []) {
  if (!riders.length) {
    return {
      level: "low",
      label: "Ukendt",
      label_key: "starProfileLevel.low",
      headline_score: 0,
      star_rider_count: 0,
      share_pct: 0,
      star_riders: [],
    };
  }

  const scoredRiders = riders.map((rider) => ({
    id: rider.id ?? null,
    name: rider.name || `${rider.firstname || ""} ${rider.lastname || ""}`.trim(),
    firstname: rider.firstname || "",
    lastname: rider.lastname || "",
    score: calculateRiderStarScore(rider),
  }));
  const starScores = scoredRiders.map((rider) => rider.score);
  const headlineScores = [...starScores]
    .sort((a, b) => b - a)
    .slice(0, Math.min(3, starScores.length));
  const headlineScore = averageNumbers(headlineScores);
  // #1889 · Selvsamme tærskel som star_rider_count — de navngivne ryttere
  // ER tællingen, ikke en separat liste, så antal og navne aldrig divergerer.
  const starRiders = scoredRiders
    .filter((rider) => rider.score >= STAR_RIDER_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  const starRiderCount = starRiders.length;
  const sharePct = Math.round((starRiderCount / riders.length) * 100);

  let level = "low";
  if (headlineScore >= 82 || starRiderCount >= 3) {
    level = "elite";
  } else if (headlineScore >= 68 || starRiderCount >= 2) {
    level = "high";
  } else if (headlineScore >= 52 || starRiderCount >= 1) {
    level = "medium";
  }

  return {
    level,
    label: {
      low: "Ukendt",
      medium: "Lokalkendt",
      high: "Nationalt kendt",
      elite: "Verdenskendt",
    }[level] || "Ukendt",
    label_key: `starProfileLevel.${["low", "medium", "high", "elite"].includes(level) ? level : "low"}`,
    headline_score: Math.round(headlineScore),
    star_rider_count: starRiderCount,
    share_pct: sharePct,
    star_riders: starRiders,
  };
}

function calculateRiderStarScore(rider = {}) {
  const popularityScore = clamp(Number(rider.popularity || 0), 0, 100);
  const uciScore = clamp(Math.round(Number(rider.uci_points || 0) / 4.5), 0, 100);
  return roundNumber((popularityScore * 0.70) + (uciScore * 0.30));
}

function calculateTeamSpecializationScores(riders = [], u25Share = 0) {
  if (!riders.length) {
    return {
      gc: 0,
      sprint: 0,
      classics: 0,
      breakaway: 0,
      youth: roundNumber(u25Share * 100),
      balanced: 1,
    };
  }

  const scoreByKeys = (keys) => averageTopScores(
    riders,
    (rider) => averageNumbers(keys.map((key) => rider[key] || 0))
  );

  return {
    gc: scoreByKeys(["stat_bj", "stat_kb", "stat_tt", "stat_mod", "stat_res"]),
    sprint: scoreByKeys(["stat_fl", "stat_sp", "stat_acc", "stat_res"]),
    classics: scoreByKeys(["stat_fl", "stat_bk", "stat_bro", "stat_mod"]),
    breakaway: scoreByKeys(["stat_bj", "stat_kb", "stat_ftr", "stat_udh"]),
    youth: roundNumber((u25Share * 100) + (scoreByKeys(["stat_kb", "stat_udh", "stat_res"]) * 0.15)),
    balanced: roundNumber(scoreByKeys(["stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_sp"]) * 0.92),
  };
}

function buildIdentityProfileSummary({
  primarySpecialization = "balanced",
  secondarySpecialization = "balanced",
  youthLevel = "medium",
  squadStatus = "healthy",
  nationalCore = null,
  starProfile = null,
} = {}) {
  const youthLabel = {
    high: "starkt ungdomsaftryk",
    medium: "moderat ungdomsandel",
    low: "lav ungdomsandel",
  }[youthLevel] || "moderat ungdomsandel";
  const squadLabel = {
    thin: "en tynd trup",
    healthy: "en sund trup",
    full: "en bred trup",
  }[squadStatus] || "en sund trup";
  const primaryLabel = SPECIALIZATION_LABELS[primarySpecialization] || SPECIALIZATION_LABELS.balanced;
  const secondaryLabel = (SPECIALIZATION_LABELS[secondarySpecialization] || SPECIALIZATION_LABELS.balanced).toLowerCase();
  const nationalLabel = nationalCore?.established && nationalCore?.code
    ? `${nationalCore.code}-kerne pa ${nationalCore.share_pct}%`
    : "blandet national profil";
  const starLabel = starProfile?.label
    ? `stjerneprofil: ${starProfile.label.toLowerCase()}`
    : "ingen tydelig stjerneprofil";

  return `${primaryLabel} med sekundar ${secondaryLabel}-retning, ${youthLabel}, ${squadLabel}, ${nationalLabel} og ${starLabel}.`;
}

function describeBoardPersonality(personality) {
  const ambitionLabel = {
    low: "lav sportslig ambition",
    medium: "moderat sportslig ambition",
    high: "hoj sportslig ambition",
  }[personality.sports_ambition] || "moderat sportslig ambition";

  const riskLabel = {
    cautious: "forsigtig okonomisk risikovillighed",
    balanced: "balanceret okonomisk risikovillighed",
    aggressive: "aggressiv okonomisk risikovillighed",
  }[personality.financial_risk] || "balanceret okonomisk risikovillighed";

  const identityLabel = {
    low: "svag identitetsstyrke",
    medium: "moderat identitetsstyrke",
    high: "stark identitetsstyrke",
  }[personality.identity_strength] || "moderat identitetsstyrke";

  return `${ambitionLabel}, ${riskLabel} og ${identityLabel}.`;
}

function shiftLevel(level, delta) {
  const currentIndex = LEVELS.indexOf(level);
  const nextIndex = clamp(currentIndex + delta, 0, LEVELS.length - 1);
  return LEVELS[nextIndex];
}
