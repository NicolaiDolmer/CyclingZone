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

  return {
    division,
    squad_limits: squadLimits,
    rider_count: riderCount,
    u25_count: u25Count,
    u25_share_pct: Math.round(u25Share * 100),
    youth_level: youthLevel,
    squad_status: squadStatus,
    squad_status_label: SQUAD_STATUS_LABELS[squadStatus] || SQUAD_STATUS_LABELS.healthy,
    competitive_tier: competitiveTier,
    competitive_tier_label: COMPETITIVE_TIER_LABELS[competitiveTier] || COMPETITIVE_TIER_LABELS.competitive,
    primary_specialization: primarySpecialization,
    primary_specialization_label: SPECIALIZATION_LABELS[primarySpecialization] || SPECIALIZATION_LABELS.balanced,
    secondary_specialization: secondarySpecialization,
    secondary_specialization_label: SPECIALIZATION_LABELS[secondarySpecialization] || SPECIALIZATION_LABELS.balanced,
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

  const normalizedRider = {
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
  };
}

function calculateStarProfile(riders = []) {
  if (!riders.length) {
    return {
      level: "low",
      label: "Ukendt",
      headline_score: 0,
      star_rider_count: 0,
      share_pct: 0,
    };
  }

  const starScores = riders.map((rider) => calculateRiderStarScore(rider));
  const headlineScores = [...starScores]
    .sort((a, b) => b - a)
    .slice(0, Math.min(3, starScores.length));
  const headlineScore = averageNumbers(headlineScores);
  const starRiderCount = starScores.filter((score) => score >= 68).length;
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
    headline_score: Math.round(headlineScore),
    star_rider_count: starRiderCount,
    share_pct: sharePct,
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
