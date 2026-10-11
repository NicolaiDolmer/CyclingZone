// backend/lib/engine/v4/mechanics/mountainSelection.test.ts
// #6084: kontrakt-tests for regel-revisionen orders_gc_v2's bjergselektion.
//   - Fasen: kun orders_gc_v2, kun bjergprofiler, "pre_final" foer finalestigningen.
//   - Selektionen (B): bloedere foer finalestigningen, uaendret i finalen.
//   - Tempo-neutraliseringen (A): kun dagens udbrud, kun foer finalestigningen.
//   - Laasen: legacy og orders_gc_v1 ser aldrig en fase; uden for bjerg er v2 = v1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  finalClimbStartIndex,
  mountainSelectionKnobsFor,
  mountainSelectionPhaseFor,
  phaseChaseClosingScale,
  phaseClimbNeutralShare,
  phaseLetGoMaxGapScale,
  phaseSplitThreshold,
  phaseWprimeForcedMinSeverity,
} from "./mountainSelection.ts";
import { climbSelectionHook, climbSeverity01 } from "./climbSelection.ts";
import { CLIMB_SELECTION_EXTRA_TUNING, MOUNTAIN_SELECTION_V2_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import { neutralizeBreakawayTempoDrift, runSegmentLoop, type GroupTempo } from "../segmentLoop.ts";
import { LIVE_MECHANIC_HOOKS, simulateStageV4 } from "../index.ts";
import type {
  AbilityKey,
  ClimbSegment,
  EngineState,
  Entrant,
  MechanicHooks,
  RaceGroup,
  RiderState,
  RouteV2,
  Segment,
  SegmentHookContext,
  StageInput,
} from "../types.ts";

// ── fasen ──────────────────────────────────────────────────────────────────

const seg = (kind: Segment["kind"]) => ({ kind });

test("finalestigningen er den sidste blok af sammenhaengende stigningssegmenter", () => {
  assert.equal(finalClimbStartIndex([seg("flat"), seg("climb"), seg("descent"), seg("climb"), seg("climb")]), 3);
  assert.equal(finalClimbStartIndex([seg("flat"), seg("climb"), seg("climb"), seg("descent"), seg("flat")]), 1);
  assert.equal(finalClimbStartIndex([seg("climb")]), 0);
  assert.equal(finalClimbStartIndex([seg("flat"), seg("rolling")]), -1);
  assert.equal(finalClimbStartIndex([]), -1);
});

test("fasen findes kun under orders_gc_v2 paa en bjerg- eller kuperet profil", () => {
  for (const rev of ["legacy", "orders_gc_v1"] as const) {
    for (const i of [0, 3, 5]) assert.equal(mountainSelectionPhaseFor(rev, "mountain", i, 3), undefined, `${rev} ${i}`);
  }
  for (const prof of ["flat", "rolling", "cobbles", "itt"] as const) {
    assert.equal(mountainSelectionPhaseFor("orders_gc_v2", prof, 0, 3), undefined, prof);
  }
  assert.equal(mountainSelectionPhaseFor("orders_gc_v2", "mountain", 2, -1), undefined, "ingen stigning, ingen fase");
  // #6092: kuperet er med.
  for (const prof of ["mountain", "high_mountain", "hilly"] as const) {
    assert.equal(mountainSelectionPhaseFor("orders_gc_v2", prof, 0, 3), "pre_final");
    assert.equal(mountainSelectionPhaseFor("orders_gc_v2", prof, 2, 3), "pre_final");
    assert.equal(mountainSelectionPhaseFor("orders_gc_v2", prof, 3, 3), "final");
    assert.equal(mountainSelectionPhaseFor("orders_gc_v2", prof, 5, 3), "final");
  }
});

test("selektion og tempo er neutrale uden fase og i finalen; M5 er kontrolleret foer og skarp i finalen", () => {
  const t = RACE_V4_TUNING.selection.splitThreshold;
  const s = CLIMB_SELECTION_EXTRA_TUNING.wprimeForcedMinSeverity;
  for (const phase of [undefined, "final"] as const) {
    assert.equal(phaseSplitThreshold(t, phase), t);
    assert.equal(phaseWprimeForcedMinSeverity(s, phase), s);
    assert.equal(phaseClimbNeutralShare(phase), 0);
  }
  assert.equal(phaseLetGoMaxGapScale(undefined), 1);
  assert.equal(phaseLetGoMaxGapScale("final"), MOUNTAIN_SELECTION_V2_TUNING.letGoMaxGapScale);
  assert.equal(phaseChaseClosingScale(undefined), 1);
  assert.ok(phaseChaseClosingScale("pre_final") < 1, "kontrolleret jagt foer finalestigningen");
  assert.ok(phaseChaseClosingScale("final") >= 1, "favoritternes hold jager paa finalestigningen");
  assert.ok(phaseSplitThreshold(t, "pre_final") > t, "hoejere split-taerskel foer finalestigningen");
  assert.ok(phaseWprimeForcedMinSeverity(s, "pre_final") > s, "W'-tvangen kun paa alvorlige stigninger foer finalestigningen");
  const share = phaseClimbNeutralShare("pre_final");
  assert.ok(share > 0 && share <= 1);
});

// ── #6092: profil-vise knapper ──────────────────────────────────────────────

test("#6092: knapperne er de faelles vaerdier med profilens afvigelser ovenpaa", () => {
  const t = MOUNTAIN_SELECTION_V2_TUNING;
  const shared = mountainSelectionKnobsFor("flat");
  assert.deepEqual(shared, {
    preFinalSplitThresholdFactor: t.preFinalSplitThresholdFactor,
    preFinalWprimeForcedMinSeverity: t.preFinalWprimeForcedMinSeverity,
    preFinalBreakawayDriftNeutralShare: t.preFinalBreakawayDriftNeutralShare,
    letGoMaxGapScale: t.letGoMaxGapScale,
    preFinalChaseClosingScale: t.preFinalChaseClosingScale,
    finalChaseClosingScale: t.finalChaseClosingScale,
  }, "en profil uden afvigelser faar de faelles vaerdier");
  for (const prof of t.profileTypes) {
    const k = mountainSelectionKnobsFor(prof);
    for (const [key, value] of Object.entries(t.byProfile[prof] ?? {})) assert.equal(k[key as keyof typeof k], value, `${prof}.${key}`);
    assert.ok(k.letGoMaxGapScale > 0 && k.letGoMaxGapScale <= 1, `${prof}: loftet skaleres ned, aldrig op`);
    assert.ok(k.preFinalChaseClosingScale > 0 && k.preFinalChaseClosingScale <= k.finalChaseClosingScale, `${prof}: jagten er hoejst lige saa skarp foer finalen som i finalen`);
  }
  // Kuperet: lavere lad-gaa-loft end bjergetaperne (kaptajnernes tidstab = udbruddets forspring).
  assert.ok(mountainSelectionKnobsFor("hilly").letGoMaxGapScale < mountainSelectionKnobsFor("mountain").letGoMaxGapScale);
});

// ── selektionen (B) ──────────────────────────────────────────────────────────

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  return {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
    ...overrides,
  };
}
function entrant(riderId: string, overrides: Partial<Record<AbilityKey, number>> = {}): Entrant {
  return { rider_id: riderId, abilities: abilities(overrides), role: "free_role", effort: "normal", condition: 1 };
}
function riderState(riderId: string, overrides: Partial<RiderState> = {}): RiderState {
  return {
    rider_id: riderId, group_id: "peloton-0", cp: 0.5, wprimeMax: 0.4, wprime: 0.4, dayform: 0,
    seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0, ...overrides,
  };
}
function climb(overrides: Partial<ClimbSegment> = {}): ClimbSegment {
  return { kind: "climb", from_km: 0, to_km: 3, category: "3", avg_gradient: 6, top_elevation_m: 800, ...overrides };
}
function route(segments: Segment[]): RouteV2 {
  return { distance_km: 100, profile_type: "mountain", finale_type: "long_climb", segments, weather: { kind: "sun", wind_exposure: 0.1 }, waypoints: [] };
}
function state(entrants: Entrant[], overrides: Record<string, Partial<RiderState>> = {}): EngineState {
  const riders: Record<string, RiderState> = {};
  for (const e of entrants) riders[e.rider_id] = riderState(e.rider_id, overrides[e.rider_id]);
  return {
    km: 0,
    groups: [{ id: "peloton-0", kind: "peloton", rider_ids: entrants.map((e) => e.rider_id), gap_seconds: 0, cohesion: 1 }],
    riders,
    virtual_gc: Object.fromEntries(entrants.map((e) => [e.rider_id, 0])),
  };
}
function ctx(entrants: Entrant[], segment: Segment, phase?: "pre_final" | "final"): SegmentHookContext {
  const base = makeHookCtx({
    segment, route: route([segment]), entrants: Object.fromEntries(entrants.map((e) => [e.rider_id, e])), tuning: RACE_V4_TUNING, seed: "6084",
  });
  return phase ? { ...base, mountainSelectionPhase: phase } : base;
}
const splitIds = (s: EngineState) => new Set(s.groups.filter((g) => g.id !== "peloton-0").flatMap((g) => g.rider_ids));

test("B: en tom reserve tvinger ikke rytteren af paa en mellemstigning foer finalestigningen, men goer i finalen", () => {
  const entrants = [entrant("a"), entrant("b"), entrant("c")];
  const segment = climb();
  const severity = climbSeverity01(segment.avg_gradient, segment.to_km - segment.from_km);
  // Forudsaetning: stigningen er alvorlig nok til tvang i dag, men under taersklen foer finalen.
  assert.ok(severity >= CLIMB_SELECTION_EXTRA_TUNING.wprimeForcedMinSeverity);
  assert.ok(severity < MOUNTAIN_SELECTION_V2_TUNING.preFinalWprimeForcedMinSeverity);
  const s = state(entrants, { c: { wprime: 0 } });

  assert.ok(splitIds(climbSelectionHook(s, ctx(entrants, segment)).state).has("c"), "uden fase: tvunget af (uaendret)");
  assert.ok(splitIds(climbSelectionHook(s, ctx(entrants, segment, "final")).state).has("c"), "i finalen: tvunget af");
  assert.equal(splitIds(climbSelectionHook(s, ctx(entrants, segment, "pre_final")).state).size, 0, "foer finalen: haenger paa");
});

test("B: en alvorlig stigning foer finalestigningen tvinger stadig en tom reserve af", () => {
  const entrants = [entrant("a"), entrant("b"), entrant("c")];
  const segment = climb({ avg_gradient: 9, to_km: 12, category: "1" });
  assert.ok(climbSeverity01(9, 12) >= MOUNTAIN_SELECTION_V2_TUNING.preFinalWprimeForcedMinSeverity);
  const s = state(entrants, { c: { wprime: 0 } });
  assert.ok(splitIds(climbSelectionHook(s, ctx(entrants, segment, "pre_final")).state).has("c"));
});

test("B: et klatre-underskud over dagens taerskel splitter i finalen, men ikke foer finalestigningen", () => {
  // Fuld reserve: kun underskuddet mod gruppens bedste klatrer taeller.
  const entrants = [entrant("strong", { climbing: 90 }), entrant("mid", { climbing: 70 }), entrant("weak", { climbing: 45 })];
  const segment = climb({ avg_gradient: 7, to_km: 8, category: "2" });
  const s = state(entrants);
  const plain = splitIds(climbSelectionHook(s, ctx(entrants, segment)).state);
  const final = splitIds(climbSelectionHook(s, ctx(entrants, segment, "final")).state);
  const preFinal = splitIds(climbSelectionHook(s, ctx(entrants, segment, "pre_final")).state);
  assert.ok(plain.has("weak"), "forudsaetning: den svage klatrer saettes af i dag");
  assert.deepEqual([...final].sort(), [...plain].sort(), "finalestigningen er uaendret");
  assert.ok(preFinal.size < plain.size, "foer finalestigningen falder faerre fra");
});

// ── tempo-neutraliseringen (A) ──────────────────────────────────────────────

test("A: paa en stigning nulstilles driften kun for dagens udbrud og kun med en andel > 0", () => {
  const tempo = (dtSeconds: number): GroupTempo => ({ collectiveCp: 1, frontRiderIds: new Set(), cpByRider: new Map(), dtSeconds, effortTempoFactor: 1 });
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const groups: RaceGroup[] = [
    { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: ids("b", 6), gap_seconds: 0, cohesion: 1 },
    { id: "attack-0", kind: "breakaway", origin: "descent", rider_ids: ids("a", 2), gap_seconds: 10, cohesion: 1 },
    { id: "chase-0", kind: "chase", rider_ids: ids("c", 3), gap_seconds: 200, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: ids("p", 60), gap_seconds: 120, cohesion: 1 },
  ];
  const input = new Map([["breakaway-0", tempo(1000)], ["attack-0", tempo(990)], ["chase-0", tempo(1010)], ["peloton-0", tempo(900)]]);

  // Udeladt / 0 = uaendret: en stigning beholder driften (samme Map).
  assert.strictEqual(neutralizeBreakawayTempoDrift(groups, input, "climb"), input);
  assert.strictEqual(neutralizeBreakawayTempoDrift(groups, input, "climb", 0), input);

  const full = neutralizeBreakawayTempoDrift(groups, input, "climb", 1);
  assert.equal(full.get("breakaway-0")!.dtSeconds, 900, "dagens udbrud koerer gap-maessigt i favoritgruppens tempo");
  assert.equal(full.get("attack-0")!.dtSeconds, 990, "et angreb beholder sin drift");
  assert.equal(full.get("chase-0")!.dtSeconds, 1010, "andre grupper er uroerte");
  assert.equal(full.get("peloton-0")!.dtSeconds, 900);
  assert.equal(input.get("breakaway-0")!.dtSeconds, 1000, "input muteres ikke");

  const half = neutralizeBreakawayTempoDrift(groups, input, "climb", 0.5);
  assert.equal(half.get("breakaway-0")!.dtSeconds, 950, "en andel nulstiller en del af driften");

  // Aabent terraen er uaendret af andelen.
  assert.equal(neutralizeBreakawayTempoDrift(groups, input, "flat", 0.5).get("breakaway-0")!.dtSeconds, 900);
  // Andre stigningstyper (brosten) roeres ikke af andelen.
  assert.strictEqual(neutralizeBreakawayTempoDrift(groups, input, "cobbles", 1), input);
});

// ── hele motoren: fasen naar kun hooksene under orders_gc_v2 ─────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "..", "fixtures");
function fixtureInput(name: string): StageInput {
  return JSON.parse(readFileSync(path.join(fixturesDir, name, "input.json"), "utf8")) as StageInput;
}

function phasesSeen(input: StageInput): Array<{ i: number; phase: string | undefined; rev: string | undefined }> {
  const seen: Array<{ i: number; phase: string | undefined; rev: string | undefined }> = [];
  const spy: MechanicHooks = {
    ...LIVE_MECHANIC_HOOKS,
    climbSelection: (s, c) => {
      seen.push({ i: c.segmentIndex, phase: c.mountainSelectionPhase, rev: c.rulesRevision });
      return LIVE_MECHANIC_HOOKS.climbSelection(s, c);
    },
  };
  runSegmentLoop(input, spy);
  return seen;
}

test("laas: legacy og orders_gc_v1 ser aldrig en fase; orders_gc_v2 ser v1-pakken plus fasen", () => {
  const input = fixtureInput("bjerg-selektion");
  assert.equal(input.route.profile_type, "mountain");
  const finalStart = finalClimbStartIndex(input.route.segments);
  for (const rules_revision of [undefined, "legacy", "orders_gc_v1"] as const) {
    const seen = phasesSeen({ ...input, ...(rules_revision ? { rules_revision } : {}) });
    assert.ok(seen.length > 0);
    assert.ok(seen.every((x) => x.phase === undefined), `${rules_revision}: ingen fase`);
  }
  const v2 = phasesSeen({ ...input, rules_revision: "orders_gc_v2" });
  assert.ok(v2.every((x) => x.rev === "orders_gc_v1"), "hooksene ser orders_gc_v1-pakken");
  for (const x of v2) assert.equal(x.phase, x.i < finalStart ? "pre_final" : "final");
  assert.ok(v2.some((x) => x.phase === "pre_final") && v2.some((x) => x.phase === "final"));
});

test("laas: uden for bjergprofilerne er orders_gc_v2 byte-identisk med orders_gc_v1", () => {
  for (const name of readdirSync(fixturesDir)) {
    const input = fixtureInput(name);
    if (MOUNTAIN_SELECTION_V2_TUNING.profileTypes.includes(input.route.profile_type)) continue;
    const gc = { status: "first_stage", stage_number: 1 } as unknown as StageInput["gc_context"];
    const v1 = simulateStageV4({ ...input, rules_revision: "orders_gc_v1", gc_context: gc });
    const v2 = simulateStageV4({ ...input, rules_revision: "orders_gc_v2", gc_context: gc });
    assert.equal(JSON.stringify(v2), JSON.stringify(v1), name);
  }
});

test("orders_gc_v2 er deterministisk paa en bjergetape", () => {
  const input = { ...fixtureInput("bjerg-selektion"), rules_revision: "orders_gc_v2" as const };
  assert.equal(JSON.stringify(simulateStageV4(input)), JSON.stringify(simulateStageV4(input)));
});

// ── #6441 (KUN official_times_v3): kuperet jager uden daempning foer finalen ──

test("#6441: under official_times_v3 jager kuperet fuldt foer finalen; bjerg/hoejfjeld og aeldre revisioner uaendrede", () => {
  assert.equal(mountainSelectionKnobsFor("hilly", true).preFinalChaseClosingScale, 1);
  assert.equal(mountainSelectionKnobsFor("hilly").preFinalChaseClosingScale, MOUNTAIN_SELECTION_V2_TUNING.preFinalChaseClosingScale);
  for (const prof of ["mountain", "high_mountain"] as const) {
    assert.deepEqual(mountainSelectionKnobsFor(prof, true), mountainSelectionKnobsFor(prof), prof);
  }
  const { preFinalChaseClosingScale: _a, ...hillyV3Rest } = mountainSelectionKnobsFor("hilly", true);
  const { preFinalChaseClosingScale: _b, ...hillyRest } = mountainSelectionKnobsFor("hilly");
  assert.deepEqual(hillyV3Rest, hillyRest, "kun jagten foer finalen aendres");
});
