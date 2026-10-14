// #6570 · ren logik bag etapeside 2.0.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  elevationSeries, elevationAt, gradeBand, colouredSegments, climbDetail, sortedClimbs,
  surfaceOf, dayDemands, defaultStage, stagePhase, shortName, formatGap, myBestByStage,
  yourDay, lineupFor, tacticsProgress, favouritesFor, winningMargin,
  type StageProfile, type ResultRow,
} from "./stagePageV2Model.ts";

const MOUNTAIN: StageProfile = {
  race_id: "r1", stage_number: 2, profile_type: "mountain", finale_type: "descent",
  distance_km: 20, elevation_gain_m: 700,
  climbs: [{ name: "Col A", category: "1", crest_km: 12, length_km: 6, avg_gradient: 7 }],
  sectors: [],
  demand_vector: { climbing: 0.5, endurance: 0.2, tempo: 0.15, recovery: 0.1, randomness: 0.05 },
};

// Rigtig serie: 0,5 km-skridt, flad til km 6, saa 6 km op til km 12, saa ned.
function withProfile(p: StageProfile): StageProfile {
  const h: number[] = [];
  for (let i = 0; i <= 40; i++) {
    const km = i * 0.5;
    if (km <= 6) h.push(300);
    else if (km <= 12) h.push(Math.round(300 + (km - 6) * 70 + (km > 10 ? (km - 10) * 30 : 0)));
    else h.push(Math.max(300, Math.round(780 - (km - 12) * 60)));
  }
  return { ...p, elevation_profile: { v: 1, step_km: 0.5, h } };
}

test("elevationSeries: bruger elevation_profile naar den findes, ellers syntesen", () => {
  const real = elevationSeries(withProfile(MOUNTAIN));
  assert.equal(real?.source, "profile");
  assert.equal(real?.kms.length, 41);
  assert.equal(real?.kms[40], 20);
  const synth = elevationSeries(MOUNTAIN);
  assert.equal(synth?.source, "synthetic");
  assert.equal(elevationSeries({ profile_type: "flat" }), null, "ingen distance = ingen rute");
});

test("elevationAt interpolerer lineaert", () => {
  const s = elevationSeries(withProfile(MOUNTAIN))!;
  assert.equal(elevationAt(s, 0), 300);
  assert.equal(elevationAt(s, 7), 370);
  assert.equal(elevationAt(s, 6.75), (elevationAt(s, 6.5) + elevationAt(s, 7)) / 2);
});

test("gradeBand: ned, flad og fire stigningsbaand", () => {
  assert.equal(gradeBand(-5), "down");
  assert.equal(gradeBand(1), "flat");
  assert.equal(gradeBand(4), 2);
  assert.equal(gradeBand(7), 3);
  assert.equal(gradeBand(9), 4);
  assert.equal(gradeBand(12), 5);
});

test("colouredSegments: et segment pr. skridt i den rigtige serie", () => {
  const segs = colouredSegments(elevationSeries(withProfile(MOUNTAIN))!);
  assert.equal(segs.length, 40);
  assert.equal(segs[0].band, "flat");
  assert.equal(segs[13].band, 3, "km 6,5-7 = 7 %");
  assert.ok(segs.some((s) => s.band === "down"));
});

test("climbDetail: km-for-km og noegletal kun med den rigtige serie", () => {
  const p = withProfile(MOUNTAIN);
  const c = sortedClimbs(p)[0];
  const d = climbDetail(p, elevationSeries(p), c);
  assert.equal(d.perKm.length, 6);
  assert.equal(d.startKm, 6);
  assert.equal(d.kmToGo, 8);
  assert.equal(d.steepest?.index, 5, "km 5 og 6 er stejlest (10 %); foerste vinder");
  assert.ok(Math.abs(d.steepest!.grade - 10) < 0.01);
  assert.ok(d.hardest5 !== null && d.hardest5 > 7);
  const synth = climbDetail(MOUNTAIN, elevationSeries(MOUNTAIN), c);
  assert.deepEqual(synth.perKm, [], "syntesen opdigter ingen km-for-km");
  assert.equal(synth.hardest5, null);
});

test("surfaceOf: kun naar der er sektorer (ikke asfalt)", () => {
  assert.equal(surfaceOf(MOUNTAIN), null);
  assert.deepEqual(surfaceOf({ sectors: [{ kind: "gravel", length_km: 2.5 }, { kind: "gravel", length_km: 1 }] }), { kind: "gravel", count: 2, km: 3.5 });
  assert.equal(surfaceOf({ sectors: [{ kind: "cobbles", length_km: 1 }] })?.kind, "cobbles");
});

test("dayDemands: rang i ord, uden randomness", () => {
  assert.deepEqual(dayDemands(MOUNTAIN.demand_vector), [
    { ability: "climbing", level: "decides" },
    { ability: "endurance", level: "matters" },
    { ability: "tempo", level: "matters" },
    { ability: "recovery", level: "helps" },
  ]);
  assert.deepEqual(dayDemands(null), []);
});

test("defaultStage: i dag (dansk tid), ellers senest koerte, ellers 1", () => {
  const schedule = [
    { stage_number: 1, scheduled_at: "2026-10-13T15:00:00Z" },
    { stage_number: 2, scheduled_at: "2026-10-14T15:00:00Z" },
    { stage_number: 3, scheduled_at: "2026-10-15T15:00:00Z" },
  ];
  assert.equal(defaultStage({ totalStages: 3, stagesCompleted: 1, schedule, now: new Date("2026-10-14T08:00:00Z") }), 2);
  // 23:30 UTC den 14. er den 15. i Koebenhavn.
  assert.equal(defaultStage({ totalStages: 3, stagesCompleted: 2, schedule, now: new Date("2026-10-14T23:30:00Z") }), 3);
  assert.equal(defaultStage({ totalStages: 3, stagesCompleted: 2, schedule, now: new Date("2026-10-20T08:00:00Z") }), 2);
  assert.equal(defaultStage({ totalStages: 3, stagesCompleted: 0, schedule: [], now: new Date("2026-10-14T08:00:00Z") }), 1);
});

test("stagePhase + navne + tidshuller", () => {
  assert.equal(stagePhase(2, 2), "after");
  assert.equal(stagePhase(3, 2), "before");
  assert.equal(shortName("Ada Pedersen"), "A. Pedersen");
  assert.equal(shortName("Ada"), "Ada");
  assert.equal(formatGap(92), "+1:32");
  assert.equal(formatGap(3725), "+1:02:05");
});

const MINE = "team-me";
const OTHER = "team-x";
function row(id: string, type: string, stage: number, rank: number, rider: string, team: string, gap: string): ResultRow {
  const [firstname, lastname] = rider.split(" ");
  return { id, result_type: type, stage_number: stage, rank, rider_id: `rid-${rider}`, team_id: team, finish_time: gap, rider: { firstname, lastname, nationality_code: "dk" } };
}
const RESULTS: ResultRow[] = [
  row("s1", "stage", 2, 1, "Carl Rojas", OTHER, "+0:00"),
  row("s2", "stage", 2, 2, "Luca Marchetti", OTHER, "+0:00"),
  row("s3", "stage", 2, 3, "Simon Kranjc", OTHER, "+0:24"),
  row("s6", "stage", 2, 6, "Ana Ibarra", MINE, "+1:10"),
  row("s40", "stage", 2, 40, "Mads Holm", MINE, "+6:12"),
  row("g1", "leader", 2, 1, "Carl Rojas", OTHER, "+0:00"),
  row("g2", "leader", 2, 2, "Luca Marchetti", OTHER, "+0:06"),
  row("g4", "leader", 2, 4, "Ana Ibarra", MINE, "+1:32"),
];

test("yourDay: top 3, dine ryttere uanset plads, din bedste i samlet + hul", () => {
  const d = yourDay(RESULTS, 2, MINE, "stage");
  assert.deepEqual(d.top3.map((r) => r.rank), [1, 2, 3]);
  assert.deepEqual(d.mine.map((r) => [r.rank, r.name]), [[6, "Ana Ibarra"], [40, "Mads Holm"]]);
  assert.deepEqual(d.bestOverall, { rank: 4, name: "Ana Ibarra", gapToLeader: "+1:32", leaderName: "Carl Rojas" });
  const gc = yourDay(RESULTS, 2, MINE, "gc");
  assert.deepEqual(gc.top3.map((r) => r.name), ["Carl Rojas", "Luca Marchetti", "Ana Ibarra"]);
  assert.equal(winningMargin(RESULTS, 2), 0);
});

test("myBestByStage: bedste egne placering pr. etape, navn fra egne ryttere", () => {
  const names = new Map([["rid-Ana", "Ana Ibarra"]]);
  const rows: ResultRow[] = [
    { result_type: "stage", stage_number: 1, rank: 9, rider_id: "rid-Ana", team_id: MINE },
    { result_type: "stage", stage_number: 1, rank: 2, rider_id: "rid-Ana", team_id: MINE },
    { result_type: "stage", stage_number: 1, rank: 1, rider_id: "rid-X", team_id: OTHER },
  ];
  assert.deepEqual(myBestByStage(rows, MINE, names), { 1: { rank: 2, name: "Ana Ibarra" } });
  assert.deepEqual(myBestByStage(rows, null, names), {});
});

test("lineupFor + tacticsProgress", () => {
  const riders = [
    { rider_id: "a", name: "Ana Ibarra", race_role: "captain", stage_fit: { "3": 88 } },
    { rider_id: "b", name: "Mads Holm", race_role: "helper", stage_fit: { "3": 61 } },
    { rider_id: "c", name: "Out Rider", race_role: "helper", abandoned: true },
  ];
  const overrides = [{ stage_number: 3, rider_id: "b", race_role: "hunter", effort: "protect" }];
  const l = lineupFor(riders, overrides, 3);
  assert.deepEqual(l.map((r) => [r.name, r.role, r.fit]), [["Ana Ibarra", "captain", 88], ["Mads Holm", "hunter", 61]]);
  assert.deepEqual(tacticsProgress(riders, [], 3), { done: 2, total: 3 });
  assert.equal(tacticsProgress([], [], 3).done, 0);
});

test("favouritesFor: fra loebet indtil nu; tom foer foerste etape", () => {
  assert.deepEqual(favouritesFor(RESULTS, [], 1, MINE, 0), []);
  const stageRows: ResultRow[] = [{ result_type: "stage", stage_number: 2, rank: 1, rider_id: "rid-Carl Rojas", team_id: OTHER }];
  const f = favouritesFor(RESULTS, stageRows, 3, MINE, 2);
  assert.equal(favouritesFor(RESULTS, stageRows, 4, MINE, 2)[0].name, "Carl Rojas", "etape 4 bruger det samlede efter etape 2 naar 3 ikke er koert");
  assert.equal(f[0].name, "Carl Rojas");
  assert.deepEqual(f[0].reasons.map((r) => r.key), ["leadsOverall", "wonStage"]);
  const mine = f.find((x) => x.mine);
  assert.equal(mine?.name, "Ana Ibarra");
});
