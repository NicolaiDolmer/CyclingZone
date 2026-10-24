// #6950 valg A · catch-up via loeb (S13, S14, S16). Rene funktioner, ingen DB.
// Konfigurationen her er en TEST-konfiguration (form, ikke kalibrering): de
// rigtige stoerrelser er private (hard rule 17) og kommer fra harnessen.
import test from "node:test";
import assert from "node:assert/strict";
import {
  RACE_DAY_DECISION,
  assertCatchupConfig,
  decisionBonusShare,
  fieldLevelMedian,
  levelBonusShare,
  raceDayCatchupAbilityMultiplier,
  raceDayCatchupMultiplier,
  raceDayCatchupTickOverrides,
} from "./raceDayCatchup6950.js";
import { applyDailyTick } from "./dailyTraining.js";
import { raceDayProgram } from "./raceDayYield.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

const CFG = Object.freeze({
  supplement: 0.5,
  levelBonusMax: 0.2,
  decisionBonusMax: 0.1,
  droppedInFinalShare: 0.4,
  easyEdge: -10,
  plateauStart: -2,
  plateauEnd: 4,
  hardEdge: 12,
});

test("config: mangler eller ugyldig → kaster (ingen standardtal i repoet)", () => {
  assert.throws(() => assertCatchupConfig(null), /config missing/);
  assert.throws(() => assertCatchupConfig({ ...CFG, supplement: undefined }), /supplement/);
  assert.throws(() => assertCatchupConfig({ ...CFG, levelBonusMax: -0.1 }), /levelBonusMax must be >= 0/);
  assert.throws(() => assertCatchupConfig({ ...CFG, plateauStart: -20 }), /zone/);
  assert.throws(() => assertCatchupConfig({ ...CFG, hardEdge: 4 }), /zone/);
  assert.throws(() => assertCatchupConfig({ ...CFG, droppedInFinalShare: 0 }), /droppedInFinalShare/);
  assert.throws(() => assertCatchupConfig({ ...CFG, droppedInFinalShare: 1 }), /droppedInFinalShare/);
  assert.throws(() => decisionBonusShare(RACE_DAY_DECISION.NONE), /config missing/);
  assert.throws(() => raceDayCatchupMultiplier({ riderLevel: 50, fieldLevel: 50 }), /config missing/);
  const frozen = assertCatchupConfig({ ...CFG, extra: 1 });
  assert.ok(Object.isFrozen(frozen));
  assert.equal(frozen.extra, undefined);
});

test("feltets niveau = median af alle startere; ugyldige ignoreres; tomt → null", () => {
  assert.equal(fieldLevelMedian([60, 40, 50]), 50);
  assert.equal(fieldLevelMedian([40, 50, 60, 70]), 55);
  assert.equal(fieldLevelMedian([50, null, "", "x", NaN, undefined, 70]), 60);
  assert.equal(fieldLevelMedian([]), null);
  assert.equal(fieldLevelMedian(undefined), null);
});

test("S14 niveau-bonus: fuld paa plateauet, 0 ved alt for let og alt for haardt felt", () => {
  const share = (gap) => levelBonusShare({ riderLevel: 50, fieldLevel: 50 + gap, cfg: CFG });
  assert.equal(share(0), 1, "eget niveau ligger i den brede bule");
  assert.equal(share(CFG.plateauStart), 1);
  assert.equal(share(CFG.plateauEnd), 1);
  assert.equal(share(CFG.easyEdge), 0);
  assert.equal(share(CFG.easyEdge - 15), 0, "alt for let felt: ingen bonus");
  assert.equal(share(CFG.hardEdge), 0);
  assert.equal(share(CFG.hardEdge + 30), 0, "G7: alt for haardt felt giver ingen bonus");
});

test("S14 niveau-bonus er glidende (ingen trappe) og altid i [0, 1]", () => {
  let prev = null;
  for (let gap = CFG.easyEdge - 2; gap <= CFG.hardEdge + 2; gap += 0.25) {
    const s = levelBonusShare({ riderLevel: 50, fieldLevel: 50 + gap, cfg: CFG });
    assert.ok(s >= 0 && s <= 1, `andel uden for [0,1] ved gap ${gap}`);
    if (prev != null) assert.ok(Math.abs(s - prev) < 0.12, `spring ved gap ${gap}: ${prev} → ${s}`);
    prev = s;
  }
  // Stigende ind i zonen, faldende ud af den.
  const rising = levelBonusShare({ riderLevel: 50, fieldLevel: 50 + (CFG.easyEdge + CFG.plateauStart) / 2, cfg: CFG });
  const falling = levelBonusShare({ riderLevel: 50, fieldLevel: 50 + (CFG.plateauEnd + CFG.hardEdge) / 2, cfg: CFG });
  assert.ok(rising > 0 && rising < 1);
  assert.ok(falling > 0 && falling < 1);
});

test("ukendt niveau (rytter eller felt) → ingen niveau-bonus, fail-safe", () => {
  assert.equal(levelBonusShare({ riderLevel: null, fieldLevel: 50, cfg: CFG }), 0);
  assert.equal(levelBonusShare({ riderLevel: 50, fieldLevel: null, cfg: CFG }), 0);
  assert.equal(levelBonusShare({ riderLevel: 50, fieldLevel: NaN, cfg: CFG }), 0);
});

test("S14 afgoerelsen: med i afgoerelsen og hjaelper i finalen fuld, faldet fra mellem, ellers 0", () => {
  assert.equal(decisionBonusShare(RACE_DAY_DECISION.IN_DECISION, CFG), 1);
  assert.equal(decisionBonusShare(RACE_DAY_DECISION.HELPER_IN_FINAL, CFG), 1);
  assert.equal(decisionBonusShare(RACE_DAY_DECISION.DROPPED_IN_FINAL, CFG), CFG.droppedInFinalShare);
  assert.equal(decisionBonusShare(RACE_DAY_DECISION.NONE, CFG), 0);
  assert.equal(decisionBonusShare(undefined, CFG), 0);
  assert.equal(decisionBonusShare("unknown", CFG), 0);
});

test("G2 lokalt: multiplikatoren er aldrig under basis (>= 1) for noget input", () => {
  for (const decision of [...Object.values(RACE_DAY_DECISION), null, "x"]) {
    for (let gap = -40; gap <= 40; gap += 1) {
      for (const finished of [true, false]) {
        const m = raceDayCatchupMultiplier({ riderLevel: 50, fieldLevel: 50 + gap, decision, finished, cfg: CFG });
        assert.ok(m >= 1, `under basis: gap ${gap}, ${decision}, finished ${finished}`);
      }
    }
  }
});

test("multiplikatoren: tillaeg + niveau + afgoerelse lagt sammen; S16 udgaaet = kun basis", () => {
  const top = raceDayCatchupMultiplier({ riderLevel: 50, fieldLevel: 51, decision: RACE_DAY_DECISION.IN_DECISION, cfg: CFG });
  assert.equal(top, 1 + CFG.supplement + CFG.levelBonusMax + CFG.decisionBonusMax);
  const tooHard = raceDayCatchupMultiplier({ riderLevel: 30, fieldLevel: 70, cfg: CFG });
  assert.equal(tooHard, 1 + CFG.supplement, "alt for haardt felt: fuldt tillaeg, ingen bonus");
  const dnf = raceDayCatchupMultiplier({ riderLevel: 50, fieldLevel: 51, decision: RACE_DAY_DECISION.IN_DECISION, finished: false, cfg: CFG });
  assert.equal(dnf, 1);
});

test("styrke straffes aldrig: en overlegen rytter faar fuldt tillaeg, kun ingen bonus", () => {
  const dominant = raceDayCatchupMultiplier({ riderLevel: 80, fieldLevel: 50, cfg: CFG });
  assert.equal(dominant, 1 + CFG.supplement);
});

// ── Kobling til applyDailyTick: pengene er ude af loebsdagen (S13) ─────────────

const RICH_COACH = {
  overall: 90,
  dimensions: { physical: 95, mental: 90, technical: 90 },
  levels: { u23: 95, senior: 95 },
  roleSkills: {},
};

function roomyRider() {
  const abilities = {};
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    abilities[ability] = 50;
    caps[ability] = 90;
  }
  return { abilities, caps };
}

function raceTick(extra) {
  const rider = roomyRider();
  return applyDailyTick({
    riderId: "rider-6950",
    dateStr: "2026-10-26",
    age: 21,
    abilities: rider.abilities,
    caps: rider.caps,
    progress: {},
    program: raceDayProgram("mountain"),
    conditionMult: 1,
    potentiale: 4,
    hardDailyCap: 1,
    tickSeedKey: "season-5#gd1",
    riderLevel: "u23",
    ...extra,
  });
}

test("S13: med catch-up-overrides giver rigt og fattigt hold PRAECIS samme loebsdag", () => {
  const overrides = raceDayCatchupTickOverrides();
  // Kontrol: uden overrides giver pengene i dag et rigt hold mere paa loebsdagen.
  const richToday = raceTick({ staff: RICH_COACH, facilityTier: 5 });
  const poorToday = raceTick({ staff: null, facilityTier: 0 });
  assert.ok(richToday.score > poorToday.score, "kontrol: pengene virker paa loebsdagen i dag");
  const rich = raceTick({ staff: RICH_COACH, facilityTier: 5, ...overrides });
  const poor = raceTick({ staff: null, facilityTier: 0, ...overrides });
  assert.deepEqual(rich.progress, poor.progress);
  assert.deepEqual(rich.gains, poor.gains);
  assert.equal(rich.score, poor.score);
  assert.ok(Object.isFrozen(overrides));
});

test("S14: loebets ekstra rammer KUN etapens profil-evner; off-fokus faar basis", () => {
  const { focusAbilities } = raceDayProgram("mountain");
  const args = { riderLevel: 50, fieldLevel: 51, decision: RACE_DAY_DECISION.IN_DECISION, cfg: CFG };
  const full = raceDayCatchupMultiplier(args);
  assert.ok(full > 1);
  for (const ability of VISIBLE_ABILITIES) {
    const m = raceDayCatchupAbilityMultiplier({ ability, focusAbilities, ...args });
    assert.equal(m, focusAbilities.includes(ability) ? full : 1, ability);
  }
  // Afgoerelsen flytter kun profil-evnerne.
  const offFocus = VISIBLE_ABILITIES.find((a) => !focusAbilities.includes(a));
  for (const decision of Object.values(RACE_DAY_DECISION)) {
    assert.equal(raceDayCatchupAbilityMultiplier({ ability: offFocus, focusAbilities, ...args, decision }), 1);
  }
  // Uden config kaster ogsaa off-fokus-grenen (ingen stille neutral-sti).
  assert.throws(() => raceDayCatchupAbilityMultiplier({ ability: offFocus, focusAbilities }), /config missing/);
});
