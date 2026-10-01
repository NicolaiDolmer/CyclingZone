import test from "node:test";
import assert from "node:assert/strict";
import { effectiveLimit, exceptionMode, ridersOverLimit, stripDays, weekdayKey, type RecentHit } from "./FatigueRuleModel.ts";

const team = { threshold: 60, fallback: "rest", recoveryAfterStage: false };

test("undtagelsens tilstand og den graense der gaelder (samme stige som motoren)", () => {
  assert.equal(exceptionMode(undefined), "team");
  assert.equal(exceptionMode({ threshold: null, fallback: "off", recoveryAfterStage: null }), "off");
  assert.equal(exceptionMode({ threshold: 40, fallback: "light", recoveryAfterStage: null }), "own");
  assert.deepEqual(effectiveLimit(team, undefined), { threshold: 60, fallback: "rest" });
  assert.deepEqual(effectiveLimit(team, { threshold: 40, fallback: "light", recoveryAfterStage: null }), { threshold: 40, fallback: "light" });
  assert.equal(effectiveLimit(team, { threshold: null, fallback: "off", recoveryAfterStage: null }), null);
  assert.equal(effectiveLimit(null, undefined), null);
});

test("ryttere over graensen nu: kun OVER, undtagelser respekteres", () => {
  const roster = [{ id: "a", name: "A", fatigue: 61 }, { id: "b", name: "B", fatigue: 60 }, { id: "c", name: "C", fatigue: 90 }];
  assert.equal(ridersOverLimit(roster, team, {}), 2);
  assert.equal(ridersOverLimit(roster, team, { c: { threshold: null, fallback: "off", recoveryAfterStage: null } }), 1);
});

test("ugestriben: én celle pr. dato, en rytter taeller én gang pr. dato", () => {
  const hit = (date: string, riderId: string, gameDay: number, kind: RecentHit["kind"] = "fatigue"): RecentHit => ({
    date, gameDay, riderId, kind, fallback: kind === "fatigue" ? "rest" : "recovery", fatigue: 70, threshold: kind === "fatigue" ? 60 : null,
  });
  const days = stripDays(["2026-09-30", "2026-10-01"], [
    hit("2026-09-30", "a", 10, "after_stage"), hit("2026-09-30", "a", 11), hit("2026-09-30", "a", 12), hit("2026-09-30", "b", 10),
  ]);
  assert.equal(days.length, 2);
  assert.equal(days[0].riders.length, 2);
  assert.deepEqual(days[0].riders[0].hits.map((h) => h.kind), ["after_stage", "fatigue"]);
  assert.equal(days[1].riders.length, 0);
  assert.equal(weekdayKey("2026-10-01"), "thu");
});
