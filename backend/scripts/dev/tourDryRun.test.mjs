// #6285: Tour-gennemtestens script og scorecard-lib. Rene funktioner + én lille
// deterministisk koersel paa det anonymiserede Giro-felt (ingen DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArgs, pickRace, slug, GIRO_FIXTURE } from "./tourDryRun.mjs";
import {
  TOUR_BENCHMARKS,
  abilityTimeCorrelation,
  gcTop10InBreakOverThreshold,
  isBunchSprintStage,
  leadoutEffect,
  leadoutTeams,
  minuteLossAtZeroKm,
  ordersWithoutLeadout,
  profileClass,
  renderTourMarkdown,
  runTour,
  summarizeTour,
  verdict,
} from "./lib/tourScorecard.mjs";

test("parseArgs: revision + sammenligning, default seeds, leadout-par kan slaas fra", () => {
  const a = parseArgs(["--race-name=Tour", "--revision=orders_gc_v3"]);
  assert.deepEqual(a.revisions, ["orders_gc_v3", "orders_gc_v2"]);
  assert.equal(a.seeds, 5);
  assert.equal(a.leadoutPair, true);
  assert.equal(a.tier, 1);
  const b = parseArgs(["--revision=orders_gc_v2,official_times_v1", "--compare=orders_gc_v2", "--seeds=2", "--no-leadout-pair"]);
  assert.deepEqual(b.revisions, ["orders_gc_v2", "official_times_v1"]);
  assert.equal(b.leadoutPair, false);
  assert.deepEqual(parseArgs(["--compare=none"]).revisions, ["orders_gc_v3"]);
  assert.throws(() => parseArgs(["--seeds=0"]), /positivt heltal/);
});

test("pickRace: ét navn, division-tier ved flere, fejl ved tvetydighed", () => {
  const r1 = { id: "a", league_division_id: "d1", status: "scheduled" };
  const r2 = { id: "b", league_division_id: "d2", status: "scheduled" };
  const tiers = new Map([["d1", 1], ["d2", 2]]);
  assert.equal(pickRace([r1], tiers), r1);
  assert.equal(pickRace([r1, r2], tiers, 1), r1);
  assert.equal(pickRace([r1, r2], tiers, 2), r2);
  assert.throws(() => pickRace([], tiers), /Intet loeb/);
  assert.throws(() => pickRace([r1, { ...r1, id: "c" }], tiers, 1), /tvetydigt/);
});

test("slug: filnavn uden specialtegn", () => {
  assert.equal(slug("Tour de l'Hexagone"), "tour-de-l-hexagone");
});

test("verdict: PASS i baandet, WARN i tolerancen, FAIL udenfor, N/A uden vaerdi", () => {
  const band = { min: 60, max: 150 };
  assert.equal(verdict(100, band), "PASS");
  assert.equal(verdict(200, band), "WARN");
  assert.equal(verdict(300, band), "FAIL");
  assert.equal(verdict(30, band), "FAIL");
  assert.equal(verdict(null, band), "N/A");
  assert.equal(verdict(0, { max: 0, warnMax: 1 }), "PASS");
  assert.equal(verdict(1, { max: 0, warnMax: 1 }), "WARN");
  assert.equal(verdict(2, { max: 0, warnMax: 1 }), "FAIL");
});

test("benchmark: hver post har kilde og status, og hver klasse kendes", () => {
  for (const [key, b] of Object.entries(TOUR_BENCHMARKS)) {
    for (const [cls, band] of Object.entries(b.byClass)) {
      assert.ok(band.source && band.source.length > 10, `${key}.${cls} mangler kilde`);
      assert.ok(["ejer", "kandidat", "forslag"].includes(band.status), `${key}.${cls} status`);
    }
  }
  assert.equal(profileClass("high_mountain"), "mountain");
  assert.equal(profileClass("rolling"), "hilly");
  assert.equal(profileClass("itt_hilly"), "itt_hilly");
});

test("gcTop10InBreakOverThreshold: top-10-rytter i udbrud med over 5 min til feltet", () => {
  const peloton = Array.from({ length: 30 }, (_, i) => `p${i}`);
  const out = {
    timeline: { events: [{ type: "breakaway_formed", params: { rider_ids: ["g1", "x"] } }] },
    groupSnapshots: [
      { km: 50, groups: [{ rider_ids: ["g1", "x"], gap_seconds: 0 }, { rider_ids: peloton, gap_seconds: 200 }] },
      { km: 90, groups: [{ rider_ids: ["g1", "x"], gap_seconds: 0 }, { rider_ids: peloton, gap_seconds: 360 }] },
    ],
  };
  const gc = [{ rider_id: "g1", time: 0 }, ...peloton.map((id, i) => ({ rider_id: id, time: i + 1 }))];
  assert.deepEqual(gcTop10InBreakOverThreshold(out, gc), ["g1"]);
  assert.deepEqual(gcTop10InBreakOverThreshold(out, []), []);
});

test("minuteLossAtZeroKm: kun snapshots ved start taeller", () => {
  const out = { groupSnapshots: [{ km: 0, groups: [{ rider_ids: ["a"], gap_seconds: 0 }, { rider_ids: ["b", "c"], gap_seconds: 90 }] }, { km: 40, groups: [{ rider_ids: ["d"], gap_seconds: 300 }] }] };
  assert.equal(minuteLossAtZeroKm(out), 2);
});

test("abilityTimeCorrelation: evnen der goer rytteren hurtigere giver positiv rho", () => {
  const out = { results: [["a", 100], ["b", 110], ["c", 120]].map(([rider_id, time_seconds], i) => ({ rider_id, rank: i + 1, time_seconds, status: "finished" })) };
  const ab = new Map([["a", { time_trial: 80, climbing: 10 }], ["b", { time_trial: 70, climbing: 20 }], ["c", { time_trial: 60, climbing: 30 }]]);
  assert.equal(abilityTimeCorrelation(out, ab, "time_trial"), 1);
  assert.equal(abilityTimeCorrelation(out, ab, "climbing"), -1);
});

test("leadout: ordrer uden tog og effekten paa sprint-kaptajnerne", () => {
  const orders = [{ team_id: "t1", stage_number: 2, riders: [{ rider_id: "h", leadout: true }] }, { team_id: "t2", stage_number: 3, riders: [{ rider_id: "k", leadout: true }] }];
  assert.deepEqual([...leadoutTeams(orders, 2)], ["t1"]);
  const stripped = ordersWithoutLeadout(orders, 2);
  assert.equal(stripped[0].riders[0].leadout, false);
  assert.equal(stripped[1].riders[0].leadout, true);
  const entrants = [{ rider_id: "s", team_id: "t1", race_role: "sprint_captain" }, { rider_id: "o", team_id: "t2", race_role: "sprint_captain" }];
  const eff = leadoutEffect({ withRes: { ranked: [{ rider_id: "s", rank: 1 }] }, withoutRes: { ranked: [{ rider_id: "s", rank: 4 }] }, entrants, teams: new Set(["t1"]) });
  assert.deepEqual(eff, { captains: 1, meanRankGain: 3, winsWith: 1, winsWithout: 0 });
  assert.equal(isBunchSprintStage({ profile_type: "hilly", finale_type: "reduced_sprint" }), true);
  assert.equal(isBunchSprintStage({ profile_type: "mountain", finale_type: "long_climb" }), false);
});

test("runTour: hele Giro-feltet, deterministisk, scorecard pr. etape og samlet", async () => {
  const { loadRaceEngineV4 } = await import("../../lib/raceEngineV4Bridge.js");
  const v4 = await loadRaceEngineV4();
  const data = JSON.parse(readFileSync(GIRO_FIXTURE, "utf8"));
  const a = runTour({ v4, data, revision: "orders_gc_v3", seeds: 1 });
  const b = runTour({ v4, data, revision: "orders_gc_v3", seeds: 1 });
  assert.deepEqual(a.summary, b.summary, "samme seed = samme scorecard");
  assert.equal(a.summary.stages.length, data.profiles.length);
  const itt = a.summary.stages.find((s) => s.profile_type === "itt_hilly");
  assert.ok(itt.rhoTempo !== null && itt.rhoClimb !== null, "kuperet ITT maaler evnevaegt (#6349)");
  assert.ok(a.summary.stages.some((s) => s.leadoutRankGain !== null), "sprinttoget maales paa mindst én etape (#6352)");
  assert.ok(Number.isFinite(a.summary.race.gcTo10Final));
  const total = Object.values(a.summary.counts).reduce((x, y) => x + y, 0);
  assert.ok(total > 20);
  const md = renderTourMarkdown({ raceLabel: "fixture", runs: [a, runTour({ v4, data, revision: "orders_gc_v2", seeds: 1, leadoutPair: false })], generatedAt: "t" });
  assert.match(md, /## Side om side/);
  assert.match(md, /## Benchmark-kilder/);
  assert.deepEqual(summarizeTour(a.perSeed, data.profiles.slice().sort((x, y) => x.stage_number - y.stage_number)).counts, a.summary.counts);
});
