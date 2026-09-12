// backend/lib/calendarRaceDayTargets.test.js
// #4845: samme antal loebsdage i alle fire divisioner. Rene funktioner — ingen DB, ingen tid.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SEASON_RACE_DAY_TARGET, EQUAL_RACE_DAY_TIERS,
  summarizeRaceDayAxis, resolveCommonRaceDayTarget, detectRaceDayEqualityViolations,
  maxEmptyGameDaysPerDate,
} from "./calendarRaceDayTargets.js";

const rows = (...gameDays) => gameDays.map((g) => ({ game_day: g }));

test("summarizeRaceDayAxis: aksen er 0-baseret og tomme loebsdage er dem uden etape", () => {
  // Loebsdag 0,1,3 baerer loeb; 2 er tom; aksen er 4 lang (timelineLength).
  const s = summarizeRaceDayAxis({ stageRows: rows(0, 1, 1, 3), timelineLength: 4 });
  assert.equal(s.axisLength, 4);
  assert.equal(s.raceBearingDays, 3);
  assert.equal(s.emptyGameDays, 1);
});

test("summarizeRaceDayAxis: uden timelineLength udledes laengden af raekkerne (max + 1)", () => {
  const s = summarizeRaceDayAxis({ stageRows: rows(0, 5) });
  assert.equal(s.axisLength, 6, "§0b: aksen er 0-baseret, saa max 5 betyder 6 loebsdage");
  assert.equal(s.emptyGameDays, 4);
});

test("summarizeRaceDayAxis: en for kort timelineLength kan ikke skjule raekker", () => {
  // Fejlklassen #4155: et tal blev troet frem for maalt. Raekkerne vinder altid.
  const s = summarizeRaceDayAxis({ stageRows: rows(0, 9), timelineLength: 3 });
  assert.equal(s.axisLength, 10);
});

test("summarizeRaceDayAxis: tom kalender giver 0, ikke NaN", () => {
  assert.deepEqual(summarizeRaceDayAxis({}), { axisLength: 0, raceBearingDays: 0, emptyGameDays: 0 });
});

test("resolveCommonRaceDayTarget: saesonens eget maal slaar det maalte", () => {
  const r = resolveCommonRaceDayTarget({ axisByTier: { 1: 80, 2: 56, 3: 56, 4: 56 }, season: 4 });
  assert.equal(r.target, SEASON_RACE_DAY_TARGET[4]);
  assert.equal(r.source, "saeson 4");
  assert.deepEqual(r.deficitByTier, { 1: 0, 2: 24, 3: 24, 4: 24 });
  assert.deepEqual(r.impossibleTiers, []);
});

test("resolveCommonRaceDayTarget: override slaar saesonens maal", () => {
  const r = resolveCommonRaceDayTarget({ axisByTier: { 1: 80, 2: 56 }, season: 4, override: 96 });
  assert.equal(r.target, 96);
  assert.equal(r.source, "override");
  assert.deepEqual(r.deficitByTier, { 1: 16, 2: 40 });
});

test("resolveCommonRaceDayTarget: uden saesonmaal bruges den hoejeste MAALTE division", () => {
  const r = resolveCommonRaceDayTarget({ axisByTier: { 1: 84, 2: 60 }, season: 99 });
  assert.equal(r.target, 84);
  assert.equal(r.source, "hoejeste maalte division");
});

test("resolveCommonRaceDayTarget: et maal UNDER en divisions naturlige antal rapporteres, ikke gaettes bort", () => {
  // En division kan ikke presses sammen paa loebsdags-aksen ved at tilfoeje tomme dage.
  const r = resolveCommonRaceDayTarget({ axisByTier: { 1: 80, 4: 56 }, override: 60 });
  assert.deepEqual(r.impossibleTiers, [{ tier: 1, natural: 80, target: 60 }]);
  assert.equal(r.deficitByTier[1], 0, "ingen tomme loebsdage kan lukke et NEGATIVT hul");
});

test("detectRaceDayEqualityViolations: ens antal i alle fire divisioner er groent", () => {
  assert.deepEqual(
    detectRaceDayEqualityViolations({ axisByTier: { 1: 80, 2: 80, 3: 80, 4: 80 }, target: 80 }),
    [],
  );
});

test("detectRaceDayEqualityViolations: dagens skaeve akse fanges (D1 80 mod D4 56)", () => {
  const v = detectRaceDayEqualityViolations({ axisByTier: { 1: 80, 2: 56, 3: 56, 4: 56 }, target: 80 });
  assert.ok(v.some((s) => s.includes("IKKE ens")), "uligheden skal staa foerst og eksplicit");
  assert.equal(v.filter((s) => s.startsWith("tier ")).length, 3, "een linje pr. division der ikke rammer maalet");
});

test("detectRaceDayEqualityViolations: uden maal doemmes KUN ligheden", () => {
  assert.deepEqual(detectRaceDayEqualityViolations({ axisByTier: { 1: 64, 2: 64, 3: 64, 4: 64 } }), []);
  assert.equal(detectRaceDayEqualityViolations({ axisByTier: { 1: 64, 2: 63 } }).length, 1);
});

test("detectRaceDayEqualityViolations: een division alene kan ikke vaere ulige med sig selv", () => {
  assert.deepEqual(detectRaceDayEqualityViolations({ axisByTier: { 1: 80 }, target: 80 }), []);
});

test("EQUAL_RACE_DAY_TIERS daekker de fire spilbare divisioner", () => {
  assert.deepEqual([...EQUAL_RACE_DAY_TIERS], [1, 2, 3, 4]);
});

test("maxEmptyGameDaysPerDate: budgettet spredes over datoerne, aldrig alt paa een", () => {
  assert.equal(maxEmptyGameDaysPerDate({ budget: 0, days: 28 }), 0, "intet budget = intet loft at bruge");
  assert.equal(maxEmptyGameDaysPerDate({ budget: 24, days: 28 }), 2);
  assert.equal(maxEmptyGameDaysPerDate({ budget: 56, days: 28 }), 3);
  assert.ok(maxEmptyGameDaysPerDate({ budget: 24, days: 28 }) * 28 >= 24, "loftet skal kunne rumme budgettet");
});
