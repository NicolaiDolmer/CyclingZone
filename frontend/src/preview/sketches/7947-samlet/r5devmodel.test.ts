import { test } from "node:test";
import assert from "node:assert/strict";
import { DEV, POINTS_30, REPORT, devXp30, reportXp } from "./r5devdata.ts";
import { TEAM } from "./r5data.ts";
import { devSummary, earnedPoints, num, reportSummary, summary30 } from "./r5devmodel.ts";

test("udviklings- og rapportdata findes for hver rytter paa holdet", () => {
  assert.deepEqual(DEV.map((r) => r.id), TEAM.map((r) => r.id));
  assert.deepEqual(REPORT.map((r) => r.id), TEAM.map((r) => r.id));
});

test("de sidste 30 dage har 30 dage, og i dag er sidste soejle", () => {
  for (const r of DEV) {
    assert.equal(r.spark.length, 30);
    assert.equal(r.spark[29], r.xpToday ?? 0);
    assert.equal(devXp30(r), r.spark.reduce((a, b) => a + b, 0));
  }
});

test("en rytter i loeb har ingen XP i dag foer etapen afregnes", () => {
  const racing = TEAM.filter((r) => r.racing).map((r) => r.id);
  for (const r of DEV) assert.equal(r.xpToday === null, racing.includes(r.id));
});

test("rapportens evne-XP summer til dagens XP, og et punkt er enten optjent eller fra bjaelken", () => {
  for (const r of REPORT) {
    assert.equal(r.abilities.reduce((a, x) => a + x.xp, 0), reportXp(r));
    assert.equal(r.points.length, earnedPoints(r) + r.points.filter((p) => p.fromBar).length);
    // et punkt hoerer til en evne, der faktisk er markeret med et punkt (eller er betalt fra bjaelken uden XP i dag)
    for (const p of r.points) {
      if (!p.fromBar) assert.ok(r.abilities.some((a) => a.name === p.ability && a.point));
    }
  }
});

test("hviledagen har et punkt fra bjaelken, aldrig dagens eget XP", () => {
  const rest = REPORT.find((r) => reportXp(r) === 0)!;
  assert.equal(rest.points.length, 1);
  assert.equal(rest.points[0].fromBar, true);
});

test("oversigterne summerer rytterne", () => {
  const d = devSummary();
  assert.equal(d.riders, 9);
  assert.equal(d.unsettled, 3);
  const rs = reportSummary();
  assert.equal(rs.points, REPORT.reduce((a, r) => a + r.points.length, 0));
  assert.ok(rs.fromBar <= rs.points);
  assert.ok(rs.raceShare >= 0 && rs.raceShare <= 100);
});

test("30 dage: punkter fra bjaelken er aldrig flere end punkterne, og sæsonen har mindst lige saa mange", () => {
  for (const r of DEV) {
    const p = POINTS_30[r.id];
    assert.ok(p.fromBar <= p.points);
    assert.ok(r.season >= p.points);
  }
  const s = summary30();
  assert.ok(s.fromBar <= s.points);
  assert.ok(s.raceShare >= 0 && s.raceShare <= 100);
});

test("tal skrives med tusindtalsseparator (EN)", () => {
  assert.equal(num(12399), "12,399");
});
