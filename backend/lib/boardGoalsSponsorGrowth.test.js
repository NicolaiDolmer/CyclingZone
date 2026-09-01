// #3494 · sponsor_growth re-pointet fra det døde teams.sponsor_income-felt
// (altid SPONSOR_INCOME_BASE for alle hold, jf. docs/BOARD_RULES.md §3) til
// ægte sponsor_contracts-udbetalinger (kontrakt-base + løbsdags-indtægt,
// boardGoalContext.js's sponsorGrowthCurrentIncome/sponsorGrowthBaselineIncome).
//
// Rod-årsagen: currentSponsorIncome og planStartSponsorIncome læste begge
// teams.sponsor_income, som det moderne sponsorsystem aldrig skriver til.
// Tælleren (actual) var derfor STRUKTURELT 0 % for ALLE hold, ALTID — og
// siden target altid er positiv, var `met` (evaluateGoal) derfor ALTID false.
//
// Dette er beviset for at fixet ALDRIG kan stille en spiller dårligere:
// scoreHigherBetter(actual, target) klamper enhver actual <= 0 til score 0
// (Math.max(ratio, 0) i boardUtils.js), og den gamle måling gav ALTID
// actual = 0 → score ALTID = 0 (gulvet). Den nye måling kan derfor kun matche
// dette gulv (reelt fald/uændret indkomst) eller forbedre det (reel vækst) —
// ALDRIG gøre det værre. Se "no-punishment"-testene nedenfor.

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGoal, evaluateGoalProgress } from "./boardGoals.js";
import { scoreHigherBetter } from "./boardUtils.js";

const GOAL = { type: "sponsor_growth", target: 12, cumulative: true };

// #3494 · Et team-objekt med et VILDLEDENDE sponsor_income — hvis nogen del af
// koden nogensinde læste det (den gamle bug), ville disse tests fange det:
// baseline/current i context er meget lavere end team.sponsor_income, så en
// util. fald-tilbage ville give et helt andet (forkert) resultat.
const TEAM_WITH_DEAD_FIELD = { sponsor_income: 999_999_999, riders: [] };

test("#3494 · evaluateGoal returnerer null (ikke false) uden for sidste sæson — uændret", () => {
  const result = evaluateGoal(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: false,
    sponsorGrowthBaselineIncome: 100_000,
    sponsorGrowthCurrentIncome: 200_000,
  });
  assert.equal(result, null);
});

test("#3494 · evaluateGoal returnerer null når ingen baseline findes (plan-sæson 1) — awaiting, ikke fejlet", () => {
  const result = evaluateGoal(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: true,
    sponsorGrowthBaselineIncome: null,
    sponsorGrowthCurrentIncome: 200_000,
  });
  assert.equal(result, null);
});

test("#3494 · evaluateGoal returnerer null når current-måling mangler (query-fejl) — awaiting, ikke fejlet", () => {
  const result = evaluateGoal(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: true,
    sponsorGrowthBaselineIncome: 100_000,
    sponsorGrowthCurrentIncome: null,
  });
  assert.equal(result, null);
});

test("#3494 · evaluateGoal true når ægte vækst >= target (kontrakt-base + løbsdag, aldrig teams.sponsor_income)", () => {
  const result = evaluateGoal(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: true,
    sponsorGrowthBaselineIncome: 320_000,
    sponsorGrowthCurrentIncome: 460_000, // (460000-320000)/320000*100 = 43.75% >= 12%
  });
  assert.equal(result, true);
});

test("#3494 · evaluateGoal false når ægte vækst < target", () => {
  const result = evaluateGoal(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: true,
    sponsorGrowthBaselineIncome: 320_000,
    sponsorGrowthCurrentIncome: 330_000, // ~3.1% < 12%
  });
  assert.equal(result, false);
});

test("#3494 · evaluateGoalProgress viser awaiting_data + missing_data uden baseline (ingen falsk 0/N)", () => {
  const progress = evaluateGoalProgress(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: false,
    seasonsCompleted: 1,
    planDuration: 5,
    sponsorGrowthBaselineIncome: null,
    sponsorGrowthCurrentIncome: 200_000,
  });
  assert.equal(progress.status, "awaiting_data");
  assert.equal(progress.missing_data, true);
  assert.equal(progress.actual, null, "actual skal IKKE regnes ud fra en manglende baseline");
});

test("#3494 · evaluateGoalProgress viser awaiting_data uden current-måling", () => {
  const progress = evaluateGoalProgress(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: false,
    seasonsCompleted: 3,
    planDuration: 5,
    sponsorGrowthBaselineIncome: 320_000,
    sponsorGrowthCurrentIncome: null,
  });
  assert.equal(progress.status, "awaiting_data");
  assert.equal(progress.missing_data, true);
});

test("#3494 · evaluateGoalProgress beregner en LÆSBAR procent-vækst (naturlig enhed, ikke rå CZ$)", () => {
  const progress = evaluateGoalProgress(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: false,
    seasonsCompleted: 3,
    planDuration: 5,
    sponsorGrowthBaselineIncome: 320_000,
    sponsorGrowthCurrentIncome: 368_000, // +15% reel vækst
  });
  assert.equal(progress.actual, 15);
  // target pro-rateres: 12 * (3/5) = 7.2 (float-tolerant sammenligning)
  assert.ok(Math.abs(progress.target - 7.2) < 1e-9, `target skal være ~7.2, fik ${progress.target}`);
  assert.equal(progress.status, "ahead");
  assert.equal(progress.missing_data, false);
});

// #3494 (CodeRabbit-fund, PR #4550) · roundNumber (3 decimaler) kan runde en
// raa 11.9996 % op til visnings-12 %, hvilket ville vise "ahead" (12 >= target
// 12) samtidig med at evaluateGoal's autoritative `met`-flag (raa, uafrundet)
// korrekt siger false for 11.9996 < 12 — en selvmodsigelse mellem kortets
// status og "kilden til sandhed". Score/status SKAL regnes af den raa værdi.
test("#3494 · 11.9996% raa vaekst mod target 12: viser 12% men status/score/met er alle 'ikke naaet endnu' (raa-vaerdi-regel)", () => {
  const baseline = 1_000_000;
  const currentIncome = 1_119_996; // (1119996-1000000)/1000000*100 = 11.9996 (raa)

  const progress = evaluateGoalProgress(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: true,
    seasonsCompleted: 5,
    planDuration: 5,
    sponsorGrowthBaselineIncome: baseline,
    sponsorGrowthCurrentIncome: currentIncome,
  });
  assert.equal(progress.actual, 12, "visning afrundes til 12% (kosmetisk, kun til display)");
  // Den raa værdi (11.9996) er lige under target (12) → status er reelt
  // "on_track" (score naer 1, men ratio<1 saa aldrig 'ahead'-grenen). DEN BUGGEDE
  // adfærd (rettet her) var at den AFRUNDEDE 12 >= target 12 slog "ahead" til —
  // det er selve selvmodsigelsen med met=false denne test forhindrer.
  assert.notEqual(progress.status, "ahead",
    "'ahead' ville modsige evaluateGoal's met=false for den samme raa værdi — kun regression-bugget giver 'ahead' her");
  assert.equal(progress.status, "on_track");

  const met = evaluateGoal(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: true,
    sponsorGrowthBaselineIncome: baseline,
    sponsorGrowthCurrentIncome: currentIncome,
  });
  assert.equal(met, false, "evaluateGoal (raa) og evaluateGoalProgress.status (nu ogsaa raa) skal stemme overens");
});

test("#3494 · negativ reel vækst (fx nedrykning) giver 'behind', ikke et krasj", () => {
  const progress = evaluateGoalProgress(GOAL, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: true,
    seasonsCompleted: 5,
    planDuration: 5,
    sponsorGrowthBaselineIncome: 400_000,
    sponsorGrowthCurrentIncome: 340_000, // -15% reel vækst
  });
  assert.equal(progress.actual, -15);
  assert.equal(progress.status, "behind");
  assert.equal(progress.score, 0, "negativ vækst klampes til scoregulvet 0, ikke negativ");
});

// =====================================================================
// "Ingen straf"-invarianten (ejer-krav #3494 punkt 2 + grandfathering-
// princippet fra #1234): re-pointingen må ALDRIG stille en spiller dårligere
// end den dødfødte 0 %-måling gjorde. Beviset: den gamle måling gav ALTID
// actual=0 (currentSponsorIncome ≡ planStartSponsorIncome ≡ teams.sponsor_income),
// og scoreHigherBetter klamper enhver actual <= 0 til score 0 — samme gulv som
// enhver ny negativ/nul-vækst rammer. `met` (evaluateGoal) var derfor ALTID
// false for ethvert positivt target — den nye måling kan kun gøre `met` true
// (reel vækst nået), aldrig regrediere fra true til false.
// =====================================================================

test("#3494 · no-punishment: den gamle målings evige 0%-gulv matcher scoreHigherBetters gulv (0), for et vilkårligt target", () => {
  const legacyAlwaysZeroGrowthScore = scoreHigherBetter(0, 12);
  assert.equal(legacyAlwaysZeroGrowthScore, 0);

  // Enhver ny måling med actual <= 0 (uændret eller faldende sponsor-indkomst)
  // rammer PRÆCIS samme gulv — aldrig lavere.
  for (const actual of [0, -5, -50, -100]) {
    assert.equal(scoreHigherBetter(actual, 12), 0,
      `actual=${actual} skal give samme gulv-score (0) som den gamle altid-0-måling`);
  }
});

test("#3494 · no-punishment: `met` kan kun blive true efter fixet, aldrig regrediere fra sandt til falsk", () => {
  // Den gamle evaluering (simuleret): actual ALTID 0 (teams.sponsor_income
  // uændret), target ALTID positiv → met ALTID false.
  const positiveTargets = [1, 5, 12, 20];
  for (const target of positiveTargets) {
    const legacyMet = 0 >= target; // den gamle formel, indsat direkte
    assert.equal(legacyMet, false, `legacy 'met' skal være false for target=${target}`);
  }

  // Den NYE evaluering: met er false for enhver ikke-tilstrækkelig reel vækst
  // (samme udfald som legacy) og true KUN når væksten reelt når target —
  // en tilstand legacy aldrig kunne nå. Aldrig omvendt.
  const notEnoughGrowth = evaluateGoal({ ...GOAL, target: 12 }, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: true,
    sponsorGrowthBaselineIncome: 100_000,
    sponsorGrowthCurrentIncome: 105_000, // 5% < 12%
  });
  assert.equal(notEnoughGrowth, false, "matcher legacy-udfaldet (false) — ingen forbedring krævet her");

  const enoughGrowth = evaluateGoal({ ...GOAL, target: 12 }, null, TEAM_WITH_DEAD_FIELD, {
    isFinalSeason: true,
    sponsorGrowthBaselineIncome: 100_000,
    sponsorGrowthCurrentIncome: 115_000, // 15% >= 12%
  });
  assert.equal(enoughGrowth, true, "kun opnåeligt EFTER fixet — legacy kunne aldrig blive true");
});
