// #6950: syntetiske test-params til koblingens tests. IKKE kalibreringen (den er
// privat, hard rule 17); kun gyldige former, saa testene kan laase adfaerden.

export const SCORE_PARAMS = Object.freeze({
  score: {
    salt: "test",
    midpoint: 50,
    curve: 1,
    talent: { center: 50, spread: 20, baseWeight: 0.2, disciplineWeight: 0.1 },
    noise: { sigma: 0.2, clip: 2.5 },
    race: {
      stageBonus: 1.3,
      decisionBonus: { decisive: 1.2, finale: 1.1 },
      levelBonus: { max: 0.2, fromGap: -10, peakGap: 5, toGap: 20 },
    },
    devMult: { exponent: 1, normalizer: 1 },
  },
  talentByPotentiale: [20, 35, 50, 62, 75, 88],
});

export const CATCHUP_PARAMS = Object.freeze({
  supplement: 0.5,
  levelBonusMax: 0.2,
  decisionBonusMax: 0.1,
  droppedInFinalShare: 0.4,
  easyEdge: -10,
  plateauStart: -2,
  plateauEnd: 4,
  hardEdge: 12,
});
