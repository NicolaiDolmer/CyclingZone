// DOMMER #6110, regel R15: LOEBSDAGEN.
// Kilde: ejer 7/11 (traening 2 af 6), bekraeftet 12/11: "en loebsdag giver altid mindst
// det samme som en haard traeningsdag med rytterens traener og facilitet, og mere i det,
// etapen kraever." Sammenligning med den gamle model er ikke et krav (ejer 12/11).
//
// Dommerens laesning (den snaevre, som reglen mindst siger): evne for evne mod en haard
// traeningsdag i de samme evner, etapen traener, med holdets traener og facilitet.
// Den brede laesning (mod rytterens bedste pas i kataloget) er et aabent spoergsmaal til
// ejeren og doemmes ikke her.

import test from "node:test";
import assert from "node:assert/strict";

import { applyDailyTick } from "./dailyTraining.js";
import {
  kraev, xpParams, UNG_KLATRER, SPRINTER, VETERAN, STAERK_TRAENER, BEDSTE_FACILITET,
} from "./dommer6110.fixtures.mjs";

const P = await xpParams();
const { withRaceDayRoleYieldXp } = await kraev("./developmentXpFlag.ts", "withRaceDayRoleYieldXp");
const { validateRaceDayRoleYieldParams, DECISIVE_ABILITY_BY_PROFILE } =
  await kraev("./raceDayRoleYield5950.js", "validateRaceDayRoleYieldParams", "DECISIVE_ABILITY_BY_PROFILE");
const ROLLETILLAEG = validateRaceDayRoleYieldParams({ stageBonus: 0.2, leadShare: 0.5 });

const PROFILER = ["flat", "hilly", "mountain", "cobbles", "itt"];
const ROLLER = ["captain", "hunter", "helper", "free_role"];
const RYTTERE = [
  { ...UNG_KLATRER, riderLevel: "u23" },
  { ...SPRINTER, riderLevel: "senior" },
  { ...VETERAN, age: 29, riderLevel: "senior" },
];

function dagene(rytter, profil, rolle, { akse = false, traener = true } = {}) {
  const loeb = withRaceDayRoleYieldXp(P, {}, { params: ROLLETILLAEG, profileType: profil, role: rolle });
  assert.equal(loeb.program?.focus, "race_day", "loebsdagen skal have sit eget program");
  const faelles = {
    ...rytter, dateStr: "2026-11-16", caps: {}, progress: {}, conditionMult: 1, developmentXp: P,
    staff: traener ? STAERK_TRAENER : null, facilityTier: traener ? BEDSTE_FACILITET : null,
    ...(akse ? { budgetDivisor: 140, tickSeedKey: "dommer#gd7" } : {}),
  };
  // Den haarde traeningsdag i de samme evner, som etapen traener.
  const haardDag = {
    focus: "dommer_haard_dag", intensity: "hard", focusAbilities: loeb.program.focusAbilities,
    ...(loeb.program.focusWeights ? { focusWeights: loeb.program.focusWeights } : {}),
  };
  return {
    etapensEvner: loeb.program.focusAbilities,
    loebsdag: applyDailyTick({ ...faelles, ...loeb }).xp,
    haard: applyDailyTick({ ...faelles, program: haardDag }).xp,
  };
}

test("R15 loebsdag: scenariet maaler noget (traener og facilitet loefter en haard traeningsdag)", () => {
  const med = dagene(RYTTERE[0], "mountain", "captain").haard;
  const uden = dagene(RYTTERE[0], "mountain", "captain", { traener: false }).haard;
  assert.ok(med.climbing > uden.climbing * 1.15, "holdets traener og facilitet skal kunne maerkes paa traeningsdagen");
});

test("R15 loebsdag: i hver evne mindst det samme som en haard traeningsdag med holdets traener og facilitet", () => {
  for (const akse of [false, true]) {
    for (const rytter of RYTTERE) {
      for (const profil of PROFILER) {
        for (const rolle of ROLLER) {
          const { loebsdag, haard } = dagene(rytter, profil, rolle, { akse });
          for (const evne of Object.keys(haard)) {
            assert.ok((loebsdag[evne] ?? 0) >= haard[evne] * (1 - 1e-9),
              `${rytter.riderId} ${profil} ${rolle} ${evne}${akse ? " (loebsdags-aksen)" : ""}: loebsdag ${loebsdag[evne]} < haard traeningsdag ${haard[evne]}`);
          }
        }
      }
    }
  }
});

test("R15 loebsdag: samlet mere end den haarde traeningsdag, og mere i det, etapen kraever", () => {
  const sum = (xp) => Object.values(xp).reduce((a, b) => a + b, 0);
  for (const rytter of RYTTERE) {
    for (const profil of PROFILER) {
      for (const rolle of ROLLER) {
        const { loebsdag, haard, etapensEvner } = dagene(rytter, profil, rolle);
        assert.ok(sum(loebsdag) > sum(haard), `${rytter.riderId} ${profil} ${rolle}: samlet`);
        const etapen = (xp) => etapensEvner.reduce((a, evne) => a + (xp[evne] ?? 0), 0);
        assert.ok(etapen(loebsdag) > etapen(haard), `${rytter.riderId} ${profil} ${rolle}: etapens evner samlet`);
      }
      // Kaptajnen faar mere i etapens afgoerende evne.
      const afgoerende = DECISIVE_ABILITY_BY_PROFILE[profil];
      const { loebsdag, haard } = dagene(rytter, profil, "captain");
      assert.ok(loebsdag[afgoerende] > haard[afgoerende], `${rytter.riderId} ${profil}: kaptajn i ${afgoerende}`);
    }
  }
});

test("R15 loebsdag: et hold uden traener og facilitet faar det samme ud af loebet som et hold med (S13: loebet er ens for alle)", () => {
  // Gulvet maa loefte et hold med god traener op til dets egen traeningsdag, men loebet
  // selv bliver ikke bedre af traeneren: uden traener er loebsdagen stadig mindst en haard dag.
  for (const profil of PROFILER) {
    const { loebsdag, haard } = dagene(RYTTERE[1], profil, "helper", { traener: false });
    for (const evne of Object.keys(haard)) assert.ok((loebsdag[evne] ?? 0) >= haard[evne] * (1 - 1e-9), `${profil} ${evne}`);
  }
});
