// S-02f · Tests for klub-DNA-engine.
// Dækker: 5 DNA seedet · suggestions deterministiske + national/spec-match · DNA-bias
// på alignment-score · DNA-vægtning på mål · tradition-goal injection.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_CLUB_DNA,
  DNA_KEYS,
  applyDnaWeightingToGoals,
  buildBoardProposal,
  buildDnaTraditionGoal,
  computeDnaSuggestions,
  getDnaArchetypeAlignmentBonus,
  getDnaByKey,
  getDnaGoalWeightMultiplier,
  isValidDnaKey,
  selectBoardMembers,
} from "./boardEngine.js";

// =============================================================
// 1. Konstanter
// =============================================================

test("BOARD_CLUB_DNA seedes med præcis 5 arketyper", () => {
  assert.equal(DNA_KEYS.length, 5);
  assert.deepEqual(DNA_KEYS, [
    "skandinavisk_udvikling",
    "italiensk_klassiker",
    "sprint_kommerciel",
    "fransk_klatrer",
    "britisk_allrounder",
  ]);
  for (const key of DNA_KEYS) {
    const dna = BOARD_CLUB_DNA[key];
    assert.ok(dna, `${key} skal eksistere`);
    assert.equal(typeof dna.label, "string");
    assert.equal(typeof dna.emoji, "string");
    assert.ok(dna.policy_axes && typeof dna.policy_axes === "object");
    assert.ok(Array.isArray(dna.national_affinity));
    assert.ok(Array.isArray(dna.specialization_affinity));
    assert.ok(dna.member_alignment_bonus && typeof dna.member_alignment_bonus === "object");
    assert.ok(dna.goal_weighting && typeof dna.goal_weighting === "object");
    assert.ok(dna.tradition_goal && typeof dna.tradition_goal === "object");
    assert.equal(dna.tradition_goal.label_key, `dna.${key}.traditionGoalLabel`);
  }
});

test("isValidDnaKey + getDnaByKey", () => {
  assert.equal(isValidDnaKey("italiensk_klassiker"), true);
  assert.equal(isValidDnaKey("ukendt_dna"), false);
  assert.equal(isValidDnaKey(null), false);
  assert.equal(getDnaByKey("italiensk_klassiker").label, "Italiensk klassiker-traditionalist");
  assert.equal(getDnaByKey("ukendt"), null);
});

// =============================================================
// 2. computeDnaSuggestions — 3 forslag, deterministisk
// =============================================================

test("computeDnaSuggestions returnerer 3 unikke forslag", () => {
  const identityBasis = {
    season_number_observed: 1,
    rider_count: 8,
    primary_specialization: "classics",
    secondary_specialization: "balanced",
    youth_share_pct: 30,
    youth_level: "medium",
    national_core: { code: "IT", count: 5, share_pct: 62, strength: "high", established: true },
    star_profile: { level: "medium" },
  };

  const suggestions = computeDnaSuggestions(identityBasis);
  assert.equal(suggestions.length, 3);
  const keys = suggestions.map((s) => s.key);
  assert.equal(new Set(keys).size, 3, "alle 3 forslag skal være unikke DNA-nøgler");
  assert.ok(suggestions.every((s) => DNA_KEYS.includes(s.key)));
});

test("computeDnaSuggestions matcher italiensk_klassiker når national_core=IT + classics", () => {
  const suggestions = computeDnaSuggestions({
    rider_count: 8,
    primary_specialization: "classics",
    youth_level: "low",
    national_core: { code: "IT", count: 6, share_pct: 75, strength: "high", established: true },
    star_profile: { level: "high" },
  });

  // Italiensk_klassiker har IT i national_affinity og classics i specialization_affinity
  // — kan ramme én af de to slots, men SKAL være med.
  assert.ok(suggestions.some((s) => s.key === "italiensk_klassiker"),
    "italiensk_klassiker må være blandt forslagene for IT-kerne med classics-fokus");
});

test("computeDnaSuggestions er deterministisk (samme input → samme output)", () => {
  const identityBasis = {
    rider_count: 8,
    primary_specialization: "sprint",
    youth_level: "low",
    national_core: { code: "DK", count: 3, share_pct: 38, strength: "low", established: false },
    star_profile: { level: "medium" },
  };
  const a = computeDnaSuggestions(identityBasis);
  const b = computeDnaSuggestions(identityBasis);
  assert.deepEqual(a.map((s) => s.key), b.map((s) => s.key));
});

test("computeDnaSuggestions falder tilbage til defaults uden identityBasis", () => {
  const suggestions = computeDnaSuggestions(null);
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.every((s) => s.key && s.label));
  assert.ok(suggestions.every((s) => s.label_key === `dna.${s.key}.label`));
  assert.ok(suggestions.every((s) => s.short_description_key === `dna.${s.key}.shortDescription`));
  assert.ok(suggestions.every((s) => s.long_description_key === `dna.${s.key}.longDescription`));
});

test("computeDnaSuggestions slot-tags er udfyldt korrekt", () => {
  const suggestions = computeDnaSuggestions({
    rider_count: 8,
    primary_specialization: "gc",
    youth_level: "medium",
    national_core: { code: "FR", count: 4, share_pct: 50, strength: "medium", established: true },
    star_profile: { level: "medium" },
  });
  const slots = suggestions.map((s) => s.suggestion_slot);
  assert.deepEqual(slots, ["national_match", "specialization_match", "wildcard"]);
});

test("computeDnaSuggestions returnerer rationale i i18n-key format", () => {
  const suggestions = computeDnaSuggestions({
    rider_count: 8,
    primary_specialization: "gc",
    youth_level: "medium",
    national_core: { code: "FR", count: 4, share_pct: 50, strength: "medium", established: true },
    star_profile: { level: "medium" },
  });

  const national = suggestions.find((s) => s.suggestion_slot === "national_match");
  const specialization = suggestions.find((s) => s.suggestion_slot === "specialization_match");
  const wildcard = suggestions.find((s) => s.suggestion_slot === "wildcard");

  assert.equal(national.rationale_key, "dna.suggestionRationale.nationalMatch");
  assert.equal(national.rationaleKey, "dna.suggestionRationale.nationalMatch");
  assert.equal(national.rationale_params.nationalCode, "FR");
  assert.equal(specialization.rationale_key, "dna.suggestionRationale.specializationMatch");
  assert.equal(specialization.rationaleKey, "dna.suggestionRationale.specializationMatch");
  assert.equal(specialization.rationale_params.primarySpec, "gc");
  assert.equal(wildcard.rationale_key, "dna.suggestionRationale.wildcard");
  assert.equal(wildcard.rationaleKey, "dna.suggestionRationale.wildcard");
});

// =============================================================
// 3. DNA-bias på board-medlems-alignment
// =============================================================

test("getDnaArchetypeAlignmentBonus matcher seedet member_alignment_bonus", () => {
  // italiensk_klassiker har klassiker_purist:4, gc_elsker:-2
  assert.equal(getDnaArchetypeAlignmentBonus("italiensk_klassiker", "klassiker_purist"), 4);
  assert.equal(getDnaArchetypeAlignmentBonus("italiensk_klassiker", "gc_elsker"), -2);
  // Arketype uden bonus i map → 0
  assert.equal(getDnaArchetypeAlignmentBonus("italiensk_klassiker", "sponsoraten"), 0);
  // Ukendt DNA → 0
  assert.equal(getDnaArchetypeAlignmentBonus("ukendt", "klassiker_purist"), 0);
});

test("selectBoardMembers anvender DNA-bias så italiensk_klassiker tipper mod klassiker_purist", () => {
  const identityBasis = {
    season_number_observed: 1,
    rider_count: 8,
    primary_specialization: "balanced",
    secondary_specialization: "balanced",
    youth_share_pct: 25,
    youth_level: "medium",
    national_core: { code: "DE", count: 2, share_pct: 25, strength: "low", established: false },
    star_profile: { level: "medium" },
  };

  const withoutDna = selectBoardMembers({ identityBasis, teamId: "team-1" });
  const withDna = selectBoardMembers({ identityBasis, teamId: "team-1", dnaKey: "italiensk_klassiker" });

  const klassikerWithout = withoutDna.find((m) => m.archetype_key === "klassiker_purist")?.alignment_score ?? 0;
  const klassikerWith = withDna.find((m) => m.archetype_key === "klassiker_purist")?.alignment_score ?? 0;
  assert.ok(klassikerWith > klassikerWithout,
    "klassiker_purist skal score højere med italiensk_klassiker DNA");
});

// =============================================================
// 4. DNA-mål-vægtning + tradition-goal
// =============================================================

test("getDnaGoalWeightMultiplier matcher seedet goal_weighting (default 1.0)", () => {
  // italiensk_klassiker: monument_podium=1.6
  assert.equal(getDnaGoalWeightMultiplier("italiensk_klassiker", "monument_podium"), 1.6);
  // Ikke i map → 1.0
  assert.equal(getDnaGoalWeightMultiplier("italiensk_klassiker", "stage_wins"), 1.0);
  // Ukendt DNA → 1.0
  assert.equal(getDnaGoalWeightMultiplier("ukendt", "monument_podium"), 1.0);
});

test("applyDnaWeightingToGoals booster bonus + penalty for matchende mål-typer", () => {
  const goals = [
    { type: "monument_podium", target: 1, satisfaction_bonus: 20, satisfaction_penalty: 10, label: "Monument-podie" },
    { type: "stage_wins", target: 3, satisfaction_bonus: 10, satisfaction_penalty: 5, label: "Etape-sejre" },
  ];
  const weighted = applyDnaWeightingToGoals(goals, "italiensk_klassiker");
  // monument_podium: 1.6 multiplier
  assert.equal(weighted[0].satisfaction_bonus, Math.round(20 * 1.6));
  assert.equal(weighted[0].satisfaction_penalty, Math.round(10 * 1.6));
  assert.equal(weighted[0].dna_weighted, true);
  assert.equal(weighted[0].dna_key, "italiensk_klassiker");
  // stage_wins ikke i goal_weighting → uændret
  assert.equal(weighted[1].satisfaction_bonus, 10);
  assert.equal(weighted[1].dna_weighted, undefined);
});

test("applyDnaWeightingToGoals returnerer goals uændret uden DNA", () => {
  const goals = [{ type: "monument_podium", target: 1, satisfaction_bonus: 20, satisfaction_penalty: 10 }];
  assert.deepEqual(applyDnaWeightingToGoals(goals, null), goals);
});

test("buildDnaTraditionGoal returnerer markeret club_dna mål", () => {
  const goal = buildDnaTraditionGoal("fransk_klatrer");
  assert.ok(goal);
  assert.equal(goal.type, "min_national_riders");
  assert.equal(goal.nationality_code, "FR");
  assert.equal(goal.source, "club_dna");
  assert.equal(goal.dna_key, "fransk_klatrer");
  assert.equal(goal.label_key, "dna.fransk_klatrer.traditionGoalLabel");
  assert.equal(goal.importance, "bonus");
  assert.ok(goal.satisfaction_bonus > 0);
});

test("buildDnaTraditionGoal returnerer null for ukendt DNA", () => {
  assert.equal(buildDnaTraditionGoal(null), null);
  assert.equal(buildDnaTraditionGoal("ukendt"), null);
});

// =============================================================
// 5. buildBoardProposal — DNA-injection i 5yr
// =============================================================

test("buildBoardProposal injicerer DNA-tradition-mål i 5yr-forslag", () => {
  const team = { division: 3, riders: [], sponsor_income: 100, balance: 800000 };
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "5yr",
    team,
    riders: [],
    standing: { rank_in_division: 4 },
    identityBasis: {
      rider_count: 8,
      primary_specialization: "classics",
      youth_level: "medium",
      national_core: { code: "IT", count: 6, share_pct: 75, strength: "high", established: true },
      star_profile: { level: "medium" },
    },
    dnaKey: "italiensk_klassiker",
  });

  assert.equal(proposal.dna_key, "italiensk_klassiker");
  // monument_podium fra italiensk_klassiker tradition_goal SKAL være på 5yr-forslaget
  const traditionGoal = proposal.goals.find((g) => g.type === "monument_podium" && g.source === "club_dna");
  assert.ok(traditionGoal, "italiensk_klassiker skal injicere monument_podium tradition-mål");
  assert.equal(traditionGoal.dna_key, "italiensk_klassiker");
});

test("buildBoardProposal duplikerer IKKE tradition-mål når base-pakken allerede har samme type", () => {
  // britisk_allrounder har relative_rank som tradition; 'balanced'-focus har ALLEREDE relative_rank.
  const team = { division: 3, riders: [], sponsor_income: 100, balance: 800000 };
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "5yr",
    team,
    riders: [],
    standing: { rank_in_division: 4 },
    identityBasis: {
      rider_count: 8,
      primary_specialization: "balanced",
      youth_level: "medium",
      national_core: { code: "GB", count: 4, share_pct: 50, strength: "medium", established: true },
      star_profile: { level: "medium" },
    },
    dnaKey: "britisk_allrounder",
  });

  const relativeRankGoals = proposal.goals.filter((g) => g.type === "relative_rank");
  assert.equal(relativeRankGoals.length, 1, "ingen duplikat-mål når DNA-tradition matcher base-pakken");
});

test("buildBoardProposal uden dnaKey opfører sig som før (ingen tradition-injection)", () => {
  const team = { division: 3, riders: [], sponsor_income: 100, balance: 800000 };
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "5yr",
    team,
    riders: [],
    standing: { rank_in_division: 4 },
    identityBasis: null,
  });

  assert.equal(proposal.dna_key, null);
  // Ingen mål skal være markeret som club_dna
  const clubDnaGoals = proposal.goals.filter((g) => g.source === "club_dna");
  assert.equal(clubDnaGoals.length, 0);
});

test("buildBoardProposal injicerer IKKE tradition-mål for 1yr-planer (kun 5yr)", () => {
  const team = { division: 3, riders: [], sponsor_income: 100, balance: 800000 };
  const proposal = buildBoardProposal({
    focus: "balanced",
    planType: "1yr",
    team,
    riders: [],
    standing: { rank_in_division: 4 },
    dnaKey: "italiensk_klassiker",
  });

  const clubDnaGoals = proposal.goals.filter((g) => g.source === "club_dna");
  assert.equal(clubDnaGoals.length, 0);
});
