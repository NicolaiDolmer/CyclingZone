// #6285: Tour-gennemtestens script og scorecard-lib. Rene funktioner + én lille
// deterministisk koersel paa det anonymiserede Giro-felt (ingen DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArgs, pickRace, slug, GIRO_FIXTURE } from "./tourDryRun.mjs";
import {
  KNOWN_OPEN_GATES,
  TOUR_BENCHMARKS,
  abilityTimeCorrelation,
  applyKnownOpen,
  gateStatus,
  gcTop10InBreakOverThreshold,
  isBunchSprintStage,
  leadoutEffect,
  leadoutTeams,
  minuteLossAtZeroKm,
  ordersWithoutLeadout,
  profileClass,
  renderTourMarkdown,
  runStagesInOrder,
  runTour,
  splitEntrants,
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
  // Udbrudsdommen er pr. profile_type, ikke pr. sammenlagt klasse.
  const share = TOUR_BENCHMARKS.breakawayWinShare.byClass;
  assert.ok(share.high_mountain && share.mountain && share.rolling && share.hilly);
  assert.notDeepEqual([share.high_mountain.min, share.high_mountain.max], [share.mountain.min, share.mountain.max]);
});

test("summarizeTour: udbrud doemmes pr. profile_type, high_mountain og rolling slaas ikke sammen", () => {
  const stages = [
    { stage_number: 1, profile_type: "mountain" },
    { stage_number: 2, profile_type: "high_mountain" },
    { stage_number: 3, profile_type: "rolling" },
  ];
  const row = (stage, profile_type, won) => ({ stage, profile_type, cls: profileClass(profile_type), breakawayWon: won, breakawaySize: 8, minuteLossAtZeroKm: null, gcTop10InBreakOver5Min: 0, ownTeamChasesOwn: 0, clampedAtCap: 0, capClump: 0, labelContradictions: 0, flatBreakawayWinMinutes: 0 });
  // To seeds: mountain vinder 1/2, high_mountain 2/2 (over sit lave baand), rolling 0/2.
  const perSeed = [
    { seed: 1, rows: [row(1, "mountain", true), row(2, "high_mountain", true), row(3, "rolling", false)], gcWeek1: null, gcFinalTo10: null, gcWinnerMargin: null, gcWinner: "a" },
    { seed: 2, rows: [row(1, "mountain", false), row(2, "high_mountain", true), row(3, "rolling", false)], gcWeek1: null, gcFinalTo10: null, gcWinnerMargin: null, gcWinner: "a" },
  ];
  const s = summarizeTour(perSeed, stages, "orders_gc_v3");
  const byType = Object.fromEntries(s.classes.map((c) => [c.profile_type, c]));
  assert.deepEqual(Object.keys(byType).sort(), ["high_mountain", "mountain", "rolling"]);
  assert.equal(byType.high_mountain.breakawayWinShare, 1);
  assert.equal(byType.high_mountain.verdicts.breakawayWinShare, "FAIL", "high_mountain doemmes mod sit eget baand");
  assert.equal(byType.mountain.verdicts.breakawayWinShare, verdict(0.5, TOUR_BENCHMARKS.breakawayWinShare.byClass.mountain));
  // Ingen etape kunne maales paa filmen: N/A, aldrig PASS.
  assert.equal(s.race.minuteLossAtZeroKm, null);
  assert.equal(s.race.verdicts.minuteLossAtZeroKm, "N/A");
});

test("kendte aabne gates taeller aldrig som groenne i scorecardet", () => {
  assert.equal(gateStatus("capClump", "orders_gc_v2"), "todo");
  assert.equal(gateStatus("capClump", "official_times_v1"), "gate");
  assert.equal(applyKnownOpen("PASS", "capClump", "orders_gc_v2"), "TODO");
  assert.equal(applyKnownOpen("FAIL", "capClump", "orders_gc_v2"), "FAIL");
  assert.equal(applyKnownOpen("PASS", "capClump", "official_times_v1"), "PASS");
  for (const check of Object.keys(KNOWN_OPEN_GATES)) for (const rev of Object.keys(KNOWN_OPEN_GATES[check])) assert.equal(gateStatus(check, rev), "todo");
  const perSeed = [{ seed: 1, rows: [{ stage: 1, profile_type: "flat", cls: "flat", breakawayWon: false, breakawaySize: 3, minuteLossAtZeroKm: 0, gcTop10InBreakOver5Min: 0, ownTeamChasesOwn: 0, clampedAtCap: 0, capClump: 0, labelContradictions: 0, flatBreakawayWinMinutes: 0 }], gcWeek1: null, gcFinalTo10: null, gcWinnerMargin: null, gcWinner: "a" }];
  const s = summarizeTour(perSeed, [{ stage_number: 1, profile_type: "flat" }], "orders_gc_v2");
  assert.equal(s.race.verdicts.clampedAtCap, "TODO");
  assert.equal(s.race.verdicts.flatBreakawayWinMinutes, "TODO");
  assert.equal(s.race.verdicts.minuteLossAtZeroKm, "PASS", "maalt 0 paa filmen er en aegte PASS");
  assert.ok(s.counts.TODO >= 3);
  assert.deepEqual(s.gates.map((g) => [g.check, g.status]), [["flatBreakawayMinutes", "todo"], ["capClump", "todo"], ["labelContradiction", "todo"]]);
});

test("splitEntrants: ryttere uden evner taelles i stedet for at forsvinde", () => {
  const data = { teams: [{ id: "t", is_ai: true }], entries: [{ rider_id: "a", team_id: "t" }, { rider_id: "b", team_id: "t" }], abilities: [{ rider_id: "a", climbing: 50 }] };
  const r = splitEntrants(data);
  assert.equal(r.entrants.length, 1);
  assert.equal(r.droppedWithoutAbilities, 1);
  assert.deepEqual(r.droppedRiderIds, ["b"]);
  assert.equal(r.entrants[0].team_is_ai, true);
});

test("runStagesInOrder: klassementet summerer resultatlistens gab (clampet under v2/v3) minus bonus, og motoren faar det fra etape 2", () => {
  const calls = [];
  // Falsk adapter: rytter b er 40 min efter paa raa tid, men listen clamper til 30:00.
  const v4 = {
    simulateStage: (input) => {
      calls.push({ stage: input.stageNumber, gc: input.gcStandings, n: input.entrants.length });
      const ranked = [{ rider_id: "a", rank: 1, stageGap: 0 }, { rider_id: "b", rank: 2, stageGap: 1800 }];
      if (input.stageNumber === 1) ranked.push({ rider_id: "c", rank: 3, stageGap: 10 });
      return { ranked, passages: { perRider: new Map([["b", { bonus_seconds: 4 }]]) }, v4Output: { results: [] }, timeline: null };
    },
  };
  const data = { race: { id: "r" }, orders: [], profiles: [{ stage_number: 1, profile_type: "flat" }, { stage_number: 2, profile_type: "flat" }] };
  const entrants = ["a", "b", "c"].map((id) => ({ rider_id: id, team_id: "t" }));
  const final = runStagesInOrder({ v4, data, revision: "orders_gc_v2", seedTag: "x", entrants });
  assert.deepEqual(calls[0].gc, [], "etape 1: tomt klassement (first_stage)");
  assert.deepEqual(calls[1].gc.map((s) => [s.rider_id, s.time]), [["a", 0], ["c", 10], ["b", 1796]], "etape 2: klassementet efter etape 1");
  assert.equal(calls[1].n, 3);
  assert.deepEqual(final.map((s) => [s.rider_id, s.time]), [["a", 0], ["b", 3592]], "c udgik paa etape 2; b = 2 x (30:00 - 4 s bonus)");
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

test("minuteLossAtZeroKm: maales paa loebsfilmens tidslinje ved start, N/A uden film", () => {
  const base = [{ km: 0, type: "stage_start", params: { field_count: 6 } }, { km: 40, type: "gap_update", params: { group_id: "chase-1", gap_seconds: 30 } }];
  assert.equal(minuteLossAtZeroKm(base), 0, "intet bagud ved start = 0 (maalt)");
  // Gruppe 1:30 efter fronten paa km 0: begge dens ryttere taeller.
  const gapAtStart = [...base, { km: 0, type: "peloton_splits", params: { group_id: "chase-9", rider_ids: ["b", "c"] } }, { km: 0, type: "gap_update", params: { group_id: "chase-9", gap_seconds: 90 } }];
  assert.equal(minuteLossAtZeroKm(gapAtStart, { riderIds: ["a", "b", "c"] }), 2);
  // Et uheld med 2 min tidstab uden km: filmen laegger det paa km 0.
  const noKm = [...base, { type: "incident", params: { rider_id: "d", kind: "crash", severity: "light", outcome: "time_loss", time_loss_seconds: 120 } }];
  assert.equal(minuteLossAtZeroKm(noKm, { riderIds: ["d"] }), 1);
  // Samme uheld paa km 60 er ikke "paa 0 km".
  assert.equal(minuteLossAtZeroKm([...base, { ...noKm[2], km: 60 }], { riderIds: ["d"] }), 0);
  // Ingen tidslinje / ingen v4-gruppe-gab: filmen kan intet vise -> null, aldrig 0.
  assert.equal(minuteLossAtZeroKm(null), null);
  assert.equal(minuteLossAtZeroKm([{ km: 0, type: "stage_start", params: {} }, { km: 10, type: "gap_update", params: { gap_seconds: 30 } }]), null);
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
  assert.equal(a.droppedWithoutAbilities, 0);
  // Minuttab ved start maales paa den rigtige loebsfilm (vejetaper), N/A paa tidskoersler.
  const road = a.summary.stages.filter((s) => !["itt", "itt_hilly", "ttt"].includes(s.profile_type));
  assert.ok(road.every((s) => Number.isFinite(s.minuteLossAtZeroKm)), "hver vejetape skal kunne maales paa filmen");
  assert.ok(a.summary.stages.filter((s) => s.profile_type.startsWith("itt")).every((s) => s.minuteLossAtZeroKm === null));
  assert.equal(a.summary.race.minuteLossMeasuredStages, road.length);
  assert.equal(a.summary.gates.length, 3);
  const total = Object.values(a.summary.counts).reduce((x, y) => x + y, 0);
  assert.ok(total > 20);
  const md = renderTourMarkdown({ raceLabel: "fixture", runs: [a, runTour({ v4, data, revision: "orders_gc_v2", seeds: 1, leadoutPair: false })], generatedAt: "t" });
  assert.match(md, /## Side om side/);
  assert.match(md, /## Benchmark-kilder/);
  assert.match(md, /### Motor-gates \(#6285\)/);
  assert.match(md, /TODO \(kendt aaben/);
  assert.deepEqual(summarizeTour(a.perSeed, data.profiles.slice().sort((x, y) => x.stage_number - y.stage_number), "orders_gc_v3").counts, a.summary.counts);
});
