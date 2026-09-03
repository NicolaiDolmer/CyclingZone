// backend/lib/engine/v4/mechanics/incidents.test.ts
// Kontrakt- + property-tests for M10 (incidents med km-maerke + 3 km-reglen).
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M10 + §8 beslutning 8. F2-kerne: 2026-08-21-race-engine-v4-f2-core-design.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  applyThreeKmRuleToResults,
  collectThreeKmRuleProtectedRiderIds,
  createIncidentHook,
  incidentHook,
  incidentProbability,
  isFlatStageForThreeKmRule,
  isWithinThreeKmWindow,
  threeKmRuleApplies,
} from "./incidents.ts";
import { boundRngFor } from "../rng.ts";
import { INCIDENTS_EXTRA_TUNING } from "../tuning.ts";
import type {
  AbilityKey,
  Entrant,
  EngineState,
  FlatSegment,
  ProfileType,
  RaceGroup,
  RiderState,
  RouteV2,
  Segment,
  SegmentHookContext,
  StageResult,
  TimelineEvent,
} from "../types.ts";

// ── Fixtures (samme moenster som descent.test.ts) ──────────────────────────

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const base: Record<AbilityKey, number> = {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
  };
  return { ...base, ...overrides };
}

function makeEntrant(riderId: string, positioning = 50): Entrant {
  return { rider_id: riderId, abilities: abilities({ positioning }), role: "free_role", effort: "normal", condition: 1 };
}

function makeRiderState(riderId: string, groupId: string, overrides: Partial<RiderState> = {}): RiderState {
  return {
    rider_id: riderId,
    group_id: groupId,
    cp: 0.5,
    wprimeMax: 0.4,
    wprime: 0.4,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: "racing",
    time_seconds: 0,
    ...overrides,
  };
}

function flatSegment(fromKm: number, toKm: number): FlatSegment {
  return { kind: "flat", from_km: fromKm, to_km: toKm };
}

function makeRoute(profileType: ProfileType, distanceKm: number, segments: Segment[] = []): RouteV2 {
  return {
    distance_km: distanceKm,
    profile_type: profileType,
    finale_type: null,
    segments,
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [],
  };
}

/** Bygger state+ctx for én gruppe med (riderId, positioning)-par. */
function buildSingleGroupScenario(
  pairs: Array<[string, number]>,
  segment: Segment,
  route: RouteV2,
  seed = "incident-seed",
  riderOverrides: Record<string, Partial<RiderState>> = {},
): { state: EngineState; ctx: SegmentHookContext } {
  const entrantsById: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  const riderIds = pairs.map(([id]) => id);
  for (const [id, positioning] of pairs) {
    entrantsById[id] = makeEntrant(id, positioning);
    riders[id] = makeRiderState(id, "peloton-0", riderOverrides[id]);
  }
  const group: RaceGroup = { id: "peloton-0", kind: "peloton", rider_ids: riderIds, gap_seconds: 0, cohesion: 1 };
  const state: EngineState = { km: segment.from_km, groups: [group], riders, virtual_gc: {} };
  const ctx: SegmentHookContext = {
    segment,
    segmentIndex: 2,
    route,
    entrants: entrantsById,
    tuning: {} as SegmentHookContext["tuning"], // incidentHook laeser IKKE ctx.tuning (INCIDENTS_EXTRA_TUNING er additiv)
    rngFor: boundRngFor(seed),
    orders: [],
  };
  return { state, ctx };
}

function findGroupOf(groups: RaceGroup[], riderId: string): RaceGroup | undefined {
  return groups.find((g) => g.rider_ids.includes(riderId));
}

function eventsOfType(events: TimelineEvent[], type: string): TimelineEvent[] {
  return events.filter((e) => e.type === type);
}

// Rigget tuning: risiko=1 for én bestemt segment-kind gør styrt deterministisk
// for ALLE ryttere i det segment (positioningDampening=0 saa evnen ikke redder nogen).
function alwaysCrashTuning(overrides: Partial<typeof INCIDENTS_EXTRA_TUNING> = {}): typeof INCIDENTS_EXTRA_TUNING {
  return {
    ...INCIDENTS_EXTRA_TUNING,
    baseRiskPerSegment: { flat: 1, rolling: 1, climb: 1, descent: 1, cobbles: 1 },
    positioningDampening: 0,
    ...overrides,
  };
}

function neverCrashTuning(): typeof INCIDENTS_EXTRA_TUNING {
  return { ...INCIDENTS_EXTRA_TUNING, baseRiskPerSegment: { flat: 0, rolling: 0, climb: 0, descent: 0, cobbles: 0 } };
}

// ── incidentProbability: monotoni + clamp (samme disciplin som descent.ts) ──

test("incidentProbability: daempes monotont af positioning-evnen, aldrig omvendt fortegn, clamped [0,1]", () => {
  let prev = incidentProbability(0, "cobbles", INCIDENTS_EXTRA_TUNING);
  assert.ok(prev >= 0 && prev <= 1);
  for (let ability = 1; ability <= 99; ability += 1) {
    const p = incidentProbability(ability, "cobbles", INCIDENTS_EXTRA_TUNING);
    assert.ok(p >= 0 && p <= 1, `p=${p} uden for [0,1] ved ability=${ability}`);
    assert.ok(p <= prev + 1e-12, `risiko steg ved ability=${ability} (${p} > ${prev}) — omvendt fortegn`);
    prev = p;
  }
});

test("incidentProbability: fast-check — altid i [0,1], aldrig stigende med evnen (200 runs)", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("flat", "rolling", "climb", "descent", "cobbles" as const),
      fc.integer({ min: 0, max: 99 }),
      fc.integer({ min: 0, max: 99 }),
      (kind, a, b) => {
        const lower = Math.min(a, b);
        const higher = Math.max(a, b);
        const pLower = incidentProbability(lower, kind, INCIDENTS_EXTRA_TUNING);
        const pHigher = incidentProbability(higher, kind, INCIDENTS_EXTRA_TUNING);
        assert.ok(pLower >= 0 && pLower <= 1);
        assert.ok(pHigher >= 0 && pHigher <= 1);
        assert.ok(pHigher <= pLower + 1e-9, "hoejere positioning-evne maa aldrig give hoejere risiko");
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

test("incidentProbability: cobbles har hoejere basis-risiko end climb (samme evne)", () => {
  const pCobbles = incidentProbability(50, "cobbles", INCIDENTS_EXTRA_TUNING);
  const pClimb = incidentProbability(50, "climb", INCIDENTS_EXTRA_TUNING);
  assert.ok(pCobbles > pClimb);
});

// ── 3 km-reglens rene helpers (mor-spec §8 beslutning 8) ────────────────────

test("isFlatStageForThreeKmRule: flat/rolling/cobbles/classic er flade, mountain/high_mountain/hilly/itt er ikke", () => {
  const tuning = INCIDENTS_EXTRA_TUNING;
  for (const flat of ["flat", "rolling", "cobbles", "classic"] as ProfileType[]) {
    assert.ok(isFlatStageForThreeKmRule(flat, tuning), `${flat} skal vaere flad`);
  }
  for (const mountainish of ["mountain", "high_mountain", "hilly", "itt", "itt_hilly", "ttt"] as ProfileType[]) {
    assert.ok(!isFlatStageForThreeKmRule(mountainish, tuning), `${mountainish} skal IKKE vaere flad`);
  }
});

test("isWithinThreeKmWindow: grænsen er inklusiv ved praecis vinduestaerskel, ekskl. lige udenfor", () => {
  const tuning = INCIDENTS_EXTRA_TUNING; // threeKmRuleWindowKm = 3
  assert.ok(isWithinThreeKmWindow(197, 200, tuning), "km 197 af 200 (3 km fra maal) skal vaere inden for vinduet");
  assert.ok(isWithinThreeKmWindow(199.99, 200, tuning));
  assert.ok(isWithinThreeKmWindow(200, 200, tuning), "selve maalstregen er inden for vinduet");
  assert.ok(!isWithinThreeKmWindow(196.99, 200, tuning), "lige uden for 3 km-vinduet");
  assert.ok(!isWithinThreeKmWindow(100, 200, tuning));
});

test("threeKmRuleApplies: kraever BEGGE betingelser (flad OG inden for vinduet)", () => {
  const tuning = INCIDENTS_EXTRA_TUNING;
  assert.ok(threeKmRuleApplies(198, 200, "flat", tuning), "flad + inden for vindue => regel gaelder");
  assert.ok(!threeKmRuleApplies(198, 200, "mountain", tuning), "bjergetape => regel gaelder ALDRIG, uanset km");
  assert.ok(!threeKmRuleApplies(100, 200, "flat", tuning), "flad men langt fra maal => regel gaelder ikke");
});

// ── incidentHook: protected vs. unprotected konsekvens ──────────────────────

test("incidentHook: styrt paa flad etape i sidste 3 km giver INGEN gruppe-/tidskonsekvens (kun event)", () => {
  const route = makeRoute("flat", 100);
  const segment = flatSegment(97, 100); // hele segmentet ligger inden for 3 km-vinduet
  const { state, ctx } = buildSingleGroupScenario([["a", 50], ["b", 50]], segment, route, "protected-seed");
  const hook = createIncidentHook(alwaysCrashTuning());
  const result = hook(state, ctx);

  const incidents = eventsOfType(result.events, "incident");
  assert.equal(incidents.length, 2, "begge ryttere skal styrte (risiko=1)");
  for (const ev of incidents) {
    assert.equal(ev.params.outcome, "protected_three_km_rule");
    assert.equal(ev.params.time_loss_seconds, null);
    assert.ok((ev.km as number) >= 97 && (ev.km as number) <= 100);
  }
  // Ingen gruppe-splitning: begge ryttere er stadig i samme gruppe.
  assert.equal(result.state.groups.length, 1);
  assert.deepEqual(new Set(result.state.groups[0].rider_ids), new Set(["a", "b"]));
  // Incidents-taelleren opdateres alligevel (ren information, jf. descent.ts).
  assert.equal(result.state.riders.a.incidents, 1);
  assert.equal(result.state.riders.b.incidents, 1);
});

test("incidentHook: styrt paa bjergetape i sidste 3 km giver TIDSKONSEKVENS (ingen 3 km-regel)", () => {
  const route = makeRoute("mountain", 100);
  const segment = flatSegment(97, 100);
  const { state, ctx } = buildSingleGroupScenario([["a", 50]], segment, route, "mountain-seed");
  const hook = createIncidentHook(alwaysCrashTuning());
  const result = hook(state, ctx);

  const incidents = eventsOfType(result.events, "incident");
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].params.outcome, "time_loss");
  const loss = incidents[0].params.time_loss_seconds as number;
  assert.ok(loss >= INCIDENTS_EXTRA_TUNING.unprotectedTimeLossSecondsRange[0]);
  assert.ok(loss <= INCIDENTS_EXTRA_TUNING.unprotectedTimeLossSecondsRange[1]);

  // Rytteren er splittet ud i sin egen solo-gruppe, bagud (positivt gap = tab).
  // (Kildegruppen havde kun "a" — den toemmes helt og forsvinder, jf. groups.ts's
  // splitGroup: en gruppe der mister sin sidste rytter bevares ikke tom.)
  assert.equal(result.state.groups.length, 1);
  const soloGroup = result.state.groups.find((g) => g.rider_ids.includes("a"))!;
  assert.equal(soloGroup.kind, "solo");
  assert.ok(soloGroup.gap_seconds > 0, "et uheldsramt tab skal give et POSITIVT (daarligere) gap");
  assert.ok(Math.abs(soloGroup.gap_seconds - loss) < 1e-9);
});

test("incidentHook: styrt paa flad etape LANGT fra maal (uden for 3 km-vinduet) giver ogsaa tidskonsekvens", () => {
  const route = makeRoute("flat", 100);
  const segment = flatSegment(40, 45); // langt fra maalstregen
  const { state, ctx } = buildSingleGroupScenario([["a", 50], ["b", 50]], segment, route, "far-from-finish-seed");
  const hook = createIncidentHook(alwaysCrashTuning());
  const result = hook(state, ctx);

  const incidents = eventsOfType(result.events, "incident");
  assert.equal(incidents.length, 2);
  for (const ev of incidents) assert.equal(ev.params.outcome, "time_loss");
  // Begge ryttere splittes hver til egen solo-gruppe; kildegruppen (kun 2
  // ryttere, begge splittet ud) toemmes og forsvinder => 2 solo-grupper i alt.
  assert.equal(result.state.groups.length, 2);
  for (const g of result.state.groups) assert.equal(g.kind, "solo");
});

test("incidentHook: risiko=0 giver ingen events og no-op state (samme reference-vaerdier undtagen riders-kopi)", () => {
  const route = makeRoute("flat", 100);
  const segment = flatSegment(0, 10);
  const { state, ctx } = buildSingleGroupScenario([["a", 50], ["b", 50]], segment, route, "no-crash-seed");
  const hook = createIncidentHook(neverCrashTuning());
  const result = hook(state, ctx);

  assert.equal(result.events.length, 0);
  assert.strictEqual(result.state.groups, state.groups, "ingen splits: groups-referencen skal vaere uaendret");
  assert.deepEqual(result.state.riders, state.riders);
});

test("incidentHook: kun status 'racing' ryttere kan styrte", () => {
  const route = makeRoute("flat", 100);
  const segment = flatSegment(97, 100);
  const { state, ctx } = buildSingleGroupScenario(
    [["a", 50], ["b", 50]],
    segment,
    route,
    "status-seed",
    { b: { status: "abandoned" } },
  );
  const hook = createIncidentHook(alwaysCrashTuning());
  const result = hook(state, ctx);
  const incidents = eventsOfType(result.events, "incident");
  assert.equal(incidents.length, 1, "kun 'a' (status racing) kan styrte");
  assert.equal(incidents[0].params.rider_id, "a");
});

// ── Determinisme + per-rytter-hash-isolation (samme disciplin som descent.test.ts) ──

test("incidentHook: determinisme — samme seed+input giver byte-identisk resultat", () => {
  const route = makeRoute("flat", 100);
  const segment = flatSegment(30, 40);
  const { state, ctx: ctxA } = buildSingleGroupScenario([["a", 40], ["b", 60]], segment, route, "det-seed");
  const ctxB: SegmentHookContext = { ...ctxA, rngFor: boundRngFor("det-seed") };
  const a = incidentHook(state, ctxA);
  const b = incidentHook(state, ctxB);
  assert.deepEqual(a, b);
});

test("incidentHook: per-rytter-hash — en uafhaengig ekstra gruppe paavirker ikke andre ryttere/gruppers udfald", () => {
  const seed = "isolation-seed";
  const route = makeRoute("flat", 100);
  const segment = flatSegment(97, 100);
  const scenarioA = buildSingleGroupScenario([["a", 30], ["b", 70]], segment, route, seed);
  const resultA = incidentHook(scenarioA.state, scenarioA.ctx);

  const extraEntrants: Record<string, Entrant> = { ...scenarioA.ctx.entrants, extra1: makeEntrant("extra1", 10) };
  const extraRiders: Record<string, RiderState> = {
    ...scenarioA.state.riders,
    extra1: makeRiderState("extra1", "chase-9"),
  };
  const extraGroup: RaceGroup = { id: "chase-9", kind: "chase", rider_ids: ["extra1"], gap_seconds: 30, cohesion: 1 };
  const stateB: EngineState = { ...scenarioA.state, groups: [...scenarioA.state.groups, extraGroup], riders: extraRiders };
  const ctxB: SegmentHookContext = { ...scenarioA.ctx, entrants: extraEntrants, rngFor: boundRngFor(seed) };
  const resultB = incidentHook(stateB, ctxB);

  const aIncidentsA = eventsOfType(resultA.events, "incident").filter((e) => e.params.rider_id === "a");
  const aIncidentsB = eventsOfType(resultB.events, "incident").filter((e) => e.params.rider_id === "a");
  assert.deepEqual(aIncidentsA, aIncidentsB, "'a's udfald maa ikke flyttes af det ekstra, uafhaengige felt");
  const bIncidentsA = eventsOfType(resultA.events, "incident").filter((e) => e.params.rider_id === "b");
  const bIncidentsB = eventsOfType(resultB.events, "incident").filter((e) => e.params.rider_id === "b");
  assert.deepEqual(bIncidentsA, bIncidentsB);
});

// ── Postprocessing: applyThreeKmRuleToResults + collectThreeKmRuleProtectedRiderIds ──

function stageResult(riderId: string, rank: number, timeSeconds: number, groupId = "peloton-0"): StageResult {
  return { rider_id: riderId, rank, time_seconds: timeSeconds, group_id: groupId, status: "finished" };
}

function protectedIncidentEvent(riderId: string): TimelineEvent {
  return { km: 99, type: "incident", params: { rider_id: riderId, kind: "crash", outcome: "protected_three_km_rule", time_loss_seconds: null } };
}

test("collectThreeKmRuleProtectedRiderIds: finder kun 'incident'-events med protected-outcome", () => {
  const events: TimelineEvent[] = [
    protectedIncidentEvent("a"),
    { km: 50, type: "incident", params: { rider_id: "b", kind: "crash", outcome: "time_loss", time_loss_seconds: 12 } },
    { km: 10, type: "gap_update", params: { group_id: "x", gap_seconds: 5 } },
  ];
  const ids = collectThreeKmRuleProtectedRiderIds(events);
  assert.deepEqual([...ids], ["a"]);
});

test("applyThreeKmRuleToResults: ingen protected-events => samme raekkefoelge (nyt array)", () => {
  const results = [stageResult("a", 1, 100), stageResult("b", 2, 105)];
  const out = applyThreeKmRuleToResults(results, []);
  assert.deepEqual(out, results);
  assert.notStrictEqual(out, results);
});

test("applyThreeKmRuleToResults: beskyttet rytter demoteres til sidst i sin time_seconds-klynge, time_seconds uaendret", () => {
  // Klynge 1: a,b,c samme tid (100s), c er beskyttet. Klynge 2: d alene (110s).
  const results = [
    stageResult("a", 1, 100, "peloton-0"),
    stageResult("c", 2, 100, "peloton-0"),
    stageResult("b", 3, 100, "peloton-0"),
    stageResult("d", 4, 110, "chase-1"),
  ];
  const events = [protectedIncidentEvent("c")];
  const out = applyThreeKmRuleToResults(results, events);

  assert.deepEqual(out.map((r) => r.rider_id), ["a", "b", "c", "d"], "c skal rykke sidst i sin klynge, resten rykker op");
  assert.deepEqual(out.map((r) => r.rank), [1, 2, 3, 4]);
  // time_seconds/group_id uaendret for ALLE, inkl. den demoterede.
  for (const r of out) {
    const original = results.find((o) => o.rider_id === r.rider_id)!;
    assert.equal(r.time_seconds, original.time_seconds, `${r.rider_id}: time_seconds maa aldrig aendres af 3 km-reglen`);
    assert.equal(r.group_id, original.group_id);
  }
});

test("applyThreeKmRuleToResults: flere beskyttede ryttere i samme klynge ordnes indbyrdes efter rider_id", () => {
  const results = [
    stageResult("z", 1, 100),
    stageResult("a", 2, 100),
    stageResult("m", 3, 100),
  ];
  const events = [protectedIncidentEvent("z"), protectedIncidentEvent("a")];
  const out = applyThreeKmRuleToResults(results, events);
  assert.deepEqual(out.map((r) => r.rider_id), ["m", "a", "z"]);
});

test("applyThreeKmRuleToResults: en beskyttelse i én klynge paavirker ikke en ANDEN klynges indbyrdes raekkefoelge", () => {
  const results = [
    stageResult("a", 1, 100),
    stageResult("b", 2, 100),
    stageResult("c", 3, 110),
    stageResult("d", 4, 110),
  ];
  const events = [protectedIncidentEvent("a")];
  const out = applyThreeKmRuleToResults(results, events);
  assert.deepEqual(out.map((r) => r.rider_id), ["b", "a", "c", "d"], "klynge 2 (c,d) skal beholde sin indbyrdes orden");
});

// ── Property: applyThreeKmRuleToResults bevarer altid mulit-set af time_seconds + rank er 1..N ──

const stageResultArb = fc
  .array(
    fc.record({
      riderId: fc.string({ minLength: 1, maxLength: 6 }).filter((s) => /^[a-z0-9]+$/i.test(s)),
      timeSeconds: fc.integer({ min: 0, max: 5 }), // lille range => mange klynge-kollisioner
    }),
    { minLength: 1, maxLength: 12 },
  )
  .map((rows) => {
    const seen = new Set<string>();
    const unique = rows.filter((r) => (seen.has(r.riderId) ? false : (seen.add(r.riderId), true)));
    const sorted = [...unique].sort((a, b) => a.timeSeconds - b.timeSeconds || a.riderId.localeCompare(b.riderId));
    return sorted.map((r, i) => stageResult(r.riderId, i + 1, r.timeSeconds));
  });

test("applyThreeKmRuleToResults: fast-check — rank er altid 1..N, time_seconds-multiset uaendret (200 runs)", () => {
  fc.assert(
    fc.property(stageResultArb, fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 4 }), (results, maybeProtected) => {
      const knownIds = new Set(results.map((r) => r.rider_id));
      const events = maybeProtected.filter((id) => knownIds.has(id)).map((id) => protectedIncidentEvent(id));
      const out = applyThreeKmRuleToResults(results, events);

      assert.equal(out.length, results.length);
      assert.deepEqual(out.map((r) => r.rank), out.map((_, i) => i + 1));
      const originalTimes = results.map((r) => r.time_seconds).sort((a, b) => a - b);
      const outTimes = out.map((r) => r.time_seconds).sort((a, b) => a - b);
      assert.deepEqual(outTimes, originalTimes, "multiset af time_seconds maa aldrig aendres");
      assert.deepEqual(new Set(out.map((r) => r.rider_id)), knownIds, "samme ryttere, ingen tabt/duplikeret");
    }),
    { numRuns: 200, seed: 4030 },
  );
});
