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

import { tierSupportsRaceScope } from "./boardConstants.js";

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
    label: "Scandinavian development team",
    label_key: "dna.skandinavisk_udvikling.label",
    emoji: "🌲",
    short_description: "Youth, balance and Nordic heritage",
    short_description_key: "dna.skandinavisk_udvikling.shortDescription",
    long_description: "We build riders from the ground up: patience, structure and Nordic work ethic. Sponsors expect development, not fireworks.",
    long_description_key: "dna.skandinavisk_udvikling.longDescription",
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
      label: "Club DNA: develop the talents, average +3 stat points per season for U25 riders",
      label_key: "dna.skandinavisk_udvikling.traditionGoalLabel",
      satisfaction_bonus: 16,
      satisfaction_penalty: 8,
    },
  },

  italiensk_klassiker: {
    key: "italiensk_klassiker",
    label: "Italian classics traditionalist",
    label_key: "dna.italiensk_klassiker.label",
    emoji: "🪨",
    short_description: "Spring is sacred. Monuments are the goal",
    short_description_key: "dna.italiensk_klassiker.shortDescription",
    long_description: "The club is built on the roads of Lombardia and Strade Bianche. Our fans dream of Sanremo and Lombardia, not Tour de France podiums.",
    long_description_key: "dna.italiensk_klassiker.longDescription",
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
      // #1238 · Klassiker-orienteret DNA honorerer hele klassiker-kategorien:
      // race_scope "classics" tæller podier i alle WT-endagsløb (Monuments ⊂
      // klassikere, kanonisk mapping i boardConstants.js) — en bestyrelse der
      // er glad for monumenter, er også glad for klassikere generelt.
      race_scope: "classics",
      label: "Club DNA: at least one podium in a classic (incl. Monuments) per plan cycle",
      label_key: "dna.italiensk_klassiker.traditionGoalLabel",
      satisfaction_bonus: 22,
      satisfaction_penalty: 12,
    },
  },

  sprint_kommerciel: {
    key: "sprint_kommerciel",
    label: "Sprint-focused commercial team",
    label_key: "dna.sprint_kommerciel.label",
    emoji: "⚡",
    short_description: "Wins at the line, sponsors on the wheel",
    short_description_key: "dna.sprint_kommerciel.shortDescription",
    long_description: "Our rider should be first across the line and first in front of the cameras. Sponsor growth comes from visibility, and visibility comes from stage wins.",
    long_description_key: "dna.sprint_kommerciel.longDescription",
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
    // #4377 · buildDnaTraditionGoal kun kaldes for 5yr-forslag (buildBoardProposal:
    // `planType === "5yr" && dnaKey`), så dette mål er ALTID multi-year. Uden
    // `cumulative: true` faldt evaluateGoal/evaluateGoalProgress (boardGoals.js)
    // tilbage til jersey_wins' per-sæson-gren (seasonJerseyWins), der nulstiller
    // ved hvert sæsonskifte — trøjer vundet en tidligere sæson i planperioden
    // "glemtes" (spiller-rapport #4377: "min [board] har glemt at jeg fik trøjer
    // sidste sæson"). cumulative:true retter både evaluering (cumulativeJerseyWins,
    // som allerede summerer race_results over hele plan-vinduet) og frontend-
    // labelvalget (boardGoalLabel.js's isPlanPeriod-check læser goal.cumulative).
    tradition_goal: {
      type: "jersey_wins",
      target: 2,
      cumulative: true,
      label: "Club DNA: win at least 2 stage-race jerseys over the plan period (sprint focus)",
      label_key: "dna.sprint_kommerciel.traditionGoalLabel",
      satisfaction_bonus: 18,
      satisfaction_penalty: 10,
    },
  },

  fransk_klatrer: {
    key: "fransk_klatrer",
    label: "French climbing heritage",
    label_key: "dna.fransk_klatrer.label",
    emoji: "⛰️",
    short_description: "The Tour mountains are the club's home",
    short_description_key: "dna.fransk_klatrer.shortDescription",
    long_description: "We have climbed with Anquetil, Hinault and Pinot. The mountains define us, and the Tour de France is still the most important Sunday on the calendar.",
    long_description_key: "dna.fransk_klatrer.longDescription",
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
      label: "Club DNA: at least 4 French riders in the squad",
      label_key: "dna.fransk_klatrer.traditionGoalLabel",
      satisfaction_bonus: 18,
      satisfaction_penalty: 10,
    },
  },

  britisk_allrounder: {
    key: "britisk_allrounder",
    label: "British all-rounder",
    label_key: "dna.britisk_allrounder.label",
    emoji: "🎯",
    short_description: "Discipline across the board, data-led and broad",
    short_description_key: "dna.britisk_allrounder.shortDescription",
    long_description: "The Sky school lives on. We win through structure, marginal gains and depth, from Roubaix to Andorra. No discipline owns the club, but every discipline belongs here.",
    long_description_key: "dna.britisk_allrounder.longDescription",
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
      label: "Club DNA: top 3 in the division (broad performance)",
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

/**
 * #4734 · Den spillervendte DNA-copy som API'et sender: hver tekst ledsages af
 * sin locale-noegle, saa frontend rendrer i modtagerens sprog (BoardPage.jsx'
 * getDnaCopy) og teksten selv kun er fallback for en manglende noegle.
 *
 * Noeglerne staar paa selve DNA-definitionen ovenfor — foer #4734 blev de
 * konstrueret som `dna.${key}.label` fire steder (her + tre svar i
 * backend/routes/api.js), saa en omdoebt noegle skulle rettes fire gange.
 */
export function dnaCopyPayload(dna) {
  if (!dna?.key) return null;
  return {
    key: dna.key,
    label: dna.label,
    label_key: dna.label_key,
    emoji: dna.emoji,
    short_description: dna.short_description,
    short_description_key: dna.short_description_key,
    long_description: dna.long_description,
    long_description_key: dna.long_description_key,
  };
}

function annotateSlot(scoredEntry, slot, ctx) {
  if (!scoredEntry?.dna) return null;
  const dna = scoredEntry.dna;
  return {
    key: dna.key,
    ...dnaCopyPayload(dna),
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
      rationale: `Matches your ${ctx.nationalCode} core from season 1`,
    };
  }
  if (slot === "specialization_match" && dna.specialization_affinity.includes(ctx.primarySpec)) {
    return {
      rationale_key: "dna.suggestionRationale.specializationMatch",
      rationaleKey: "dna.suggestionRationale.specializationMatch",
      rationale_params: { primarySpec: ctx.primarySpec },
      rationaleParams: { primarySpec: ctx.primarySpec },
      rationale: `Matches your ${getLegacySpecLabel(ctx.primarySpec)}`,
    };
  }
  return {
    rationale_key: "dna.suggestionRationale.wildcard",
    rationaleKey: "dna.suggestionRationale.wildcard",
    rationale_params: {},
    rationaleParams: {},
    rationale: "A new path. The board will follow wherever it leads",
  };
}

// #4734: fallback-labels for det tilfaelde at frontend ikke kan slaa
// dna.specLabel.<spec> op. EN-first som resten af backendens fallback-tekst;
// den oversatte udgave lever i frontend/public/locales/<lng>/board.json.
function getLegacySpecLabel(primarySpec) {
  return {
    gc: "GC focus",
    sprint: "sprint focus",
    classics: "classics focus",
    breakaway: "breakaway style",
    youth: "youth imprint",
    balanced: "balanced profile",
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
//
// #3095 · tier (team.division, 1-4) er OPTIONAL men skal sendes med når kendt:
// hvis tradition-målet er et monument_podium-mål og tier'ens race-klasse-
// whitelist (tierRaceSelection.TIER_CLASS_WHITELIST) ikke overlapper de
// kvalificerende klasser, er målet matematisk umuligt at opfylde i den tier
// (fx italiensk_klassiker i tier 3/4 — #2276-kaskaden kører aldrig Monuments/
// klassikere dér) → dropper målet i stedet for at tilbyde et der straffer
// holdet hver evaluering uden nogensinde at kunne opfyldes.
export function buildDnaTraditionGoal(dnaKey, tier = null) {
  const dna = getDnaByKey(dnaKey);
  if (!dna?.tradition_goal) return null;
  const goal = dna.tradition_goal;
  if (goal.type === "monument_podium" && !tierSupportsRaceScope(tier, goal.race_scope)) {
    return null;
  }
  return {
    ...goal,
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
