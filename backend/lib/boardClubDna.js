// S-02f · Klub-DNA — håndlavede klub-identiteter.
// Master roadmap: docs/slices/02-board-redesign-MASTER.md (Q-batch 1B Q10 + Appendix D)
//
// Tilbyder:
//  - BOARD_CLUB_DNA: 5 håndlavede arketyper (skandinavisk_udvikling, italiensk_klassiker,
//    sprint_kommerciel, fransk_klatrer, britisk_allrounder).
//  - computeDnaSuggestions(identityBasis): returnerer 3 forslag pr. tildelings-flow:
//      1. National-match — bedste DNA mod season_1_identity_basis.national_core.code
//      2. Specialization-match — bedste DNA mod primary_specialization
//      3. Wildcard — den højest-rangerede DNA der ikke matcher manageren's stærkeste akse
//        (giver "step out of mold"-valg per Appendix D).
//  - getDnaArchetypeAlignmentBonus(dnaKey, archetypeKey): plus/minus tilføjet til
//    computeArchetypeAlignmentScore i boardMembers.selectBoardMembers, så DNA
//    påvirker hvilke 5 board-medlemmer manageren tildeles.
//  - getDnaGoalWeighting(dnaKey, goalType): multiplier (0.5–1.6) bruges til at
//    booste/dæmpe satisfaction_bonus + satisfaction_penalty pr. mål, så DNA
//    føles igennem evaluering uden at ændre selve mål-typerne.
//  - buildDnaTraditionGoal(dnaKey): den ene "klub-tradition"-mål der tilføjes som
//    ekstra mål til 5yr-forslag. Bruges af buildBoardProposal når identityBasis +
//    teamDna er kendt — booster narrativ uden at fortrænge focus-baserede mål.
//
// Persistens: data lever både her (kode-sandhed) og i team_dna-tabellen (DB-seed
// fra migration 2026-05-05-board-club-dna.sql). DB-tabellen er reference for
// frontend-display + future drift-tracking; engines læser herfra for hurtig adgang.
//
// AI/bank/frozen får ALDRIG DNA — caller (api.js + economyEngine) skal filtrere.

export const DNA_KEYS = [
  "skandinavisk_udvikling",
  "italiensk_klassiker",
  "sprint_kommerciel",
  "fransk_klatrer",
  "britisk_allrounder",
];

export const BOARD_CLUB_DNA = {
  skandinavisk_udvikling: {
    key: "skandinavisk_udvikling",
    label: "Skandinavisk udviklingshold",
    emoji: "🌲",
    short_description: "Ungdom, balance og nordisk arv",
    long_description: "Vi bygger ryttere op fra grunden — tålmodighed, struktur og nordisk arbejdsmoral. Sponsorerne forventer udvikling, ikke fyrværkeri.",
    policy_axes: {
      results_pressure: "low",
      financial_caution: "high",
      debt_aversion: "high",
      youth_focus: "high",
      national_identity: "medium",
      classics_focus: "low",
      gc_focus: "low",
      sponsor_growth_demand: "low",
    },
    national_affinity: ["NO", "DK", "SE", "FI", "IS"],
    specialization_affinity: ["youth", "balanced"],
    member_alignment_bonus: {
      talentspejderen: 3,
      ungdomsidealisten: 3,
      sponsoraten: -1,
      resultatjaegeren: -2,
    },
    goal_weighting: {
      u25_development_delta: 1.4,
      signature_rider: 0.8,
      min_national_riders: 1.2,
      profitable_transfers: 1.1,
    },
    tradition_goal: {
      type: "u25_development_delta",
      target: 3,
      label: "Klub-DNA: udvikl talenterne — gnsn. +3 stat-pts/sæson på U25",
      label_key: "dna.skandinavisk_udvikling.traditionGoalLabel",
      satisfaction_bonus: 16,
      satisfaction_penalty: 8,
    },
  },

  italiensk_klassiker: {
    key: "italiensk_klassiker",
    label: "Italiensk klassiker-traditionalist",
    emoji: "🪨",
    short_description: "Foråret er hellig — monumenter er målet",
    long_description: "Klubben er bygget på asfalt fra Lombardiet og Strade Bianche. Vores fans drømmer om Sanremo og Lombardia — ikke om Tour de France-podier.",
    policy_axes: {
      results_pressure: "high",
      financial_caution: "medium",
      debt_aversion: "medium",
      youth_focus: "low",
      national_identity: "high",
      classics_focus: "high",
      gc_focus: "low",
      sponsor_growth_demand: "medium",
    },
    national_affinity: ["IT"],
    specialization_affinity: ["classics", "breakaway"],
    member_alignment_bonus: {
      klassiker_purist: 4,
      traditionalisten: 2,
      resultatjaegeren: 1,
      gc_elsker: -2,
    },
    goal_weighting: {
      monument_podium: 1.6,
      jersey_wins: 1.0,
      min_national_riders: 1.2,
      u25_development_delta: 0.7,
    },
    tradition_goal: {
      type: "monument_podium",
      target: 1,
      label: "Klub-DNA: mindst ét Monument-podie pr. plan-cyklus",
      label_key: "dna.italiensk_klassiker.traditionGoalLabel",
      satisfaction_bonus: 22,
      satisfaction_penalty: 12,
    },
  },

  sprint_kommerciel: {
    key: "sprint_kommerciel",
    label: "Sprint-fokuseret kommerciel",
    emoji: "⚡",
    short_description: "Sejre i mål — sponsorer i ryggen",
    long_description: "Vores rytter skal være den første over stregen og foran kameraerne. Sponsorvækst kommer fra synlighed, og synlighed kommer fra etapesejre.",
    policy_axes: {
      results_pressure: "high",
      financial_caution: "low",
      debt_aversion: "low",
      youth_focus: "low",
      national_identity: "low",
      classics_focus: "low",
      gc_focus: "low",
      sponsor_growth_demand: "high",
    },
    national_affinity: [],
    specialization_affinity: ["sprint"],
    member_alignment_bonus: {
      sponsoraten: 3,
      resultatjaegeren: 3,
      klassiker_purist: -1,
      ungdomsidealisten: -2,
    },
    goal_weighting: {
      jersey_wins: 1.5,
      signature_rider: 1.3,
      profitable_transfers: 1.1,
      u25_development_delta: 0.6,
    },
    tradition_goal: {
      type: "jersey_wins",
      target: 2,
      label: "Klub-DNA: vind mindst 2 etape-trøjer pr. sæson (sprint-fokus)",
      label_key: "dna.sprint_kommerciel.traditionGoalLabel",
      satisfaction_bonus: 18,
      satisfaction_penalty: 10,
    },
  },

  fransk_klatrer: {
    key: "fransk_klatrer",
    label: "Fransk klatrer-arv",
    emoji: "⛰️",
    short_description: "Tour-bjerge er klubbens hjem",
    long_description: "Vi har klatret med Anquetil, Hinault og Pinot. Bjergene definerer os — og Tour de France er stadig kalenderens vigtigste søndag.",
    policy_axes: {
      results_pressure: "high",
      financial_caution: "medium",
      debt_aversion: "medium",
      youth_focus: "medium",
      national_identity: "high",
      classics_focus: "low",
      gc_focus: "high",
      sponsor_growth_demand: "medium",
    },
    national_affinity: ["FR"],
    specialization_affinity: ["gc", "breakaway"],
    member_alignment_bonus: {
      gc_elsker: 4,
      traditionalisten: 2,
      nationalist_purist: 2,
      sponsoraten: -1,
    },
    goal_weighting: {
      signature_rider: 1.3,
      min_national_riders: 1.4,
      jersey_wins: 1.0,
      monument_podium: 0.7,
    },
    tradition_goal: {
      type: "min_national_riders",
      target: 4,
      nationality_code: "FR",
      label: "Klub-DNA: min. 4 franske ryttere i truppen",
      label_key: "dna.fransk_klatrer.traditionGoalLabel",
      satisfaction_bonus: 18,
      satisfaction_penalty: 10,
    },
  },

  britisk_allrounder: {
    key: "britisk_allrounder",
    label: "Britisk all-rounder",
    emoji: "🎯",
    short_description: "Disciplin på tværs — datadrevet og bredt",
    long_description: "Sky-skolen lever videre. Vi vinder på struktur, marginal gains og bredde — fra Roubaix til Andorra. Ingen disciplin er klubbens, men alle er.",
    policy_axes: {
      results_pressure: "medium",
      financial_caution: "medium",
      debt_aversion: "medium",
      youth_focus: "medium",
      national_identity: "medium",
      classics_focus: "medium",
      gc_focus: "medium",
      sponsor_growth_demand: "medium",
    },
    national_affinity: ["GB", "IE"],
    specialization_affinity: ["balanced", "gc", "classics"],
    member_alignment_bonus: {
      pragmatikeren: 4,
      talentspejderen: 1,
      resultatjaegeren: 1,
      klassiker_purist: 1,
    },
    goal_weighting: {
      relative_rank: 1.3,
      profitable_transfers: 1.2,
      signature_rider: 1.0,
      u25_development_delta: 1.0,
    },
    tradition_goal: {
      type: "relative_rank",
      target: 3,
      label: "Klub-DNA: top-3 i division (bred præstation)",
      label_key: "dna.britisk_allrounder.traditionGoalLabel",
      satisfaction_bonus: 16,
      satisfaction_penalty: 8,
    },
  },
};

export function getDnaByKey(key) {
  return BOARD_CLUB_DNA[key] || null;
}

export function isValidDnaKey(key) {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(BOARD_CLUB_DNA, key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggestions — computeDnaSuggestions(identityBasis)
//
// Returnerer altid 3 forslag (Appendix D), tagged med slot:
//   - national_match: DNA hvor identityBasis.national_core.code er i national_affinity
//   - specialization_match: DNA hvor identityBasis.primary_specialization er i specialization_affinity
//   - wildcard: én af de resterende — den med højest scoreDnaAgainstIdentity, deterministisk
//
// Fallback ved tomt national_core: rangér på specialization alone, slot 1 falder
// tilbage til "best balanced fit".
// Slot collisions (national+spec begge peger på samme DNA): andet slot rykker
// til næste-bedste match. Wildcard er ALDRIG samme key som de første to.
// ─────────────────────────────────────────────────────────────────────────────
export function computeDnaSuggestions(identityBasis = null) {
  if (!identityBasis) {
    return defaultSuggestions();
  }

  const nationalCode = identityBasis?.national_core?.code || null;
  const nationalEstablished = Boolean(identityBasis?.national_core?.established);
  const primarySpec = identityBasis?.primary_specialization || "balanced";

  const scored = DNA_KEYS.map((key) => {
    const dna = BOARD_CLUB_DNA[key];
    return {
      key,
      dna,
      score: scoreDnaAgainstIdentity(dna, identityBasis),
      national_hit: Boolean(
        nationalCode
        && nationalEstablished
        && dna.national_affinity.includes(nationalCode)
      ),
      spec_hit: dna.specialization_affinity.includes(primarySpec),
    };
  }).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.key.localeCompare(b.key);
  });

  const used = new Set();

  const nationalCandidate = scored.find((entry) => entry.national_hit && !used.has(entry.key));
  const nationalPick = nationalCandidate || scored.find((entry) => !used.has(entry.key));
  if (nationalPick) used.add(nationalPick.key);

  const specCandidate = scored.find((entry) => entry.spec_hit && !used.has(entry.key));
  const specPick = specCandidate || scored.find((entry) => !used.has(entry.key));
  if (specPick) used.add(specPick.key);

  const wildcardPick = scored.find((entry) => !used.has(entry.key));

  return [
    annotateSlot(nationalPick, "national_match", { nationalCode }),
    annotateSlot(specPick, "specialization_match", { primarySpec }),
    annotateSlot(wildcardPick, "wildcard", {}),
  ].filter(Boolean);
}

function annotateSlot(scoredEntry, slot, ctx) {
  if (!scoredEntry?.dna) return null;
  const dna = scoredEntry.dna;
  return {
    key: dna.key,
    label: dna.label,
    label_key: `dna.${dna.key}.label`,
    emoji: dna.emoji,
    short_description: dna.short_description,
    short_description_key: `dna.${dna.key}.shortDescription`,
    long_description: dna.long_description,
    long_description_key: `dna.${dna.key}.longDescription`,
    suggestion_slot: slot,
    ...buildSuggestionRationale(slot, dna, ctx),
    score: scoredEntry.score,
  };
}

function buildSuggestionRationale(slot, dna, ctx) {
  if (slot === "national_match" && ctx.nationalCode && dna.national_affinity.includes(ctx.nationalCode)) {
    return {
      rationale_key: "dna.suggestionRationale.nationalMatch",
      rationaleKey: "dna.suggestionRationale.nationalMatch",
      rationale_params: { nationalCode: ctx.nationalCode },
      rationaleParams: { nationalCode: ctx.nationalCode },
      rationale: `Matcher din ${ctx.nationalCode}-kerne fra sæson 1`,
    };
  }
  if (slot === "specialization_match" && dna.specialization_affinity.includes(ctx.primarySpec)) {
    return {
      rationale_key: "dna.suggestionRationale.specializationMatch",
      rationaleKey: "dna.suggestionRationale.specializationMatch",
      rationale_params: { primarySpec: ctx.primarySpec },
      rationaleParams: { primarySpec: ctx.primarySpec },
      rationale: `Matcher dit ${getLegacySpecLabel(ctx.primarySpec)}`,
    };
  }
  return {
    rationale_key: "dna.suggestionRationale.wildcard",
    rationaleKey: "dna.suggestionRationale.wildcard",
    rationale_params: {},
    rationaleParams: {},
    rationale: "Et nyt spor — bestyrelsen vil følge med uanset retning",
  };
}

function getLegacySpecLabel(primarySpec) {
  return {
    gc: "GC-fokus",
    sprint: "sprint-fokus",
    classics: "klassiker-fokus",
    breakaway: "breakaway-stil",
    youth: "ungdomsaftryk",
    balanced: "balancerede profil",
  }[primarySpec] || primarySpec;
}

function defaultSuggestions() {
  return DNA_KEYS.slice(0, 3).map((key, idx) => annotateSlot(
    { key, dna: BOARD_CLUB_DNA[key], score: 0 },
    idx === 0 ? "national_match" : idx === 1 ? "specialization_match" : "wildcard",
    {}
  )).filter(Boolean);
}

function scoreDnaAgainstIdentity(dna, identityBasis) {
  if (!dna || !identityBasis) return 0;

  let score = 0;

  const nationalCode = identityBasis?.national_core?.code;
  const nationalStrength = identityBasis?.national_core?.strength || "none";
  if (identityBasis?.national_core?.established && nationalCode && dna.national_affinity.includes(nationalCode)) {
    score += nationalStrength === "high" ? 6 : nationalStrength === "medium" ? 4 : 2;
  }

  const primarySpec = identityBasis?.primary_specialization;
  if (primarySpec && dna.specialization_affinity.includes(primarySpec)) {
    score += 4;
  }

  const secondarySpec = identityBasis?.secondary_specialization;
  if (secondarySpec && dna.specialization_affinity.includes(secondarySpec)) {
    score += 1;
  }

  if (identityBasis?.youth_level === "high" && dna.policy_axes.youth_focus === "high") {
    score += 3;
  }
  if (identityBasis?.youth_level === "low" && dna.policy_axes.youth_focus === "high") {
    score -= 2;
  }

  const starLevel = identityBasis?.star_profile?.level;
  if ((starLevel === "elite" || starLevel === "high") && dna.policy_axes.results_pressure === "high") {
    score += 2;
  }

  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine bias-helpers
// ─────────────────────────────────────────────────────────────────────────────

// Brugt af boardMembers.selectBoardMembers efter computeArchetypeAlignmentScore.
// Returnerer ekstra alignment-score-bonus baseret på DNA's member_alignment_bonus map.
export function getDnaArchetypeAlignmentBonus(dnaKey, archetypeKey) {
  const dna = getDnaByKey(dnaKey);
  if (!dna) return 0;
  const bonus = dna.member_alignment_bonus?.[archetypeKey];
  return Number.isFinite(bonus) ? bonus : 0;
}

// Brugt af buildBoardProposal — multiplier på satisfaction_bonus og _penalty
// for mål hvis type matcher DNA's goal_weighting. Default 1.0 (neutral).
export function getDnaGoalWeightMultiplier(dnaKey, goalType) {
  const dna = getDnaByKey(dnaKey);
  if (!dna) return 1.0;
  const weight = dna.goal_weighting?.[goalType];
  return Number.isFinite(weight) && weight > 0 ? weight : 1.0;
}

// Brugt af buildBoardProposal til at tilføje DNA's "klub-tradition"-mål til 5yr-forslag.
// Bonus + penalty allerede sat. Vi annoterer source: "club_dna" så frontend kan vise
// DNA-badge og engines kan finde tradition-mål i evaluering.
export function buildDnaTraditionGoal(dnaKey) {
  const dna = getDnaByKey(dnaKey);
  if (!dna?.tradition_goal) return null;
  return {
    ...dna.tradition_goal,
    source: "club_dna",
    importance: "bonus",
    dna_key: dna.key,
  };
}

// Anvend DNA-vægtninger på en samling mål. Ren funktion — bruges af buildBoardProposal.
export function applyDnaWeightingToGoals(goals = [], dnaKey = null) {
  if (!dnaKey || !Array.isArray(goals) || !goals.length) return goals;
  return goals.map((goal) => {
    const multiplier = getDnaGoalWeightMultiplier(dnaKey, goal.type);
    if (multiplier === 1.0) return goal;
    return {
      ...goal,
      satisfaction_bonus: Math.round((Number(goal.satisfaction_bonus) || 0) * multiplier),
      satisfaction_penalty: Math.round((Number(goal.satisfaction_penalty) || 0) * multiplier),
      dna_weighted: true,
      dna_key: dnaKey,
    };
  });
}
