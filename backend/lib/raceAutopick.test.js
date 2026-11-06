import test from "node:test";
import assert from "node:assert/strict";
import { autopickTeamSelection, routeFitScorer, selectionSizeForRace, stageSuitabilityScores, suitabilityScore } from "./raceAutopick.js";
import { buildRouteMatch } from "./routeMatch.js";
import { riderSuitability } from "../../frontend/src/lib/suitability.js";

const ab = (over = {}) => ({
  climbing: 50, time_trial: 50, sprint: 50, punch: 50, endurance: 50,
  cobblestone: 50, acceleration: 50, recovery: 50, tactics: 50, positioning: 50,
  ...over,
});
const flatStage = { stage_number: 1, profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
const mtnStage = { stage_number: 2, profile_type: "mountain", demand_vector: { climbing: 0.9, endurance: 0.1, randomness: 0.4 } };
const riders = (n, f = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ rider_id: `r${String(i).padStart(2, "0")}`, abilities: ab(f(i)), fatigue: 0 }));

test("selectionSizeForRace: 8 (GT), 7 (WorldTour), 6 (øvrige), default 6-8 (ukendt klasse)", () => {
  assert.deepEqual(selectionSizeForRace({ race_class: "TourFrance" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "GiroVuelta" }), { min: 8, max: 8 });
  assert.deepEqual(selectionSizeForRace({ race_class: "Monuments" }), { min: 7, max: 7 });
  assert.deepEqual(selectionSizeForRace({ race_class: "OtherWorldTourA" }), { min: 7, max: 7 });
  assert.deepEqual(selectionSizeForRace({ race_class: "OtherWorldTourC" }), { min: 7, max: 7 });
  assert.deepEqual(selectionSizeForRace({ race_class: "ProSeries" }), { min: 6, max: 6 });
  assert.deepEqual(selectionSizeForRace({ race_class: "Class1" }), { min: 6, max: 6 });
  // Ukendt/manglende klasse → generøs default-fallback (uændret adfærd for legacy/test-løb).
  assert.deepEqual(selectionSizeForRace({ race_class: null }), { min: 6, max: 8 });
  assert.deepEqual(selectionSizeForRace({}), { min: 6, max: 8 });
});

test("autopick: vælger max-antal bedst egnede + kaptajn = mest egnede", () => {
  // r00 har klart bedst klatring → mest egnet til mountain-løbet.
  const pool = riders(15, (i) => ({ climbing: 90 - i * 3 }));
  const picks = autopickTeamSelection({ riders: pool, stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  assert.equal(picks.length, 8);
  const captain = picks.find((p) => p.race_role === "captain");
  assert.equal(captain.rider_id, "r00");
  assert.equal(picks.filter((p) => p.race_role === "captain").length, 1);
});

test("autopick: sprint_captain sættes når løbet har flade etaper og topsprinteren ikke er kaptajn", () => {
  const pool = riders(12, (i) => (i === 5 ? { sprint: 95 } : { climbing: 80 - i * 2 }));
  const picks = autopickTeamSelection({ riders: pool, stages: [flatStage, mtnStage], sizeRule: { min: 6, max: 8 } });
  const sprintCap = picks.find((p) => p.race_role === "sprint_captain");
  assert.ok(sprintCap, "sprint_captain skal sættes");
  assert.equal(sprintCap.rider_id, "r05");
});

test("autopick: lille trup → stiller alle; tom trup → tom liste; træthed nedprioriterer", () => {
  const small = autopickTeamSelection({ riders: riders(4), stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.equal(small.length, 4);
  assert.ok(small.some((p) => p.race_role === "captain"));
  assert.deepEqual(autopickTeamSelection({ riders: [], stages: [flatStage], sizeRule: { min: 6, max: 8 } }), []);

  const tired = riders(10, (_i) => ({ sprint: 70 }));
  tired[0].fatigue = 100; // ellers identisk med resten → skal fravælges først
  const picks = autopickTeamSelection({ riders: tired, stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.ok(!picks.some((p) => p.rider_id === "r00"), "udmattet rytter fravælges når ens alternativer findes");
});

test("autopick: fatigue-damping (0.3) er den afgørende faktor — udmattet topstjerne taber til frisk rival", () => {
  // Flat race: sprint 0.8, endurance 0.2. ABILITY_MAX = 99.
  // Tired star (sprint=90, fatigue=100):
  //   terrainScore ≈ (90/99)×0.8 + (50/99)×0.2 ≈ 0.6828
  //   freshness = 1 - (100/100)×0.3 = 0.7  → effective ≈ 0.4780
  // Fresh rivals (sprint=70, fatigue=0):
  //   terrainScore ≈ (70/99)×0.8 + (50/99)×0.2 ≈ 0.6667
  //   freshness = 1.0                         → effective ≈ 0.6667
  // 0.4780 < 0.6667 → star must drop out of top-8 (pool = 9, max=8)
  const freshRivals = riders(8, () => ({ sprint: 70 }));
  const tiredStar = { rider_id: "star", abilities: ab({ sprint: 90 }), fatigue: 100 };
  const pool = [tiredStar, ...freshRivals];

  // Variant A: tired star — should be excluded
  const picksWithFatigue = autopickTeamSelection({ riders: pool, stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.ok(!picksWithFatigue.some((p) => p.rider_id === "star"),
    "udmattet topstjerne (fatigue=100) skal ekskluderes fra top-8 når fresh rivals scorer højere");

  // Variant B (kontrol): same star with fatigue=0 — should be included and top scorer
  const freshStar = { rider_id: "star", abilities: ab({ sprint: 90 }), fatigue: 0 };
  const controlPool = [freshStar, ...freshRivals];
  const picksWithoutFatigue = autopickTeamSelection({ riders: controlPool, stages: [flatStage], sizeRule: { min: 6, max: 8 } });
  assert.ok(picksWithoutFatigue.some((p) => p.rider_id === "star"),
    "frisk topstjerne (fatigue=0) skal inkluderes — damping er den afgørende forskel");
});

test("autopick: all-flat løb → én kaptajn (bedste sprinter), sprint_captain=null", () => {
  // Kun flade etaper → gcStages() falder tilbage til alle stages (alle flat)
  // → captain = bedste på flat stages = bedste sprinter
  // → ingen separate non-flat stages → sprint_captain skal IKKE sættes
  const pool = [
    { rider_id: "best-sprinter", abilities: ab({ sprint: 95 }), fatigue: 0 },
    { rider_id: "mid-sprinter",  abilities: ab({ sprint: 75 }), fatigue: 0 },
    ...riders(6, () => ({ sprint: 60 })),
  ];
  const picks = autopickTeamSelection({ riders: pool, stages: [flatStage], sizeRule: { min: 6, max: 8 } });

  const captains = picks.filter((p) => p.race_role === "captain");
  const sprintCaptains = picks.filter((p) => p.race_role === "sprint_captain");

  assert.equal(captains.length, 1, "præcis én kaptajn");
  assert.equal(captains[0].rider_id, "best-sprinter", "kaptajn = bedste sprinter");
  assert.equal(sprintCaptains.length, 0, "sprint_captain = null/ingen når kaptajn allerede er bedste sprinter");
});

test("autopick: deterministisk uafhængigt af input-rækkefølge", () => {
  const pool = riders(20, (i) => ({ climbing: (i * 7) % 40 + 40 }));
  const a = autopickTeamSelection({ riders: pool, stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  const b = autopickTeamSelection({ riders: [...pool].reverse(), stages: [mtnStage], sizeRule: { min: 6, max: 8 } });
  assert.deepEqual(a, b);
});

// ── S3 præference-lag (Holdstrategi) ──────────────────────────────────────────
const abAll = (v) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
  flat: v, tempo: v, durability: v, aggression: v, descending: v,
});
const s3flat = { profile_type: "flat", demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
const s3mtn = { profile_type: "mountain", demand_vector: { climbing: 0.9, endurance: 0.1, randomness: 0.5 } };
// r0 stærkest → r5 svagest.
const s3riders = Array.from({ length: 6 }, (_, i) => ({ rider_id: `r${i}`, abilities: abAll(80 - i * 10), fatigue: 0 }));
const s3size = { min: 3, max: 3 };

test("S3 preference=null ≡ ingen preference (idempotens)", () => {
  const a = autopickTeamSelection({ riders: s3riders, stages: [s3flat], sizeRule: s3size });
  const b = autopickTeamSelection({ riders: s3riders, stages: [s3flat], sizeRule: s3size, preference: null });
  assert.deepEqual(a, b);
});

test("S3 mål-løb: A-kæde sorteres FØRST (rang), uanset score (Fork A)", () => {
  // r4,r5 er svagest, men A-kæde-rang 0,1 → de skal med på mål-løbet.
  const preference = { aChain: ["r5", "r4"], captains: [], roleRules: {}, isTargetRace: true };
  const picks = autopickTeamSelection({ riders: s3riders, stages: [s3flat], sizeRule: s3size, preference });
  const ids = picks.map((p) => p.rider_id);
  assert.ok(ids.includes("r5") && ids.includes("r4"), "A-kæde-ryttere udtaget på mål-løb");
});

test("S3 ikke-mål-løb: A-kæde giver INGEN boost (score-rækkefølge uændret)", () => {
  const preference = { aChain: ["r5", "r4"], captains: [], roleRules: {}, isTargetRace: false };
  const withPref = autopickTeamSelection({ riders: s3riders, stages: [s3flat], sizeRule: s3size, preference });
  const noPref = autopickTeamSelection({ riders: s3riders, stages: [s3flat], sizeRule: s3size });
  assert.deepEqual(withPref, noPref, "ikke-mål-løb uændret af A-kæde");
});

test("S3 rolle-regel always_captain vinder over score-baseret kaptajn", () => {
  const preference = { aChain: [], captains: [], roleRules: { r2: "always_captain" }, isTargetRace: false };
  const picks = autopickTeamSelection({ riders: s3riders, stages: [s3mtn], sizeRule: s3size, preference });
  assert.equal(picks.find((p) => p.race_role === "captain")?.rider_id, "r2");
});

test("S3 kaptajn-prioritet pr. terræn: første i listen der er udtaget bliver kaptajn", () => {
  // r9 ikke i trup → springes; r1 er i top-3 → kaptajn.
  const preference = { aChain: [], captains: ["r9", "r1"], roleRules: {}, isTargetRace: false };
  const picks = autopickTeamSelection({ riders: s3riders, stages: [s3mtn], sizeRule: s3size, preference });
  assert.equal(picks.find((p) => p.race_role === "captain")?.rider_id, "r1");
});

test("S3 kaptajn-fallback: ingen regel/prioritet matcher → GC-kaptajn (uændret)", () => {
  const preference = { aChain: [], captains: ["r9"], roleRules: {}, isTargetRace: false };
  const withPref = autopickTeamSelection({ riders: s3riders, stages: [s3mtn], sizeRule: s3size, preference });
  const noPref = autopickTeamSelection({ riders: s3riders, stages: [s3mtn], sizeRule: s3size });
  assert.equal(
    withPref.find((p) => p.race_role === "captain")?.rider_id,
    noPref.find((p) => p.race_role === "captain")?.rider_id
  );
});

test("S3 always_sprint_captain_if_present: udtaget + ikke kaptajn → sprint_captain", () => {
  const preference = { aChain: [], captains: ["r0"], roleRules: { r1: "always_sprint_captain_if_present" }, isTargetRace: false };
  const picks = autopickTeamSelection({ riders: s3riders, stages: [s3flat], sizeRule: s3size, preference });
  assert.equal(picks.find((p) => p.race_role === "sprint_captain")?.rider_id, "r1");
});

test("S3 stale A-kæde-id (ikke i trup) ignoreres tavst", () => {
  const preference = { aChain: ["ghost", "r0"], captains: [], roleRules: {}, isTargetRace: true };
  const picks = autopickTeamSelection({ riders: s3riders, stages: [s3flat], sizeRule: s3size, preference });
  assert.ok(!picks.some((p) => p.rider_id === "ghost"));
  assert.ok(picks.some((p) => p.rider_id === "r0"));
});

test("S3 determinisme: to kørsler med samme input giver identisk output", () => {
  const preference = { aChain: ["r3", "r1"], captains: ["r1"], roleRules: { r2: "always_captain" }, isTargetRace: true };
  const a = autopickTeamSelection({ riders: s3riders, stages: [s3mtn], sizeRule: s3size, preference });
  const b = autopickTeamSelection({ riders: s3riders, stages: [s3mtn], sizeRule: s3size, preference });
  assert.deepEqual(a, b);
});

// S4: per-etape suitability til rute-match på løbs-detaljen.
test("stageSuitabilityScores: ét 0-100-tal pr. etape", () => {
  const climber = ab({ climbing: 90, sprint: 20 });
  const perStage = stageSuitabilityScores(climber, [flatStage, mtnStage]);
  assert.equal(perStage.length, 2);
  // Klatrer scorer højere på bjerg-etapen end på flad.
  assert.ok(perStage[1] > perStage[0]);
});

test("stageSuitabilityScores: tom stages → tom liste; manglende demand_vector → 0", () => {
  assert.deepEqual(stageSuitabilityScores(ab(), []), []);
  assert.deepEqual(stageSuitabilityScores(ab(), [{ stage_number: 1 }]), [0]);
});

// #6207: assistenten rangerer på det tal manageren ser i sæsonmatrix og Planlæg dag.
const notStarted = { status: "scheduled", stages_completed: 0, engine_rules_revision: null };
const ittStage = {
  race_id: "race-itt", stage_number: 1, profile_type: "itt", finale_type: "solo_tt", distance_km: 30,
  demand_vector: { time_trial: 0.3, positioning: 0.7 },
  segments: [{ kind: "flat", from_km: 0, to_km: 30 }],
};
const roadStage = {
  race_id: "race-itt", stage_number: 2, profile_type: "mountain", finale_type: "long_climb", distance_km: 150,
  demand_vector: { climbing: 0.7, endurance: 0.2, randomness: 0.1 },
  segments: [{ kind: "rolling", from_km: 0, to_km: 140 }, { kind: "climb", from_km: 140, to_km: 150, category: "1", avg_gradient: 8 }],
};

test("suitabilityScore #6207: præcis det viste rutematch-tal, på et etapeløb", () => {
  const rider = ab({ climbing: 80, time_trial: 40, endurance: 60 });
  const stages = [ittStage, roadStage];
  const shown = buildRouteMatch({ race: notStarted, stages });
  assert.equal(Math.round(suitabilityScore(rider, stages)), shown.race(rider));
  assert.equal(Math.round(suitabilityScore(rider, stages)), riderSuitability(rider, shown.raceVector).score);
});

test("autopick #6207: tager rytteren med det højeste viste tal, ikke den gemte vægtliste", () => {
  // Den gemte vægtliste vægter positionering tungest; motoren afgør enkeltstarten på tidskørsel.
  const positioner = { rider_id: "a-positioner", abilities: ab({ positioning: 90, time_trial: 30 }), fatigue: 0 };
  const timeTrialist = { rider_id: "b-tidskoerer", abilities: ab({ positioning: 30, time_trial: 70 }), fatigue: 0 };
  const shown = buildRouteMatch({ race: notStarted, stages: [ittStage] });
  assert.ok(shown.race(timeTrialist.abilities) > shown.race(positioner.abilities));
  const picks = autopickTeamSelection({ riders: [positioner, timeTrialist], stages: [ittStage], sizeRule: { min: 1, max: 1 } });
  assert.deepEqual(picks.map((p) => p.rider_id), ["b-tidskoerer"]);
});

test("routeFitScorer #6207: ingen etaper → 0, aldrig et opfundet tal", () => {
  assert.equal(routeFitScorer([])(ab()), 0);
  assert.equal(routeFitScorer(undefined)(ab()), 0);
  assert.equal(suitabilityScore(ab(), [{ stage_number: 1 }]), 0);
});
