import {
  PLAN_DURATIONS,
  PLAN_PENALTY_MODIFIERS,
  GOAL_METADATA_BY_TYPE,
  DIVISION_SQUAD_LIMITS,
} from "./boardConstants.js";
import {
  deriveTeamIdentityProfile,
  deriveBoardPersonality,
  getDivisionSquadLimits,
  normalizeBoardRider,
  getStarProfileGoalPressure,
  getStarProfileSponsorPressure,
} from "./boardIdentity.js";
import { applyDnaWeightingToGoals, buildDnaTraditionGoal } from "./boardClubDna.js";
import { SPONSOR_INCOME_BASE } from "./economyConstants.js";
import {
  clamp,
  clampToStep,
  roundNumber,
  safeJsonParse,
  scoreHigherBetter,
  scoreLowerBetter,
  scoreDebtGoal,
} from "./boardUtils.js";

export function getPlanDuration(planType) {
  return PLAN_DURATIONS[planType] ?? 1;
}

export function parseBoardGoals(rawGoals) {
  const parsedGoals = Array.isArray(rawGoals)
    ? rawGoals
    : typeof rawGoals === "string" && rawGoals.trim()
      ? safeJsonParse(rawGoals, [])
      : [];

  return parsedGoals.map((goal) => addGoalMetadata(goal));
}

export function generateBoardGoals({
  focus = "balanced",
  planType = "1yr",
  team = null,
  riders = [],
  standing = null,
} = {}) {
  const planDuration = getPlanDuration(planType);
  const isMultiYear = planDuration > 1;
  const penaltyModifier = PLAN_PENALTY_MODIFIERS[planType] || 1.0;
  const riderPool = Array.isArray(riders) && riders.length
    ? riders
    : Array.isArray(team?.riders)
      ? team.riders
      : [];
  const division = normalizeDivisionForGoals(team?.division ?? standing?.division);
  const useDynamicTargets = division != null || riderPool.length > 0 || standing?.rank_in_division != null;
  const identityProfile = useDynamicTargets
    ? deriveTeamIdentityProfile({ team, riders: riderPool, standing })
    : null;
  const squadLimits = identityProfile?.squad_limits || (division != null ? getDivisionSquadLimits(division) : null);

  const youthRankingTarget = useDynamicTargets
    ? getDynamicRankingTarget({
      baseTarget: 5,
      focus: "youth_development",
      division,
      standing,
      identityProfile,
    })
    : 5;
  const starRankingTarget = useDynamicTargets
    ? getDynamicRankingTarget({
      baseTarget: 3,
      focus: "star_signing",
      division,
      standing,
      identityProfile,
    })
    : 3;
  const balancedRankingTarget = useDynamicTargets
    ? getDynamicRankingTarget({
      baseTarget: 4,
      focus: "balanced",
      division,
      standing,
      identityProfile,
    })
    : 4;
  const youthStageWinsTarget = useDynamicTargets
    ? getDynamicStageWinsTarget({
      baseTarget: isMultiYear ? Math.round(planDuration * 0.8) : 1,
      focus: "youth_development",
      planDuration,
      isMultiYear,
      standing,
      identityProfile,
    })
    : (isMultiYear ? Math.round(planDuration * 0.8) : 1);
  const starGcWinsTarget = useDynamicTargets
    ? getDynamicGcWinsTarget({
      baseTarget: isMultiYear ? Math.max(1, Math.round(planDuration * 0.6)) : 1,
      planDuration,
      isMultiYear,
      identityProfile,
    })
    : (isMultiYear ? Math.max(1, Math.round(planDuration * 0.6)) : 1);
  const balancedStageTarget = useDynamicTargets
    ? getDynamicStageWinsTarget({
      baseTarget: isMultiYear ? Math.round(2 * planDuration * 0.7) : 2,
      focus: "balanced",
      planDuration,
      isMultiYear,
      standing,
      identityProfile,
    })
    : (isMultiYear ? Math.round(2 * planDuration * 0.7) : 2);
  const youthU25Target = useDynamicTargets
    ? getDynamicU25Target({
      planDuration,
      division,
      identityProfile,
    })
    : 5;
  const starMinRidersTarget = useDynamicTargets
    ? getDynamicMinRiderTarget({
      focus: "star_signing",
      identityProfile,
    })
    : 20;
  const balancedMinRidersTarget = useDynamicTargets
    ? getDynamicMinRiderTarget({
      focus: "balanced",
      identityProfile,
    })
    : 15;
  const balancedNationalIdentityGoal = useDynamicTargets
    ? buildNationalIdentityGoal({ identityProfile })
    : null;
  const sponsorGrowthTarget = useDynamicTargets
    ? getDynamicSponsorGrowthTarget({
      baseTarget: isMultiYear ? planDuration * 5 : 10,
      focus: "star_signing",
      planDuration,
      division,
      standing,
      team,
      identityProfile,
    })
    : (isMultiYear ? planDuration * 5 : 10);

  const baseGoals = {
    youth_development: [
      {
        type: "min_u25_riders",
        target: youthU25Target,
        label: `Min. ${youthU25Target} U25-ryttere pa holdet`,
        satisfaction_bonus: 15,
        satisfaction_penalty: 10,
      },
      {
        type: "top_n_finish",
        target: youthRankingTarget,
        label: isMultiYear
          ? `Top ${youthRankingTarget} i divisionen ved planens afslutning`
          : `Top ${youthRankingTarget} i divisionen`,
        satisfaction_bonus: 10,
        satisfaction_penalty: 5,
      },
      {
        type: "stage_wins",
        target: youthStageWinsTarget,
        label: isMultiYear
          ? `Mindst ${youthStageWinsTarget} etapesejre over planperioden`
          : `Mindst ${youthStageWinsTarget} etapesejr${youthStageWinsTarget !== 1 ? "er" : ""}`,
        cumulative: isMultiYear,
        satisfaction_bonus: 20,
        satisfaction_penalty: 0,
      },
      {
        type: "no_outstanding_debt",
        target: 0,
        label: "Ingen udestaende gaeld ved saesonslut",
        satisfaction_bonus: 12,
        satisfaction_penalty: 8,
      },
      // S-02d · Q-batch 1B Q13: gnsn. >=3 stat-points/saeson paa U25-ryttere
      {
        type: "u25_development_delta",
        target: 3,
        label: "Gennemsnitlig U25-stat-gevinst >= 3 stat-points/saeson",
        satisfaction_bonus: 18,
        satisfaction_penalty: 8,
      },
    ],
    star_signing: [
      {
        type: "top_n_finish",
        target: starRankingTarget,
        label: isMultiYear
          ? `Top ${starRankingTarget} i divisionen ved planens afslutning`
          : `Top ${starRankingTarget} i divisionen`,
        satisfaction_bonus: 20,
        satisfaction_penalty: 15,
      },
      {
        type: "gc_wins",
        target: starGcWinsTarget,
        label: isMultiYear
          ? `Mindst ${starGcWinsTarget} samlede sejre over planperioden`
          : starGcWinsTarget === 1
            ? "Mindst 1 samlet sejr"
            : `Mindst ${starGcWinsTarget} samlede sejre`,
        cumulative: isMultiYear,
        satisfaction_bonus: 25,
        satisfaction_penalty: 10,
      },
      {
        type: "min_riders",
        target: starMinRidersTarget,
        label: `Hold pa min. ${starMinRidersTarget} ryttere`,
        min_target: squadLimits?.min ?? 5,
        max_target: squadLimits?.max ?? null,
        satisfaction_bonus: 5,
        satisfaction_penalty: 10,
      },
      {
        type: "sponsor_growth",
        target: sponsorGrowthTarget,
        label: isMultiYear
          ? `Sponsor-indkomst vokset med ${sponsorGrowthTarget}% over planperioden`
          : `Sponsor-indkomst vokset med ${sponsorGrowthTarget}%`,
        satisfaction_bonus: 15,
        satisfaction_penalty: 10,
      },
      // S-02d · Q-batch 1B Q13: 1 rytter med popularity >= 75
      {
        type: "signature_rider",
        target: 1,
        label: "Mindst 1 stjerne-rytter (popularity >= 75)",
        satisfaction_bonus: 18,
        satisfaction_penalty: 10,
      },
    ],
    balanced: [
      {
        type: "top_n_finish",
        target: balancedRankingTarget,
        label: isMultiYear
          ? `Top ${balancedRankingTarget} i divisionen ved planens afslutning`
          : `Top ${balancedRankingTarget} i divisionen`,
        satisfaction_bonus: 15,
        satisfaction_penalty: 8,
      },
      balancedNationalIdentityGoal || {
        type: "min_riders",
        target: balancedMinRidersTarget,
        label: `Hold pa min. ${balancedMinRidersTarget} ryttere`,
        min_target: squadLimits?.min ?? 5,
        max_target: squadLimits?.max ?? null,
        satisfaction_bonus: 5,
        satisfaction_penalty: 10,
      },
      {
        type: "stage_wins",
        target: balancedStageTarget,
        label: isMultiYear
          ? `Mindst ${balancedStageTarget} etapesejre over planperioden`
          : `Mindst ${balancedStageTarget} etapesejr${balancedStageTarget !== 1 ? "er" : ""}`,
        cumulative: isMultiYear,
        satisfaction_bonus: 10,
        satisfaction_penalty: 5,
      },
      {
        type: "no_outstanding_debt",
        target: 0,
        label: "Ingen udestaende gaeld ved saesonslut",
        satisfaction_bonus: 12,
        satisfaction_penalty: 8,
      },
      // S-02d · Q-F: slut foran mindst 3 andre managers i divisionen
      {
        type: "relative_rank",
        target: 3,
        label: "Slut foran mindst 3 andre managers i divisionen",
        satisfaction_bonus: 12,
        satisfaction_penalty: 8,
      },
    ],
  };

  const selectedGoals = (baseGoals[focus] || baseGoals.balanced)
    // #57 · u25_development_delta kan aldrig evalueres på en 1-årig plan: den
    // kræver et plan-start-snapshot som baseline (delta = (current_avg −
    // plan_start_avg) / seasons_completed), men en 1yr-plan (= 1 sæson) har aldrig
    // et tidligere snapshot → målet returnerer altid awaiting_data. Hold det ude
    // af 1yr-pakker (kun multi-year, hvor en baseline findes).
    .filter((goal) => isMultiYear || goal.type !== "u25_development_delta");
  return selectedGoals.map((goal) => addGoalMetadata({
    ...goal,
    satisfaction_penalty: Math.round(goal.satisfaction_penalty * penaltyModifier),
  }));
}

export function buildNegotiatedGoal(goal) {
  const enrichedGoal = addGoalMetadata(goal);

  switch (enrichedGoal.type) {
    case "top_n_finish": {
      const target = enrichedGoal.target + 2;
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: `Top ${target} i divisionen`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "stage_wins": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: enrichedGoal.cumulative
          ? `Mindst ${target} etapesejre over planperioden`
          : `Mindst ${target} etapesejr${target !== 1 ? "er" : ""}`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "gc_wins": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: enrichedGoal.cumulative
          ? `Mindst ${target} samlede sejre over planperioden`
          : `Mindst ${target} samlet sejr`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "min_u25_riders": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: `Min. ${target} U25-ryttere pa holdet`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "min_national_riders": {
      const target = Math.max(2, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: buildGoalLabel({ ...enrichedGoal, target }),
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "min_riders": {
      const target = Math.max(enrichedGoal.min_target ?? 5, enrichedGoal.target - 3);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: `Hold pa min. ${target} ryttere`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "sponsor_growth": {
      const target = Math.max(5, enrichedGoal.target - 5);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: `Sponsor-indkomst vokset med ${target}%`,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    // S-02d · 7 nye mål-typer
    case "monument_podium": {
      // Allerede minimum (1) — kan ikke lempes på target. Kun penalty halveres.
      return addGoalMetadata({
        ...enrichedGoal,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "jersey_wins": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: buildGoalLabel({ ...enrichedGoal, target }),
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "signature_rider": {
      // target=1 er minimum — kan ikke lempes mere
      return addGoalMetadata({
        ...enrichedGoal,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "profitable_transfers": {
      const target = Math.max(50_000, enrichedGoal.target - 50_000);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: buildGoalLabel({ ...enrichedGoal, target }),
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "u25_development_delta": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: buildGoalLabel({ ...enrichedGoal, target }),
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "relative_rank": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: buildGoalLabel({ ...enrichedGoal, target }),
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "domestic_dominance": {
      const target = Math.max(1, enrichedGoal.target - 1);
      return addGoalMetadata({
        ...enrichedGoal,
        target,
        label: buildGoalLabel({ ...enrichedGoal, target }),
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
    }
    case "no_outstanding_debt":
    default:
      return addGoalMetadata({
        ...enrichedGoal,
        satisfaction_penalty: Math.round(enrichedGoal.satisfaction_penalty * 0.5),
        negotiated: true,
      });
  }
}

// S-02g · Tradeoff-stramning fra approved board request anvendes på næste plan-renewal.
// Hardkodet pr. request-type (Q-batch 1B Q16):
//   - lower_results_pressure  →  tighten_identity_riders (target+1 på min_u25/min_national)
//   - ease_identity_requirements →  raise_sponsor_growth_target (target+5pp på sponsor_growth)
// Pure function — ingen side-effects, ingen DB. Markerer modificerede mål med tradeoff_tightened: true
// så frontend kan rendere "🔒 Strammet af bestyrelsen"-badge.
export function applyTradeoffTighteningToGoals(goals, payload) {
  if (!payload || !goals?.length) return goals || [];
  const kind = payload.kind;

  if (kind === "tighten_identity_riders") {
    const delta = Number(payload.delta) || 1;
    return goals.map((goal) => {
      if (goal.type === "min_u25_riders" || goal.type === "min_national_riders") {
        const newTarget = Math.max(1, (Number(goal.target) || 0) + delta);
        return addGoalMetadata({
          ...goal,
          target: newTarget,
          label: buildGoalLabel({ ...goal, target: newTarget }),
          tradeoff_tightened: true,
          tradeoff_kind: kind,
        });
      }
      return goal;
    });
  }

  if (kind === "raise_sponsor_growth_target") {
    const deltaPct = Number(payload.delta_pct) || 5;
    return goals.map((goal) => {
      if (goal.type === "sponsor_growth") {
        const newTarget = (Number(goal.target) || 0) + deltaPct;
        return addGoalMetadata({
          ...goal,
          target: newTarget,
          label: buildGoalLabel({ ...goal, target: newTarget }),
          tradeoff_tightened: true,
          tradeoff_kind: kind,
        });
      }
      return goal;
    });
  }

  return goals;
}

export function buildBoardProposal({
  focus = "balanced",
  planType = "1yr",
  team = null,
  riders = [],
  standing = null,
  identityBasis = null,
  dnaKey = null,
  tradeoffPayload = null,
} = {}) {
  const baseGoals = generateBoardGoals({ focus, planType, team, riders, standing });
  const personality = deriveBoardPersonality({ focus, planType });
  const identityProfile = deriveTeamIdentityProfile({ team, riders, standing });

  // S-02f · Klub-DNA-tradition-mål injiceres som 6. (bonus) mål for 5yr-forslag.
  // Bevarer focus-baserede mål uændret — DNA-mål er bonus, ikke erstatning.
  // Skip duplikat hvis DNA-mål-typen allerede er i base-pakken (fx britisk_allrounder
  // har relative_rank som tradition, men 'balanced'-focus har det allerede).
  const traditionGoal = planType === "5yr" && dnaKey ? buildDnaTraditionGoal(dnaKey) : null;
  const goalsWithTradition = traditionGoal && !baseGoals.some((g) =>
    g.type === traditionGoal.type
    && (g.nationality_code || null) === (traditionGoal.nationality_code || null)
  )
    ? [...baseGoals, addGoalMetadata(traditionGoal)]
    : baseGoals;

  // S-02f · DNA-vægtning multiplicerer satisfaction_bonus + _penalty på mål
  // hvis type matcher DNA's goal_weighting. Subtilt — bevarer mål-targets uændret.
  const weightedGoals = dnaKey ? applyDnaWeightingToGoals(goalsWithTradition, dnaKey) : goalsWithTradition;

  // S-02b · Identity-feeding-badge på 5yr-mål (Q-batch 1C Q18).
  // For 5yr-forslag annoteres mål med rationale fra det frosne sæson-1-snapshot,
  // så frontend kan rendere "Bygger på din franske kerne (5/8 ryttere)"-badge.
  const annotatedGoals = planType === "5yr" && identityBasis
    ? weightedGoals.map((goal) => annotateGoalWithIdentityBasis(goal, identityBasis))
    : weightedGoals;

  // S-02g · Tradeoff-stramning anvendes sidst — modificerer kun target+label
  // på specifikke mål-typer (identity_riders eller sponsor_growth).
  const finalGoals = tradeoffPayload
    ? applyTradeoffTighteningToGoals(annotatedGoals, tradeoffPayload)
    : annotatedGoals;

  return {
    focus,
    plan_type: planType,
    personality,
    identity_profile: identityProfile,
    identity_basis: identityBasis,
    dna_key: dnaKey,
    tradeoff_applied: Boolean(tradeoffPayload),
    tradeoff_payload: tradeoffPayload,
    goals: finalGoals,
    negotiation_options: finalGoals.map((goal) => buildNegotiatedGoal(goal)),
  };
}

// S-02b · "Bygger på"-badge data for 5yr-mål-kort.
// Returnerer det aktuelle goal med et identity_basis_rationale-felt der beskriver
// hvilken sæson-1-observation der retfærdiggjorde målet. Frontend bruger feltet
// til inline-badge + klikbar expand-text (Q-batch 1C Q18).
export function annotateGoalWithIdentityBasis(goal, identityBasis) {
  if (!goal || !identityBasis) return goal;

  const rationale = buildIdentityBasisRationale(goal, identityBasis);
  if (!rationale) return goal;

  return { ...goal, identity_basis_rationale: rationale };
}

function buildIdentityBasisRationale(goal, identityBasis) {
  const nationalCore = identityBasis.national_core || null;
  const youthShare = Number(identityBasis.youth_share_pct ?? 0);
  const primarySpec = identityBasis.primary_specialization || "balanced";
  const riderCount = Number(identityBasis.rider_count ?? 0);

  switch (goal.type) {
    case "min_national_riders": {
      if (!nationalCore?.established) return null;
      return {
        kind: "national_core",
        short: `Bygger pa din ${nationalCore.code}-kerne (${nationalCore.count}/${riderCount} ryttere)`,
        long: `Ved sæson 1's slut havde du ${nationalCore.count} ${nationalCore.code}-ryttere ud af ${riderCount} (${nationalCore.share_pct}%). Bestyrelsen vil bygge videre på den nationale kerne — derfor dette mål.`,
      };
    }
    case "min_u25_riders": {
      if (identityBasis.youth_level !== "high" && youthShare < 35) return null;
      return {
        kind: "youth_share",
        short: `Bygger pa dit ungdomsaftryk (${youthShare}% U25 i sæson 1)`,
        long: `Ved sæson 1's slut havde du ${youthShare}% U25-ryttere — et tydeligt ungdomsaftryk. Bestyrelsen forventer du fortsat investerer i unge talenter.`,
      };
    }
    case "gc_wins": {
      if (primarySpec !== "gc") return null;
      return {
        kind: "specialization",
        short: "Bygger pa din GC-orientering fra saeson 1",
        long: `Sæson 1 viste GC som dit primære fokus. Bestyrelsen forventer samlede sejre — det er den retning, holdet allerede peger.`,
      };
    }
    case "stage_wins": {
      if (!["sprint", "classics", "breakaway"].includes(primarySpec)) return null;
      const specLabel = primarySpec === "sprint"
        ? "sprint-fokus"
        : primarySpec === "classics" ? "klassiker-profil" : "breakaway-stil";
      return {
        kind: "specialization",
        short: `Bygger pa dit ${specLabel} fra saeson 1`,
        long: `Sæson 1 viste ${specLabel} som dit primære spor. Bestyrelsen forventer etapesejre — det er det realistiske afkast af holdets profil.`,
      };
    }
    default:
      return null;
  }
}

// S-02b · Auto-genererer 1yr-plan fra de længere planer ved sekventiel onboarding.
// Q-batch 1A Q2 + master-doc S-02b: efter 5yr+3yr er signet, foreslår bestyrelsen
// 2 varianter af 1yr — manageren vælger:
//   - "stable":         status quo, mål-vægt fra 5yr-fokus, blødere (ingen ekstra pres)
//   - "results_focus":  resultatpres (top_n_finish + stage/gc_wins skærpes), kort-sigt
//
// Begge varianter bruger 5yr's focus som default — manageren kan stadig justere
// før accept hvis de når det. Auto-accept-cron vælger "stable" (mindst pres).
export function generate1YrFromLongerPlans({
  team = null,
  riders = [],
  standing = null,
  fiveYrBoard = null,
  threeYrBoard = null,
} = {}) {
  // Default focus arver fra 5yr (eller 3yr som fallback). Hvis ingen længere
  // planer findes — defensivt fallback — brug "balanced".
  const inheritedFocus = fiveYrBoard?.focus || threeYrBoard?.focus || "balanced";

  const stableProposal = buildBoardProposal({
    focus: inheritedFocus,
    planType: "1yr",
    team,
    riders,
    standing,
  });

  const resultsProposal = buildBoardProposal({
    focus: inheritedFocus === "youth_development" ? "balanced" : "star_signing",
    planType: "1yr",
    team,
    riders,
    standing,
  });

  return {
    inherited_focus: inheritedFocus,
    variants: [
      {
        key: "stable",
        label: "Stabil",
        description: "Bygger videre paa 5yr-rytmen — bloedere maal, mindre pres.",
        proposal: stableProposal,
      },
      {
        key: "results_focus",
        label: "Resultatfokus nu",
        description: "Skarpere kortsigtede maal — top-N + sejre vejer tungere.",
        proposal: resultsProposal,
      },
    ],
  };
}

export function createInitialBoardProfile({
  teamId,
  seasonId = null,
  balance = 0,
  sponsorIncome = 100,
  focus = "balanced",
  planType = "1yr",
  negotiationStatus = "pending",
} = {}) {
  return {
    team_id: teamId,
    plan_type: planType,
    focus,
    satisfaction: 50,
    budget_modifier: 1.0,
    season_id: seasonId,
    current_goals: generateBoardGoals({ focus, planType }),
    negotiation_status: negotiationStatus,
    is_baseline: false,
    plan_start_balance: balance,
    plan_start_sponsor_income: sponsorIncome,
    seasons_completed: 0,
    cumulative_stage_wins: 0,
    cumulative_gc_wins: 0,
  };
}

// S-02a · Sæson 1 = baseline (Q-batch 1A Q2). Bestyrelsen observerer uden mål,
// modifier holdes på 1.0, og processTeamSeasonEnd skipper evaluering for is_baseline=true.
// Erstattes af 5yr/3yr/1yr-rows ved sekventiel onboarding i sæson 2.
export function createBaselineProfile({
  teamId,
  seasonId = null,
  balance = 0,
  sponsorIncome = 100,
} = {}) {
  return {
    team_id: teamId,
    plan_type: "baseline",
    focus: "balanced",
    satisfaction: 50,
    budget_modifier: 1.0,
    season_id: seasonId,
    current_goals: [],
    negotiation_status: "completed",
    is_baseline: true,
    plan_start_balance: balance,
    plan_start_sponsor_income: sponsorIncome,
    seasons_completed: 0,
    cumulative_stage_wins: 0,
    cumulative_gc_wins: 0,
  };
}

export function finalizeBoardGoals({ goals = [], negotiationIndexes = [] } = {}) {
  const selectedIndexes = new Set(
    (negotiationIndexes || [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0)
  );

  return goals.map((goal, index) => (
    selectedIndexes.has(index) ? buildNegotiatedGoal(goal) : addGoalMetadata({ ...goal })
  ));
}

export function inferNegotiationIndexesFromGoals({
  goals = [],
  negotiationOptions = [],
  submittedGoals = [],
} = {}) {
  if (!Array.isArray(submittedGoals) || submittedGoals.length !== goals.length) {
    throw new Error("Invalid goals payload");
  }

  const selectedIndexes = [];

  submittedGoals.forEach((submittedGoal, index) => {
    const normalizedSubmitted = normalizeComparableGoal(submittedGoal);
    const normalizedGoal = normalizeComparableGoal(goals[index]);
    const normalizedNegotiation = normalizeComparableGoal(negotiationOptions[index]);

    if (JSON.stringify(normalizedSubmitted) === JSON.stringify(normalizedGoal)) return;

    if (JSON.stringify(normalizedSubmitted) === JSON.stringify(normalizedNegotiation)) {
      selectedIndexes.push(index);
      return;
    }

    throw new Error(`Invalid goal payload at index ${index}`);
  });

  return selectedIndexes;
}

export function evaluateGoal(goal, standing, team, context = {}) {
  const enrichedGoal = addGoalMetadata(goal);
  const {
    isFinalSeason = true,
    activeLoanCount = 0,
    planStartSponsorIncome,
    currentSponsorIncome,
    cumulativeStats,
    cumulativeMonumentPodiums,
    cumulativeJerseyWins,
    seasonJerseyWins,
    cumulativeTransferBalance,
    planStartU25StatSum,
    planStartU25Count,
    divisionManagerCount,
  } = context;

  switch (enrichedGoal.type) {
    case "top_n_finish":
      return (standing?.rank_in_division || 99) <= enrichedGoal.target;
    case "stage_wins":
      if (enrichedGoal.cumulative) return null;
      return (standing?.stage_wins || 0) >= enrichedGoal.target;
    case "gc_wins":
      if (enrichedGoal.cumulative) return null;
      return (standing?.gc_wins || 0) >= enrichedGoal.target;
    case "min_u25_riders":
      return (team?.riders || []).filter((rider) => rider.is_u25).length >= enrichedGoal.target;
    case "min_national_riders":
      return (team?.riders || [])
        .filter((rider) => normalizeBoardRider(rider).nationality_code === enrichedGoal.nationality_code)
        .length >= enrichedGoal.target;
    case "min_riders":
      return (team?.riders || []).length >= enrichedGoal.target;
    case "no_outstanding_debt":
      if (!isFinalSeason) return null;
      return activeLoanCount === 0;
    case "sponsor_growth":
      if (!isFinalSeason) return null;
      if (!planStartSponsorIncome || planStartSponsorIncome === 0) return null;
      return ((currentSponsorIncome - planStartSponsorIncome) / planStartSponsorIncome * 100) >= enrichedGoal.target;
    // S-02d · 7 nye mål-typer
    case "monument_podium":
      // Cumulative over plan-perioden (Q-A) — minst N podie-placeringer i Monuments
      if (cumulativeMonumentPodiums == null) return null;
      return cumulativeMonumentPodiums >= enrichedGoal.target;
    case "jersey_wins":
      // Cumulative for 3yr/5yr (Q-B), per-sæson for 1yr
      if (enrichedGoal.cumulative) {
        if (cumulativeJerseyWins == null) return null;
        return cumulativeJerseyWins >= enrichedGoal.target;
      }
      if (seasonJerseyWins == null) return null;
      return seasonJerseyWins >= enrichedGoal.target;
    case "signature_rider":
      // Q-C: tjekkes ved evaluerings-tidspunkt (rider-snapshot)
      return (team?.riders || []).filter((rider) => Number(rider?.popularity || 0) >= 75).length
        >= enrichedGoal.target;
    case "profitable_transfers":
      // Q-D: cumulative netto-balance over plan-perioden
      if (!isFinalSeason) return null;
      if (cumulativeTransferBalance == null) return null;
      return cumulativeTransferBalance >= enrichedGoal.target;
    case "u25_development_delta": {
      // E1: delta = (current_avg − plan_start_avg) / seasons_completed
      if (!isFinalSeason) return null;
      if (!planStartU25Count || planStartU25Count === 0 || planStartU25StatSum == null) return null;
      const currentSum = computeU25StatSum(team?.riders);
      const currentCount = (team?.riders || []).filter((r) => r.is_u25).length;
      if (currentCount === 0) return null;
      const seasonsCompleted = Math.max(context.seasonsCompleted || 1, 1);
      const planStartAvg = planStartU25StatSum / planStartU25Count;
      const currentAvg = currentSum / currentCount;
      const deltaPerSeason = (currentAvg - planStartAvg) / seasonsCompleted;
      return deltaPerSeason >= enrichedGoal.target;
    }
    case "relative_rank": {
      // Q-F: slut foran mindst N andre managers i din division
      if (standing?.rank_in_division == null || divisionManagerCount == null) return null;
      const beatCount = divisionManagerCount - standing.rank_in_division;
      return beatCount >= enrichedGoal.target;
    }
    case "domestic_dominance":
      // Q-G: skeleton — defer faktisk evaluering til S-02g
      return null;
    default:
      return false;
  }
}

// S-02d · sum af 12 stat-felter på U25-ryttere. Bruges af u25_development_delta
// + ved snapshot i processSeasonEnd så plan-start-baseline kan beregnes.
export function computeU25StatSum(riders = []) {
  const STAT_KEYS = [
    "stat_fl", "stat_bj", "stat_kb", "stat_bk", "stat_tt", "stat_bro",
    "stat_sp", "stat_acc", "stat_udh", "stat_mod", "stat_res", "stat_ftr",
  ];
  return (riders || [])
    .filter((rider) => rider?.is_u25)
    .reduce((sum, rider) => {
      return sum + STAT_KEYS.reduce((s, key) => s + Number(rider?.[key] || 0), 0);
    }, 0);
}

export function countGoalsMet(goals, standing, team, context = {}) {
  if (!goals?.length) return 0;

  return parseBoardGoals(goals).filter((goal) => {
    if (goal.cumulative) {
      // #1074 · Cumulative stage/gc-mål blev altid ekskluderet fra "opfyldt"
      // (returnerede false), men taltes stadig i goals_total → goals_met/goals_total-
      // ratio'en kunne aldrig nå 100% for multi-year-planer med cumulative-mål,
      // hvilket gjorde bonus-offer (lag 6, kræver ≥75% opfyldt) matematisk næsten
      // umulig. De tæller nu som opfyldt når den fulde kumulative optælling når
      // målet (kan nås i en hvilken som helst sæson — ikke pro-rated, ikke
      // sæson-gated, modsat de defer-til-final-typer der håndteres af evaluateGoal).
      const cum = goal.type === "stage_wins" ? (context.cumulativeStats?.stageWins ?? 0)
        : goal.type === "gc_wins" ? (context.cumulativeStats?.gcWins ?? 0)
        : null;
      return cum != null && cum >= goal.target;
    }
    return evaluateGoal(goal, standing, team, context) === true;
  }).length;
}

export function evaluateGoalProgress(goal, standing, team, context = {}) {
  const enrichedGoal = addGoalMetadata(goal);
  const riders = team?.riders || [];
  const planDuration = Math.max(context.planDuration || 1, 1);
  const seasonsCompleted = Math.max(context.seasonsCompleted || 1, 1);
  const isFinalSeason = Boolean(context.isFinalSeason);
  const cumulativeStageWins = context.cumulativeStats?.stageWins ?? 0;
  const cumulativeGcWins = context.cumulativeStats?.gcWins ?? 0;

  // #55 · Autoritativt "opnået"-flag til binær visning (✓ + mål-tæller på
  // BoardPage). `status` ("ahead") pro-rater målet midt-i-plan for cumulative/
  // multi-year-typer (stage_wins/gc_wins/monument_podium/jersey_wins +
  // profitable_transfers/u25_development_delta) og ville derfor markere et mål
  // som opnået på "on pace" frem for "fuldt nået". `met` bruger den fulde
  // sæson-slut-regel (evaluateGoal med fuldt mål), så frontend ikke skal
  // genimplementere mål-logikken (rod-årsag bag #55). Beregnes FØR switch'en så
  // alle return-stier (inkl. relative_rank's early return) bærer flaget.
  let met = evaluateGoal(goal, standing, team, { ...context, isFinalSeason: true }) === true;
  // evaluateGoal returnerer null for cumulative stage_wins/gc_wins (de tælles
  // ikke i countGoalsMet-ratio'en), men til binær visning ER de opnået når den
  // fulde kumulative optælling når målet — ikke det pro-ratede.
  if (!met && enrichedGoal.cumulative
    && (enrichedGoal.type === "stage_wins" || enrichedGoal.type === "gc_wins")) {
    const cumValue = enrichedGoal.type === "stage_wins" ? cumulativeStageWins : cumulativeGcWins;
    met = cumValue >= enrichedGoal.target;
  }

  let actual = null;
  let target = enrichedGoal.target;
  let score = 0.5;
  let status = "neutral";
  let missingData = false;

  switch (enrichedGoal.type) {
    case "top_n_finish":
      if (standing?.rank_in_division == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      actual = standing.rank_in_division;
      score = scoreLowerBetter(actual, target);
      status = actual <= target ? "ahead" : score >= 0.65 ? "near_miss" : "behind";
      break;
    case "stage_wins":
      actual = enrichedGoal.cumulative ? cumulativeStageWins : (standing?.stage_wins ?? 0);
      target = enrichedGoal.cumulative
        ? (isFinalSeason
          ? enrichedGoal.target
          : Math.max(1, enrichedGoal.target * (seasonsCompleted / planDuration)))
        : enrichedGoal.target;
      if (!enrichedGoal.cumulative && standing == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "gc_wins":
      actual = enrichedGoal.cumulative ? cumulativeGcWins : (standing?.gc_wins ?? 0);
      target = enrichedGoal.cumulative
        ? (isFinalSeason
          ? enrichedGoal.target
          : Math.max(1, enrichedGoal.target * (seasonsCompleted / planDuration)))
        : enrichedGoal.target;
      if (!enrichedGoal.cumulative && standing == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "min_u25_riders":
      actual = riders.filter((rider) => rider.is_u25).length;
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "min_national_riders":
      actual = riders
        .filter((rider) => normalizeBoardRider(rider).nationality_code === enrichedGoal.nationality_code)
        .length;
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "min_riders":
      actual = riders.length;
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "no_outstanding_debt":
      actual = context.activeLoanCount ?? 0;
      score = scoreDebtGoal(actual, isFinalSeason);
      status = actual === 0 ? "ahead" : actual === 1 ? "watch" : "behind";
      break;
    case "sponsor_growth": {
      const planStartSponsorIncome = context.planStartSponsorIncome;
      if (!planStartSponsorIncome || planStartSponsorIncome <= 0) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }

      const currentSponsorIncome = context.currentSponsorIncome ?? team?.sponsor_income ?? SPONSOR_INCOME_BASE;
      actual = ((currentSponsorIncome - planStartSponsorIncome) / planStartSponsorIncome) * 100;
      target = isFinalSeason
        ? enrichedGoal.target
        : Math.max(1, enrichedGoal.target * (seasonsCompleted / planDuration));
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    }
    // S-02d · 7 nye mål-typer
    case "monument_podium": {
      const cum = context.cumulativeMonumentPodiums;
      if (cum == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      actual = cum;
      target = isFinalSeason
        ? enrichedGoal.target
        : Math.max(1, Math.ceil(enrichedGoal.target * (seasonsCompleted / planDuration)));
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    }
    case "jersey_wins": {
      if (enrichedGoal.cumulative) {
        const cum = context.cumulativeJerseyWins;
        if (cum == null) {
          missingData = true;
          score = 0.6;
          status = "awaiting_data";
          break;
        }
        actual = cum;
        target = isFinalSeason
          ? enrichedGoal.target
          : Math.max(1, Math.ceil(enrichedGoal.target * (seasonsCompleted / planDuration)));
      } else {
        const seasonCount = context.seasonJerseyWins;
        if (seasonCount == null) {
          missingData = true;
          score = 0.6;
          status = "awaiting_data";
          break;
        }
        actual = seasonCount;
        target = enrichedGoal.target;
      }
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    }
    case "signature_rider":
      actual = riders.filter((rider) => Number(rider?.popularity || 0) >= 75).length;
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    case "profitable_transfers": {
      const balance = context.cumulativeTransferBalance;
      if (balance == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      actual = balance;
      target = isFinalSeason
        ? enrichedGoal.target
        : Math.max(50_000, Math.ceil(enrichedGoal.target * (seasonsCompleted / planDuration)));
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    }
    case "u25_development_delta": {
      const planStartSum = context.planStartU25StatSum;
      const planStartCount = context.planStartU25Count;
      if (!planStartCount || planStartCount === 0 || planStartSum == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      const currentU25 = riders.filter((r) => r.is_u25);
      if (currentU25.length === 0) {
        actual = -planStartSum / planStartCount;
        score = 0;
        status = "behind";
        break;
      }
      const currentSum = computeU25StatSum(riders);
      const currentAvg = currentSum / currentU25.length;
      const planStartAvg = planStartSum / planStartCount;
      actual = roundNumber((currentAvg - planStartAvg) / seasonsCompleted);
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      break;
    }
    case "relative_rank": {
      const divisionManagerCount = context.divisionManagerCount;
      if (standing?.rank_in_division == null || divisionManagerCount == null) {
        missingData = true;
        score = 0.6;
        status = "awaiting_data";
        break;
      }
      actual = divisionManagerCount - standing.rank_in_division;
      score = scoreHigherBetter(actual, target);
      status = actual >= target ? "ahead" : score >= 0.65 ? "on_track" : "behind";
      // S-02g · Rich-payload: BoardPage-GoalCard kan rendere "Du staar #X af Y managers"
      // uden at importere standings-state separat. rank_in_division + division_manager_count
      // tilføjes til evaluation-objektet (de øvrige cases får dem ikke — kun her er de relevante).
      return {
        ...enrichedGoal,
        actual,
        target,
        score: roundNumber(score),
        score_pct: Math.round(score * 100),
        status,
        missing_data: missingData,
        met,
        rank_in_division: standing.rank_in_division,
        division_manager_count: divisionManagerCount,
      };
    }
    case "domestic_dominance":
      // Q-G skeleton — kompleks "hjemland"-detektion deferred til S-02g
      missingData = true;
      score = 0.6;
      status = "awaiting_data";
      break;
    default:
      actual = null;
      score = 0.5;
      status = "neutral";
      break;
  }

  return {
    ...enrichedGoal,
    actual,
    target,
    score: roundNumber(score),
    score_pct: Math.round(score * 100),
    status,
    missing_data: missingData,
    met,
  };
}

export function addGoalMetadata(goal = {}) {
  const metadata = GOAL_METADATA_BY_TYPE[goal.type] || {};
  return {
    ...goal,
    category: goal.category ?? metadata.category ?? "results",
    importance: goal.importance ?? metadata.importance ?? "required",
    weight: goal.weight ?? metadata.weight ?? 1.0,
  };
}

export function normalizeComparableGoal(goal) {
  const enrichedGoal = addGoalMetadata(goal);
  return {
    type: enrichedGoal?.type ?? null,
    target: enrichedGoal?.target ?? null,
    label: enrichedGoal?.label ?? null,
    category: enrichedGoal?.category ?? null,
    importance: enrichedGoal?.importance ?? null,
    weight: enrichedGoal?.weight ?? null,
    cumulative: Boolean(enrichedGoal?.cumulative),
    satisfaction_bonus: enrichedGoal?.satisfaction_bonus ?? 0,
    satisfaction_penalty: enrichedGoal?.satisfaction_penalty ?? 0,
    nationality_code: enrichedGoal?.nationality_code ?? null,
    negotiated: Boolean(enrichedGoal?.negotiated),
  };
}

export function buildGoalLabel(goal = {}) {
  switch (goal.type) {
    case "top_n_finish":
      return goal.label?.includes("ved planens afslutning")
        ? `Top ${goal.target} i divisionen ved planens afslutning`
        : `Top ${goal.target} i divisionen`;
    case "stage_wins":
      return goal.cumulative
        ? `Mindst ${goal.target} etapesejre over planperioden`
        : `Mindst ${goal.target} etapesejr${goal.target !== 1 ? "er" : ""}`;
    case "gc_wins":
      return goal.cumulative
        ? `Mindst ${goal.target} samlede sejre over planperioden`
        : goal.target === 1
          ? "Mindst 1 samlet sejr"
          : `Mindst ${goal.target} samlede sejre`;
    case "min_u25_riders":
      return `Min. ${goal.target} U25-ryttere pa holdet`;
    case "min_national_riders":
      return `Min. ${goal.target} ryttere fra ${goal.nationality_code || "holdets kerne"}`;
    case "min_riders":
      return `Hold pa min. ${goal.target} ryttere`;
    case "sponsor_growth":
      return goal.label?.includes("over planperioden")
        ? `Sponsor-indkomst vokset med ${goal.target}% over planperioden`
        : `Sponsor-indkomst vokset med ${goal.target}%`;
    case "no_outstanding_debt":
      return "Ingen udestaende gaeld ved saesonslut";
    // S-02d · 7 nye mål-typer
    case "monument_podium":
      return goal.cumulative
        ? `Mindst ${goal.target} podie-placering${goal.target !== 1 ? "er" : ""} i Monuments-loeb over planperioden`
        : `Top-3 i mindst ${goal.target} Monuments-loeb`;
    case "jersey_wins":
      return goal.cumulative
        ? `Mindst ${goal.target} etapeloeb-troejer over planperioden`
        : `Mindst ${goal.target} etapeloeb-troeje${goal.target !== 1 ? "r" : ""} (point/bjerg/young)`;
    case "signature_rider":
      return `${goal.target === 1 ? "Mindst 1 stjerne-rytter" : `Mindst ${goal.target} stjerne-ryttere`} (popularity >= 75)`;
    case "profitable_transfers":
      return `Netto transfer-balance >= ${formatTransferThreshold(goal.target)} over planperioden`;
    case "u25_development_delta":
      return `Gennemsnitlig U25-stat-gevinst >= ${goal.target} stat-points/saeson`;
    case "relative_rank":
      return `Slut foran mindst ${goal.target} andre managers i divisionen`;
    case "domestic_dominance":
      return `Mindst ${goal.target} sejre i hjemlandsloeb pr. saeson`;
    default:
      return goal.label || "";
  }
}

function formatTransferThreshold(target) {
  const value = Number(target || 0);
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${value}`;
}

function normalizeDivisionForGoals(division) {
  const n = Number(division);
  return DIVISION_SQUAD_LIMITS[n] ? n : null;
}

function getDynamicRankingTarget({ baseTarget, focus, division, standing, identityProfile } = {}) {
  let target = baseTarget;
  const starPressure = getStarProfileGoalPressure(identityProfile?.star_profile);

  if (division === 2) target += 1;
  if (division === 3) target += 1;

  if (standing?.rank_in_division != null) {
    if (standing.rank_in_division <= 2) target -= 1;
    if (standing.rank_in_division >= 6) target += 1;
  }

  if (focus === "star_signing" && identityProfile?.competitive_tier === "contender") {
    target -= 1;
  }

  if (focus === "star_signing" && starPressure > 0) {
    target -= starPressure;
  } else if (
    focus === "balanced"
    && starPressure > 0
    && identityProfile?.competitive_tier !== "rebuilding"
  ) {
    target -= 1;
  }

  if (focus === "youth_development" && identityProfile?.squad_status === "thin") {
    target += 1;
  }

  return clamp(target, 2, 8);
}

function getDynamicStageWinsTarget({
  baseTarget,
  focus,
  planDuration,
  isMultiYear,
  standing,
  identityProfile,
} = {}) {
  let target = baseTarget;
  const starPressure = getStarProfileGoalPressure(identityProfile?.star_profile);

  if (["sprint", "classics", "breakaway"].includes(identityProfile?.primary_specialization)) {
    target += 1;
  }

  if (identityProfile?.competitive_tier === "contender" && focus !== "youth_development") {
    target += 1;
  }

  if (identityProfile?.squad_status === "thin") {
    target -= 1;
  }

  if (focus === "youth_development" && identityProfile?.youth_level === "high" && isMultiYear) {
    target += 1;
  }

  if (standing?.rank_in_division >= 6 && focus === "youth_development") {
    target = Math.max(1, target - 1);
  }

  if (focus === "balanced" && starPressure > 0 && identityProfile?.competitive_tier !== "rebuilding") {
    target += 1;
  }

  return clamp(target, 1, isMultiYear ? planDuration + 3 : 4);
}

function getDynamicGcWinsTarget({ baseTarget, planDuration, isMultiYear, identityProfile } = {}) {
  let target = baseTarget;
  const starPressure = getStarProfileGoalPressure(identityProfile?.star_profile);

  if (identityProfile?.primary_specialization === "gc") {
    target += 1;
  } else if (identityProfile?.secondary_specialization === "gc" && isMultiYear) {
    target += 1;
  }

  target += starPressure;

  if (identityProfile?.squad_status === "thin") {
    target -= 1;
  }

  return clamp(target, 1, isMultiYear ? planDuration + 2 : 3);
}

function getDynamicU25Target({ planDuration, division, identityProfile } = {}) {
  let target = division === 1 ? 6 : division === 2 ? 5 : 4;

  if (identityProfile?.youth_level === "high") {
    target += 1;
  }

  if (identityProfile?.competitive_tier === "rebuilding" && planDuration > 1) {
    target += 1;
  }

  const upperBound = Math.max(3, Math.min((identityProfile?.squad_limits?.max ?? 12) - 1, 8));
  return clamp(target, 3, upperBound);
}

function getDynamicNationalRiderTarget({ identityProfile } = {}) {
  const nationalCore = identityProfile?.national_core;
  if (!nationalCore?.established) return null;

  const upperBound = Math.min(
    identityProfile?.squad_limits?.max ?? nationalCore.count,
    nationalCore.count
  );
  const target = Math.max(3, Math.round(nationalCore.count * 0.75));
  return clamp(target, 3, upperBound);
}

function buildNationalIdentityGoal({ identityProfile } = {}) {
  const nationalCore = identityProfile?.national_core;
  const target = getDynamicNationalRiderTarget({ identityProfile });

  if (!nationalCore?.established || !nationalCore?.code || !target) {
    return null;
  }

  return addGoalMetadata({
    type: "min_national_riders",
    target,
    nationality_code: nationalCore.code,
    label: buildGoalLabel({
      type: "min_national_riders",
      target,
      nationality_code: nationalCore.code,
    }),
    satisfaction_bonus: 8,
    satisfaction_penalty: 8,
  });
}

function getDynamicMinRiderTarget({ focus, identityProfile } = {}) {
  const squadLimits = identityProfile?.squad_limits || getDivisionSquadLimits(identityProfile?.division);
  const range = Math.max(squadLimits.max - squadLimits.min, 0);
  let target = focus === "star_signing"
    ? squadLimits.min + Math.max(1, Math.ceil(range * 0.5))
    : squadLimits.min + Math.max(1, Math.ceil(range * 0.25));

  if (identityProfile?.competitive_tier === "contender" && focus === "star_signing") {
    target += 1;
  }

  if (identityProfile?.squad_status === "thin") {
    target -= 1;
  }

  return clamp(target, squadLimits.min, squadLimits.max);
}

function getDynamicSponsorGrowthTarget({
  baseTarget,
  focus,
  planDuration,
  division,
  standing,
  team,
  identityProfile,
} = {}) {
  let target = baseTarget;
  const sponsorPressure = getStarProfileSponsorPressure(identityProfile?.star_profile);

  if (division === 3) {
    target -= 5;
  }

  if (standing?.rank_in_division != null && standing.rank_in_division <= 2) {
    target += 5;
  }

  if ((team?.balance ?? 0) < 0) {
    target -= 5;
  }

  if (focus === "star_signing" && identityProfile?.competitive_tier === "contender") {
    target += 5;
  }

  target += sponsorPressure;

  return clampToStep(target, 5, 5, planDuration > 1 ? 30 : 20);
}
