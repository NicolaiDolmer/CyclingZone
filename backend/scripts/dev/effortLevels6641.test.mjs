// #6641: de rene hjaelpere i maaleskriptet (ingen motor, ingen IO).
import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregate, EFFORTS, LEVELS, pickTemplates, raceClass, stageClass, summarizeRun, twinId, withTwins } from "./effortLevels6641.mjs";

test("raceClass: bjerg, fladt og blandet ud fra vej-etaperne (enkeltstarter taeller ikke)", () => {
  assert.equal(raceClass([{ profile_type: "mountain" }, { profile_type: "high_mountain" }, { profile_type: "itt" }]), "mountain");
  assert.equal(raceClass([{ profile_type: "flat" }, { profile_type: "rolling" }, { profile_type: "hilly" }]), "flat");
  assert.equal(raceClass([{ profile_type: "flat" }, { profile_type: "hilly" }, { profile_type: "mountain" }]), "mixed");
  assert.equal(raceClass([{ profile_type: "itt" }]), "tt");
  assert.equal(stageClass("medium_mountain"), "hilly");
  assert.equal(stageClass("itt_hilly"), "tt");
});

test("pickTemplates + withTwins: tre niveauer x fem trin, hver tvilling paa sit eget menneskehold", () => {
  const abilities = Array.from({ length: 101 }, (_, i) => ({ rider_id: `r${i}`, climbing: i, durability: 0, punch: 0, recovery: 50 }));
  const templates = pickTemplates(abilities);
  assert.deepEqual(Object.keys(templates), Object.keys(LEVELS));
  assert.equal(templates.mid.climbing, 50);
  const field = withTwins({ entries: [], abilities, teams: [] }, templates);
  assert.equal(field.entries.length, Object.keys(LEVELS).length * EFFORTS.length);
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
  assert.equal(agg.length, Object.keys(LEVELS).length * EFFORTS.length);
  assert.equal(agg.find((a) => a.level === "mid" && a.effort === "normal").perStageClass.mountain.dtPerStage, 0);
});
