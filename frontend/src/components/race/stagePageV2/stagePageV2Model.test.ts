// #6570 · ren logik bag etapeside 2.0.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  elevationSeries, elevationAt, gradeBand, colouredSegments, climbDetail, sortedClimbs,
  surfaceOf, dayDemands, defaultStage, stagePhase, shortName, formatGap, myBestByStage,
  yourDay, DAY_TOP_COUNT, lineupFor, tacticsProgress, favouritesFor, winningMargin, tacticsStartStage, todaysStage, todaysStages,
  activeRiders, profileScale, favouriteTerrain, perKmGradeCeil, PER_KM_GRADE_CEIL_PCT,
  type StageProfile, type ResultRow,
} from "./stagePageV2Model.ts";
import { elevationScaleFor, buildProfileSeries } from "../../../lib/stageRouteProfile.js";
import { PROFILE_TYPE_KEYS } from "../../../lib/stageProfileConfig.js";

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

test("todaysStages: alle dagens etaper faar 'I dag' (Danmark Rundt 24/10: etape 2 og 3 samme dato)", () => {
  const schedule = [
    { stage_number: 1, scheduled_at: "2026-10-23T16:00:00Z" },
    { stage_number: 2, scheduled_at: "2026-10-24T10:00:00Z" },
    { stage_number: 3, scheduled_at: "2026-10-24T14:00:00Z" },
    { stage_number: 4, scheduled_at: "2026-10-25T11:00:00Z" },
  ];
  assert.deepEqual(todaysStages({ totalStages: 4, schedule, now: new Date("2026-10-24T14:30:00Z") }), [2, 3]);
  assert.deepEqual(todaysStages({ totalStages: 4, schedule, now: new Date("2026-10-26T08:00:00Z") }), []);
});

test("todaysStage: kun en etape der koeres i dag, aldrig fallbacken", () => {
  const schedule = [
    { stage_number: 1, scheduled_at: "2026-05-09T13:00:00Z" },
    { stage_number: 2, scheduled_at: "2026-05-10T13:00:00Z" },
  ];
  assert.equal(todaysStage({ totalStages: 2, schedule, now: new Date("2026-05-10T08:00:00Z") }), 2);
  // Afsluttet loeb: defaultStage lander paa den senest koerte, men den er ikke "i dag".
  const now = new Date("2026-06-24T16:00:00Z");
  assert.equal(todaysStage({ totalStages: 2, schedule, now }), null);
  assert.equal(defaultStage({ totalStages: 2, stagesCompleted: 2, schedule, now }), 2);
});

test("tacticsStartStage: guld-knappens etape naar den er aaben, ellers dagens regel", () => {
  const stages = [
    { stage_number: 5, locked: true },
    { stage_number: 6, locked: false },
    { stage_number: 7, locked: false },
  ];
  // Knappen naevner etape 7, mens 6 er den foerste aabne: 7 vinder.
  assert.equal(tacticsStartStage(stages, 7), 7);
  // Ingen etape naevnt, laast etape eller ukendt etape: foerste aabne.
  assert.equal(tacticsStartStage(stages, null), 6);
  assert.equal(tacticsStartStage(stages, 5), 6);
  assert.equal(tacticsStartStage(stages, 9), 6);
  // Alt laast: sidste etape read-only (firstOpenStage).
  assert.equal(tacticsStartStage([{ stage_number: 1, locked: true }, { stage_number: 2, locked: true }], 2), 2);
  assert.equal(tacticsStartStage([], 3), null);
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
  row("s4", "stage", 2, 4, "Pavel Novak", OTHER, "+0:31"),
  row("s5", "stage", 2, 5, "Jonas Berg", OTHER, "+0:44"),
  row("s6", "stage", 2, 6, "Ana Ibarra", MINE, "+1:10"),
  row("s40", "stage", 2, 40, "Mads Holm", MINE, "+6:12"),
  row("g1", "leader", 2, 1, "Carl Rojas", OTHER, "+0:00"),
  row("g2", "leader", 2, 2, "Luca Marchetti", OTHER, "+0:06"),
  row("g4", "leader", 2, 4, "Ana Ibarra", MINE, "+1:32"),
];

test("yourDay: top 5, dine ryttere uanset plads, din bedste i samlet + hul", () => {
  const d = yourDay(RESULTS, 2, MINE, "stage");
  assert.equal(DAY_TOP_COUNT, 5);
  assert.deepEqual(d.top.map((r) => r.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(d.mine.map((r) => [r.rank, r.name]), [[6, "Ana Ibarra"], [40, "Mads Holm"]]);
  assert.deepEqual(d.bestOverall, { rank: 4, name: "Ana Ibarra", gapToLeader: "+1:32", leaderName: "Carl Rojas" });
  const gc = yourDay(RESULTS, 2, MINE, "gc");
  assert.deepEqual(gc.top.map((r) => r.name), ["Carl Rojas", "Luca Marchetti", "Ana Ibarra"]);
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

test("tacticsProgress: regnes fra den aktive opstilling for maaletapen", () => {
  // Udgaaet kaptajn taeller ikke som "kaptajn sat".
  const abandonedCaptain = [
    { rider_id: "a", name: "Ana Ibarra", race_role: "captain", abandoned: true },
    { rider_id: "b", name: "Mads Holm", race_role: "helper" },
  ];
  assert.deepEqual(tacticsProgress(abandonedCaptain, [], 3), { done: 1, total: 3 });
  // Kaptajn sat via etapens override taeller, men kun for netop den etape.
  const promote = [{ stage_number: 3, rider_id: "b", race_role: "captain" }];
  assert.deepEqual(tacticsProgress(abandonedCaptain, promote, 3), { done: 2, total: 3 });
  assert.deepEqual(tacticsProgress(abandonedCaptain, promote, 4), { done: 1, total: 3 });
  // En override der fratager basis-kaptajnen rollen paa etapen, fjerner fluebenet.
  const base = [{ rider_id: "a", name: "Ana Ibarra", race_role: "captain" }];
  assert.equal(tacticsProgress(base, [{ stage_number: 3, rider_id: "a", race_role: "helper" }], 3).done, 1);
  // Kun udgaaede ryttere: intet hold, og en udgaaet rytters intention taeller ikke.
  const allOut = [{ rider_id: "a", name: "Ana Ibarra", race_role: "captain", abandoned: true }];
  assert.deepEqual(tacticsProgress(allOut, [{ stage_number: 3, rider_id: "a", effort: "protect" }], 3), { done: 0, total: 3 });
  // Intention fra en aktiv rytter paa maaletapen taeller.
  assert.deepEqual(tacticsProgress(base, [{ stage_number: 3, rider_id: "a", effort: "protect" }], 3), { done: 3, total: 3 });
  assert.deepEqual(activeRiders(abandonedCaptain).map((r) => r.rider_id), ["b"]);
});

test("profileScale: fast terraenskala pr. profile_type, aldrig etapens egen top", () => {
  const flatA = elevationSeries({ ...MOUNTAIN, profile_type: "flat", climbs: [], elevation_profile: { v: 1, step_km: 0.5, h: [100, 120, 110] } })!;
  const flatB = elevationSeries({ ...MOUNTAIN, profile_type: "flat", climbs: [], elevation_profile: { v: 1, step_km: 0.5, h: [100, 400, 110] } })!;
  // To flade etaper med forskellig top deler loft = elevationScaleFor("flat") (genbrugt, ikke kopieret).
  assert.deepEqual(profileScale({ profile_type: "flat" }, flatA), { floor: 0, ceil: elevationScaleFor("flat") });
  assert.deepEqual(profileScale({ profile_type: "flat" }, flatB), { floor: 0, ceil: elevationScaleFor("flat") });
  // Bjerg og flad faar forskelligt loft: samme hoejde fylder mindre paa bjergskalaen.
  assert.equal(profileScale({ profile_type: "mountain" }, flatA).ceil, elevationScaleFor("mountain"));
  assert.equal(profileScale({ profile_type: "high_mountain" }, flatA).ceil, elevationScaleFor("high_mountain"));
  // Ukendt type: samme fallback som elevationScaleFor.
  assert.equal(profileScale({ profile_type: "nope" }, flatA).ceil, elevationScaleFor("nope"));
  // Outlier over loftet udvider loftet (rundet op til 100 m) i stedet for at klippe kurven.
  const outlier = elevationSeries({ ...MOUNTAIN, profile_type: "flat", climbs: [], elevation_profile: { v: 1, step_km: 0.5, h: [100, elevationScaleFor("flat") + 37, 110] } })!;
  assert.equal(profileScale({ profile_type: "flat" }, outlier).ceil, Math.ceil((elevationScaleFor("flat") + 37) / 100) * 100);
});

test("perKmGradeCeil: fast procentloft, kun en outlier udvider det", () => {
  const km = (grade: number) => ({ index: 1, grade, band: gradeBand(grade), fraction: 1 });
  assert.equal(perKmGradeCeil([km(3), km(4)]), PER_KM_GRADE_CEIL_PCT);
  assert.equal(perKmGradeCeil([km(9), km(11.5)]), PER_KM_GRADE_CEIL_PCT);
  assert.equal(perKmGradeCeil([km(14.2)]), 15);
  assert.equal(perKmGradeCeil([]), PER_KM_GRADE_CEIL_PCT);
});


// ── favouritesFor (#6939): efter etapens profil ────────────────────────────
// Loeb: etape 1 flad, 2 bjerg, 3 flad, 4 kuperet, 5 flad (maalet), 6 bjerg, 7 enkeltstart.
const PROFILES = {
  1: { profile_type: "flat" }, 2: { profile_type: "mountain" }, 3: { profile_type: "rolling" },
  4: { profile_type: "hilly" }, 5: { profile_type: "flat" }, 6: { profile_type: "high_mountain" }, 7: { profile_type: "itt" },
};
const NAMES = ["Climber One", "Climber Two", "Climber Three", "Allround Four", "Sprinter Five", "Sprinter Six", "Sprinter Seven", "Domestique Eight"];
// Samlet efter etape 4: bjergmaend foran, sprintere bag.
const GC_AFTER_4: ResultRow[] = NAMES.map((n, i) => row(`g${i}`, "leader", 4, i + 1, n, i === 4 ? MINE : OTHER, `+${i}:00`));
const stageRow = (stage: number, rank: number, rider: string): ResultRow => ({ ...row(`s${stage}-${rank}`, "stage", stage, rank, rider, OTHER, "+0:00") });
const STAGES: ResultRow[] = [
  stageRow(1, 1, "Sprinter Six"), stageRow(1, 2, "Sprinter Five"), stageRow(1, 3, "Sprinter Seven"),
  stageRow(2, 1, "Climber One"), stageRow(2, 2, "Climber Two"), stageRow(2, 3, "Climber Three"), stageRow(2, 4, "Sprinter Five"),
  stageRow(3, 1, "Sprinter Five"), stageRow(3, 2, "Sprinter Six"), stageRow(3, 3, "Allround Four"),
  stageRow(4, 1, "Allround Four"), stageRow(4, 2, "Climber One"),
];
const ids = (f: ReturnType<typeof favouritesFor>) => f.map((x) => x.name);

test("favouriteTerrain: hver kendt profiltype (ogsaa S5 medium_mountain) har en terraenfamilie", () => {
  for (const k of PROFILE_TYPE_KEYS) assert.notEqual(favouriteTerrain(k), null, k);
  assert.equal(favouriteTerrain("medium_mountain"), "hilly");
  assert.equal(favouriteTerrain("nope"), null);
});

test("favouritesFor: tom foer foerste etape og ved ukendt profil", () => {
  assert.deepEqual(favouritesFor(GC_AFTER_4, [], 1, MINE, 0, PROFILES), []);
  assert.deepEqual(favouritesFor(GC_AFTER_4, STAGES, 5, MINE, 4, {}), [], "ingen profil = intet aerligt grundlag");
  assert.deepEqual(favouritesFor(GC_AFTER_4, STAGES, 5, MINE, 4, { 5: { profile_type: null } }), []);
});

test("favouritesFor: flad etape vaelger efter placeringer paa flade etaper, ikke klassementet", () => {
  const f = favouritesFor(GC_AFTER_4, STAGES, 5, MINE, 4, PROFILES);
  // Flade etaper foer 5: 1 og 3 (rolling). Score 11-placering: Five 9+10, Six 10+9, Seven 8, Four 8 (3. paa etape 3).
  assert.deepEqual(ids(f).slice(0, 2).sort(), ["Sprinter Five", "Sprinter Six"]);
  assert.deepEqual(ids(f).slice(0, 4).sort(), ["Allround Four", "Sprinter Five", "Sprinter Seven", "Sprinter Six"], "de fire foerste er dem med flad form");
  assert.ok(ids(f).indexOf("Climber One") >= 4, "bjergmand kun som fyld af samlet");
  assert.equal(f.length, 5);
  const five = f.find((x) => x.name === "Sprinter Five")!;
  assert.equal(five.mine, true);
  assert.deepEqual(five.reasons.map((r) => r.key), ["overall", "wonStage", "placed.flat"]);
  assert.deepEqual(five.reasons.find((r) => r.key === "placed.flat")!.params, { count: 2 });
  assert.deepEqual(five.reasons.find((r) => r.key === "wonStage")!.params, { number: 3 });
});

test("favouritesFor: bjergetape tager det samlede foerst, saa de bedste paa bjerg", () => {
  const f = favouritesFor(GC_AFTER_4, STAGES, 6, MINE, 4, PROFILES);
  assert.deepEqual(ids(f).slice(0, 3), ["Climber One", "Climber Two", "Climber Three"]);
  assert.equal(f[0].reasons[0].key, "leadsOverall");
  assert.equal(f.length, 5);
});

test("favouritesFor: enkeltstart uden tidligere enkeltstarter fylder op af det samlede", () => {
  const f = favouritesFor(GC_AFTER_4, STAGES, 7, MINE, 4, PROFILES);
  assert.deepEqual(ids(f), NAMES.slice(0, 5));
});

test("favouritesFor: kuperet er en blanding af samlet og terraenform", () => {
  const f = favouritesFor(GC_AFTER_4, STAGES, 8, MINE, 4, { ...PROFILES, 8: { profile_type: "hilly" } });
  assert.deepEqual(ids(f).slice(0, 3), ["Climber One", "Climber Two", "Allround Four"], "to fra samlet, saa kuperet form");
  assert.equal(f.length, 5);
});

test("favouritesFor: etape efter seneste koerte bruger formen indtil den senest koerte", () => {
  const f = favouritesFor(GC_AFTER_4, STAGES, 6, MINE, 4, PROFILES);
  const g = favouritesFor(GC_AFTER_4, STAGES, 9, MINE, 4, { ...PROFILES, 9: { profile_type: "mountain" } });
  assert.deepEqual(ids(g), ids(f), "etape 9 ligger efter 5 og 6 der ikke er koert endnu: samme grundlag");
});

test("favouritesFor: kun offentlige data (ingen route fit/evner i resultatet)", () => {
  const f = favouritesFor(GC_AFTER_4, STAGES, 5, MINE, 4, PROFILES);
  for (const fav of f) assert.deepEqual(Object.keys(fav).sort(), ["mine", "name", "nation", "reasons", "riderId"]);
});

// #7289: Hold-fanen (StageProfileGraph) og Etaper-fanen (elevationSeries) tegner SAMME serie for samme etape.
test("#7289: elevationSeries og buildProfileSeries giver samme serie for samme etape", () => {
  const real = withProfile(MOUNTAIN);
  for (const p of [real, MOUNTAIN]) {
    const stage = elevationSeries(p)!;
    const graph = buildProfileSeries(p)!;
    assert.deepEqual(stage.kms, graph.xs);
    assert.deepEqual(stage.hs, graph.ys);
    assert.equal(stage.source, graph.source);
  }
  assert.equal(buildProfileSeries(real)!.source, "profile");
  assert.equal(buildProfileSeries(MOUNTAIN)!.source, "synthetic");
});

test("#7289: alle tegne-flader hentes fra buildProfileSeries, ingen egen hoejdeserie", async () => {
  const { readFileSync } = await import("node:fs");
  const here = new URL("../", import.meta.url);
  const src = (rel: string) => readFileSync(new URL(rel, here), "utf8");
  assert.match(src("StageProfileGraph.jsx"), /buildProfileSeries\(profile\)/);
  assert.match(src("stagePageV2/stagePageV2Model.ts"), /buildProfileSeries\(profile\)/);
  assert.doesNotMatch(src("stagePageV2/stagePageV2Model.ts"), /ep\.h\.map/);
  for (const f of ["RaceStageProfileRow.jsx", "StageStripe.jsx"]) assert.match(src(f), /StageProfileGraph/);
});
