// #6641: de rene hjaelpere i maaleskriptet (ingen motor, ingen IO).
import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregate, ARMS, EFFORTS, LEVELS, mixEffortFor, queenPlanEfforts, queenStageIndex, pickTemplates, raceClass, realismChecks, realismSummary, stageClass, summarizeDays, summarizeRun, twinId, withTwins } from "./effortLevels6641.mjs";

test("raceClass: bjerg, fladt og blandet ud fra vej-etaperne (enkeltstarter taeller ikke)", () => {
  assert.equal(raceClass([{ profile_type: "mountain" }, { profile_type: "high_mountain" }, { profile_type: "itt" }]), "mountain");
  assert.equal(raceClass([{ profile_type: "flat" }, { profile_type: "rolling" }, { profile_type: "hilly" }]), "flat");
  assert.equal(raceClass([{ profile_type: "flat" }, { profile_type: "hilly" }, { profile_type: "mountain" }]), "mixed");
  assert.equal(raceClass([{ profile_type: "itt" }]), "tt");
  assert.equal(stageClass("medium_mountain"), "hilly");
  assert.equal(stageClass("itt_hilly"), "tt");
});

test("pickTemplates + withTwins: tre niveauer x (fem trin + kontrol + blandet plan), hver tvilling paa sit eget menneskehold", () => {
  const abilities = Array.from({ length: 101 }, (_, i) => ({ rider_id: `r${i}`, climbing: i, durability: 0, punch: 0, recovery: 50 }));
  const templates = pickTemplates(abilities);
  assert.deepEqual(Object.keys(templates), Object.keys(LEVELS));
  assert.equal(templates.mid.climbing, 50);
  const field = withTwins({ entries: [], abilities, teams: [] }, templates);
  assert.equal(field.entries.length, Object.keys(LEVELS).length * ARMS.length);
  const twin = field.abilities.find((a) => a.rider_id === twinId("top", "all_out"));
  assert.equal(twin.climbing, templates.top.climbing);
  assert.ok(field.teams.every((t) => t.is_ai === false));
  assert.equal(new Set(field.teams.map((t) => t.id)).size, field.teams.length);
});

test("summarizeRun + aggregate: tid og pladser maales mod normal-tvillingen paa samme niveau", () => {
  const twins = {};
  for (const level of Object.keys(LEVELS)) {
    for (const effort of EFFORTS) twins[twinId(level, effort)] = { entering: 20, time: effort === "all_out" ? 110 : 100, rank: effort === "all_out" ? 12 : 10, gcRank: 5, inBreak: false, load: 10, out: false };
  }
  const run = { perStage: [{ stage: 1, profile: "mountain", cls: "mountain", twins }], finalFatigue: new Map(Object.keys(twins).map((id) => [id, 30])) };
  const rows = summarizeRun(run);
  const allOut = rows.find((r) => r.level === "mid" && r.effort === "all_out");
  assert.equal(allOut.byClass.mountain.dtMean, 10);
  assert.equal(allOut.byClass.mountain.placesGainedMean, -2);
  const agg = aggregate(rows.map((r) => ({ ...r, model: "date", raceClass: "mountain" })));
  assert.equal(agg.length, Object.keys(LEVELS).length * ARMS.length);
  assert.equal(agg.find((a) => a.level === "mid" && a.effort === "normal").perStageClass.mountain.dtPerStage, 0);
});

test("summarizeRun: tid paa dagen, traethed dagen efter og samlet tid maales mod normal-tvillingen", () => {
  const mk = (stage, profile, cls, f) => {
    const twins = {};
    for (const level of Object.keys(LEVELS)) for (const effort of EFFORTS) twins[twinId(level, effort)] = f(effort);
    return { stage, profile, cls, twins };
  };
  const base = { rank: 10, gcRank: 5, inBreak: false, load: 10, out: false };
  const run = {
    perStage: [
      mk(1, "mountain", "mountain", (e) => ({ ...base, entering: 20, time: e === "all_out" ? 90 : 100 })),
      mk(2, "mountain", "mountain", (e) => ({ ...base, entering: e === "all_out" ? 35 : 25, time: e === "all_out" ? 130 : 100 })),
    ],
    finalFatigue: new Map(),
  };
  const allOut = summarizeRun(run).find((r) => r.level === "mid" && r.effort === "all_out");
  assert.equal(allOut.freshDt, -10, "foerste vej-etape: hurtigere paa friske ben");
  assert.equal(allOut.fatigueVsNormal, 10, "mere traet dagen efter");
  assert.equal(allOut.totalDt, 20, "samlet tid: den traette dag aeder gevinsten");
});

test("summarizeDays: udbrudsdage taeller ikke i tiden, kun i udbruds-andelen", () => {
  const rows = [
    { cls: "mountain", level: "mid", effort: "all_out", dt: -30, out: false, inBreak: false },
    { cls: "mountain", level: "mid", effort: "all_out", dt: null, out: false, inBreak: true },
  ];
  const d = summarizeDays(rows).find((x) => x.effort === "all_out");
  assert.equal(d.dayDt, -30);
  assert.equal(d.breakShare, 50);
});

test("queenPlanEfforts: alt ud paa den haardeste etape (ved lige den sidste), spar foer og efter", () => {
  assert.equal(queenStageIndex(["flat", "mountain", "hilly", "mountain", "flat"]), 3);
  assert.deepEqual(queenPlanEfforts(["flat", "mountain", "hilly", "high_mountain", "flat"]), ["normal", "normal", "save", "all_out", "save"]);
  assert.deepEqual(queenPlanEfforts(["itt", "flat"]), ["save", "all_out"]);
  assert.equal(queenStageIndex(["itt"]), -1);
});

test("mixEffortFor: spar paa fladt, alt ud i bjergene, normal ellers", () => {
  assert.equal(mixEffortFor("flat"), "save");
  assert.equal(mixEffortFor("high_mountain"), "all_out");
  assert.equal(mixEffortFor("hilly"), "normal");
});

test("realismChecks: de fire ejer-retninger (25/10) laeses af opsummeringen", () => {
  const row = (effort, o) => ({ model: "v2", effort, firstAt100: null, out: false, ...o });
  // Retningerne fra maalingen (balance-internals/6641/), kun fortegn og orden: ingen frø-tal.
  const records = [
    row("grupetto", { freshDt: 9, roadDtMean: 9, fatigueVsNormal: -3, finalFatigueVsNormal: -5, totalDt: 90 }),
    row("save", { freshDt: 1, roadDtMean: 1, fatigueVsNormal: -2, finalFatigueVsNormal: -4, totalDt: 8 }),
    row("normal", { freshDt: 0, roadDtMean: 0, fatigueVsNormal: 0, finalFatigueVsNormal: 0, totalDt: 0 }),
    row("protect", { freshDt: 0, roadDtMean: 0, fatigueVsNormal: 1, finalFatigueVsNormal: 2, totalDt: 4 }),
    row("all_out", { freshDt: -2, roadDtMean: -1, fatigueVsNormal: 3, finalFatigueVsNormal: 4, totalDt: 3 }),
    row("mix", { freshDt: -1, roadDtMean: -1, fatigueVsNormal: 1, finalFatigueVsNormal: 2, totalDt: -3 }),
    row("queen", { freshDt: 0, roadDtMean: -1, fatigueVsNormal: 0, finalFatigueVsNormal: 1, totalDt: -2 }),
    row("queenflat", { freshDt: 0, roadDtMean: -1, fatigueVsNormal: 0, finalFatigueVsNormal: 1, totalDt: -2 }),
  ];
  const checks = realismChecks(realismSummary(records), "v2");
  assert.deepEqual(checks, { allOutWinsDay: true, allOutCostsFatigue: true, saveLosesDayLittle: true, saveFresherAfter: true, normalBestTotal: true, mixBeatsNormalTotal: true, allOutEveryDayBehindNormal: true, queenPlanBeatsNormalTotal: true, queenFlatPlanBeatsNormalTotal: true, noLevelHits100: true });
  // Vender en retning, fanges den: all_out der ogsaa vinder samlet er ikke "som i virkeligheden".
  const broken = records.map((r) => (r.effort === "all_out" ? { ...r, totalDt: -5 } : r));
  assert.equal(realismChecks(realismSummary(broken), "v2").normalBestTotal, false);
});
