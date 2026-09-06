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
  hasHelperNearby,
  incidentHook,
  incidentProbability,
  isFlatStageForThreeKmRule,
  isWithinThreeKmWindow,
  maxIncidentsForField,
  resolveIncident,
  segmentLengthFactor,
  threeKmRuleApplies,
  type IncidentRolls,
} from "./incidents.ts";
import { boundRngFor, segmentRngFor } from "../rng.ts";
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
  StageIncident,
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
    // #4886: riggen spejler produktionen — segmentLoop giver hooksene en
    // SEGMENT-noeglet stream, ikke etapens raa stream.
    rngFor: segmentRngFor(boundRngFor(seed), 2),
    rngForStage: boundRngFor(seed),
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

// Rigget tuning: risiko=1 for én bestemt segment-kind gør et uheld deterministisk
// for ALLE ryttere i det segment (positioningDampening=0 saa evnen ikke redder nogen).
// #2944: risikoen skaleres nu ogsaa af segmentets laengde og bindes af et
// per-etape-loft, saa riggen skal ogsaa neutralisere BEGGE — ellers ville
// "risiko=1" i praksis stadig give faerre uheld end der er ryttere.
function alwaysCrashTuning(overrides: Partial<typeof INCIDENTS_EXTRA_TUNING> = {}): typeof INCIDENTS_EXTRA_TUNING {
  return {
    ...INCIDENTS_EXTRA_TUNING,
    baseRiskPerSegment: { flat: 1, rolling: 1, climb: 1, descent: 1, cobbles: 1 },
    positioningDampening: 0,
    referenceSegmentKm: 0.01, // laengde-faktoren maa ikke daempe riggen
    maxIncidentsFieldShare: 1, // ingen etape-loft i riggen
    ...overrides,
  };
}

/**
 * #2944: riggen ovenfor + trappen tvunget til TRIN 1 (let styrt). Bruges af de
 * arvede F2-tests, der blev skrevet foer trappen fandtes og derfor forudsaetter
 * "ét styrt = ét let tidstab".
 */
function alwaysLightCrashTuning(
  overrides: Partial<typeof INCIDENTS_EXTRA_TUNING> = {},
): typeof INCIDENTS_EXTRA_TUNING {
  return alwaysCrashTuning({
    mechanicalShare: 0, // aldrig mekanisk
    crashSeverityShares: { hard: 0, serious: 0 }, // altid let
    ...overrides,
  });
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
  const hook = createIncidentHook(alwaysLightCrashTuning());
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
  const hook = createIncidentHook(alwaysLightCrashTuning());
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
  const hook = createIncidentHook(alwaysLightCrashTuning());
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
  const hook = createIncidentHook(alwaysLightCrashTuning());
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

// ═══════════════════════════════════════════════════════════════════════════
// #2944 — TRAPPEN: graduerede styrt + mekaniske uheld uden DNF
// Ejer-beslutning 6/9 (laast). Hver test herunder laaser ÉT led af beslutningen.
// ═══════════════════════════════════════════════════════════════════════════

/** Rigger trappen til ét bestemt trin ved at saette andele til 0/1. */
function ladderTuning(overrides: Partial<typeof INCIDENTS_EXTRA_TUNING> = {}): typeof INCIDENTS_EXTRA_TUNING {
  return alwaysCrashTuning(overrides);
}

const ALWAYS_MECHANICAL = { mechanicalShare: 1 } as const;
const NEVER_MECHANICAL = { mechanicalShare: 0 } as const;

function rolls(overrides: Partial<IncidentRolls> = {}): IncidentRolls {
  return { kind: 0.5, severity: 0.5, magnitude: 0.5, injury: 0.5, ...overrides };
}

// ── (a) Mekanisk uheld kan ALDRIG give abandoned eller injury ────────────────

test("#2944 (a): mekanisk uheld kan ALDRIG give abandoned eller injury — fast-check over 500 kombinationer", () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 0.999, noNaN: true }),
      fc.double({ min: 0, max: 0.999, noNaN: true }),
      fc.double({ min: 0, max: 0.999, noNaN: true }),
      fc.boolean(),
      fc.boolean(),
      (severity, magnitude, injury, protectedByRule, helperNearby) => {
        const resolved = resolveIncident(
          // kind = 0 => altid under mechanicalShare => altid mekanisk
          { kind: 0, severity, magnitude, injury },
          { protectedByRule, helperNearby },
          INCIDENTS_EXTRA_TUNING,
        );
        assert.equal(resolved.kind, "mechanical");
        assert.notEqual(resolved.outcome, "abandoned", "et mekanisk uheld maa ALDRIG tvinge en rytter til at udgaa");
        assert.equal(resolved.injuryDays, null, "et mekanisk uheld maa ALDRIG skade rytteren (#4520)");
        assert.equal(resolved.severity, null, "mekaniske uheld har ingen alvorsakse");
      },
    ),
    { numRuns: 500, seed: 2944 },
  );
});

test("#2944 (a): hele hooket — ingen mekanisk haendelse giver abandoned/injury over 500 seeds", () => {
  const route = makeRoute("mountain", 200);
  const segment = flatSegment(50, 60);
  const hook = createIncidentHook(ladderTuning(ALWAYS_MECHANICAL));
  let seen = 0;
  for (let i = 0; i < 500; i += 1) {
    const { state, ctx } = buildSingleGroupScenario([["a", 50], ["b", 50]], segment, route, `mech-seed-${i}`);
    const result = hook(state, ctx);
    for (const ev of eventsOfType(result.events, "incident")) {
      seen += 1;
      assert.equal(ev.params.kind, "mechanical");
      assert.notEqual(ev.params.outcome, "abandoned");
      assert.equal(ev.params.injury_days, null);
    }
    for (const rider of Object.values(result.state.riders)) {
      assert.notEqual(rider.status, "abandoned", "et mekanisk uheld maa aldrig saette status 'abandoned'");
    }
  }
  assert.ok(seen > 0, "testen skal faktisk have set mekaniske uheld (ellers er den vakuoest sand)");
});

// ── (b) Alvorlige styrt er SJAELDNE ─────────────────────────────────────────

// DOKUMENTERET TAERSKEL: hoejst 8 % af STYRT maa vaere alvorlige (= udgaaelse).
// Tunings-andelen er 3 % (INCIDENTS_EXTRA_TUNING.crashSeverityShares.serious);
// 8 % er regressionsvagten — den fanger en fremtidig tunings-aendring der
// forvandler trappen tilbage til det binaere totaltab ejeren klagede over
// (#2944), uden at fejle paa stikproeve-stoej. Maalt i harnessen over 264
// etape-koerseler: 2,29 % af styrt (9 af 393).
const SERIOUS_CRASH_SHARE_CEILING = 0.08;

test("#2944 (b): alvorlige styrt er sjaeldne — under den dokumenterede taerskel over 4000 lodtraekninger", () => {
  let crashes = 0;
  let serious = 0;
  const step = 1 / 4000;
  for (let i = 0; i < 4000; i += 1) {
    const u = i * step;
    const resolved = resolveIncident(
      // kind = 1 => aldrig under mechanicalShare => altid styrt
      { kind: 0.999999, severity: u, magnitude: 0.5, injury: 0.5 },
      { protectedByRule: false, helperNearby: false },
      INCIDENTS_EXTRA_TUNING,
    );
    if (resolved.kind !== "crash") continue;
    crashes += 1;
    if (resolved.severity === "serious") serious += 1;
  }
  assert.ok(crashes > 0);
  const share = serious / crashes;
  assert.ok(
    share <= SERIOUS_CRASH_SHARE_CEILING,
    `andel alvorlige styrt ${(100 * share).toFixed(2)} % over taersklen ${100 * SERIOUS_CRASH_SHARE_CEILING} %`,
  );
  assert.ok(share > 0, "trappen skal stadig HAVE et alvorligt trin — 0 % ville betyde at trin 3 er doedt");
});

test("#2944 (b): kun trin 3 (alvorligt styrt) kan udgaa, og kun trin 2/3 kan skade", () => {
  const light = resolveIncident(rolls({ kind: 1, severity: 0.9 }), { protectedByRule: false, helperNearby: false }, INCIDENTS_EXTRA_TUNING);
  assert.deepEqual([light.kind, light.severity, light.outcome, light.injuryDays], ["crash", "light", "time_loss", null]);

  const hard = resolveIncident(rolls({ kind: 1, severity: 0.1 }), { protectedByRule: false, helperNearby: false }, INCIDENTS_EXTRA_TUNING);
  assert.equal(hard.severity, "hard");
  assert.equal(hard.outcome, "time_loss", "et haardt styrt koster tid — rytteren gennemfoerer");
  assert.ok((hard.injuryDays ?? 0) > 0, "et haardt styrt skader");
  assert.ok((hard.timeLossSeconds ?? 0) > (light.timeLossSeconds ?? 0), "haardt styrt koster mere tid end let styrt");

  const serious = resolveIncident(rolls({ kind: 1, severity: 0.001 }), { protectedByRule: false, helperNearby: false }, INCIDENTS_EXTRA_TUNING);
  assert.equal(serious.severity, "serious");
  assert.equal(serious.outcome, "abandoned");
  assert.equal(serious.timeLossSeconds, null, "en udgaaet rytter taber ikke etapetid — han har ingen");
  assert.ok((serious.injuryDays ?? 0) > 0, "et alvorligt styrt skader");
});

test("#2944 (b): 3 km-reglen beskytter TIDEN, ikke kroppen — et haardt styrt skader ogsaa naar reglen gaelder", () => {
  const protectedHard = resolveIncident(
    rolls({ kind: 1, severity: 0.1 }),
    { protectedByRule: true, helperNearby: false },
    INCIDENTS_EXTRA_TUNING,
  );
  assert.equal(protectedHard.outcome, "protected_three_km_rule");
  assert.equal(protectedHard.timeLossSeconds, null);
  assert.ok((protectedHard.injuryDays ?? 0) > 0, "reglen giver gruppens tid, ikke en uskadt rytter");

  const protectedSerious = resolveIncident(
    rolls({ kind: 1, severity: 0.001 }),
    { protectedByRule: true, helperNearby: false },
    INCIDENTS_EXTRA_TUNING,
  );
  assert.equal(protectedSerious.outcome, "abandoned", "en rytter der ikke koerer over stregen kan ikke faa gruppens tid");
});

test("#2944: et ALVORLIGT styrt saetter status 'abandoned' og tager rytteren ud af feltet", () => {
  const route = makeRoute("mountain", 200);
  const segment = flatSegment(50, 60);
  const hook = createIncidentHook(
    ladderTuning({ ...NEVER_MECHANICAL, crashSeverityShares: { hard: 0, serious: 1 } }),
  );
  const { state, ctx } = buildSingleGroupScenario([["a", 50], ["b", 50], ["c", 50]], segment, route, "serious-seed");
  const result = hook(state, ctx);

  for (const riderId of ["a", "b", "c"]) {
    assert.equal(result.state.riders[riderId].status, "abandoned", `${riderId} skal vaere udgaaet`);
  }
  const events = eventsOfType(result.events, "incident");
  assert.equal(events.length, 3);
  for (const ev of events) {
    assert.equal(ev.params.outcome, "abandoned");
    assert.equal(ev.params.kind, "crash");
    assert.equal(ev.params.severity, "serious");
    assert.ok((ev.params.injury_days as number) > 0);
  }
  // Udgaaede ryttere ligger ikke laengere i den oprindelige gruppe.
  const peloton = result.state.groups.find((g) => g.id === "peloton-0");
  assert.equal(peloton, undefined, "hele gruppen udgik => kildegruppen forsvinder");
});

// ── (c) Per-etape-loftet holder ────────────────────────────────────────────

test("#2944 (c): maxIncidentsForField arver v3's andel + ceil-afrunding", () => {
  const t = INCIDENTS_EXTRA_TUNING; // maxIncidentsFieldShare = 0.05, som v3's RACE_V3_INCIDENT_MAX_FIELD_SHARE
  assert.equal(maxIncidentsForField(0, t), 0, "tomt felt => intet loft at bruge");
  assert.equal(maxIncidentsForField(1, t), 1, "ceil: et lille felt faar altid mindst ét muligt uheld");
  assert.equal(maxIncidentsForField(180, t), 9);
  assert.equal(maxIncidentsForField(200, t), 10);
});

test("#2944 (c): fast-check — hooket overskrider ALDRIG etape-loftet, uanset feltstoerrelse og allerede loggede uheld", () => {
  const route = makeRoute("mountain", 200);
  const segment = flatSegment(50, 60);
  // Risiko 1 for alle: uden loftet ville ALLE ryttere faa et uheld.
  const hook = createIncidentHook(alwaysCrashTuning({ maxIncidentsFieldShare: INCIDENTS_EXTRA_TUNING.maxIncidentsFieldShare }));

  fc.assert(
    fc.property(fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 6 }), (fieldSize, alreadyLogged) => {
      const pairs: Array<[string, number]> = [];
      for (let i = 0; i < fieldSize; i += 1) pairs.push([`r${String(i).padStart(3, "0")}`, 50]);
      const { state, ctx } = buildSingleGroupScenario(pairs, segment, route, `cap-${fieldSize}-${alreadyLogged}`);
      const seeded: StageIncident[] = [];
      for (let i = 0; i < alreadyLogged; i += 1) {
        seeded.push({
          rider_id: `historic-${i}`,
          km: 1,
          kind: "crash",
          severity: "light",
          outcome: "time_loss",
          time_loss_seconds: 10,
          injury_days: null,
          helper_assist: false,
        });
      }
      const stateWithHistory: EngineState = { ...state, stage_incidents: seeded };
      const result = hook(stateWithHistory, ctx);

      const cap = maxIncidentsForField(fieldSize, INCIDENTS_EXTRA_TUNING);
      const total = (result.state.stage_incidents ?? []).length;
      assert.ok(total <= Math.max(cap, alreadyLogged), `${total} uheld i alt overskrider loftet ${cap}`);
      const newOnes = eventsOfType(result.events, "incident").length;
      assert.ok(newOnes <= Math.max(0, cap - alreadyLogged), `${newOnes} nye uheld overskrider resten af loftet`);
    }),
    { numRuns: 120, seed: 2944 },
  );
});

test("#2944 (c): et opbrugt loft giver et UROERT state tilbage (samme reference)", () => {
  const route = makeRoute("flat", 200);
  const segment = flatSegment(50, 60);
  const hook = createIncidentHook(alwaysCrashTuning({ maxIncidentsFieldShare: 0 }));
  const { state, ctx } = buildSingleGroupScenario([["a", 50], ["b", 50]], segment, route, "cap-exhausted");
  const result = hook(state, ctx);
  assert.equal(result.events.length, 0);
  assert.strictEqual(result.state, state);
});

// ── (d) Hjaelper taet paa => STRENGT mindre tidstab ─────────────────────────

test("#2944 (d): hjaelper i samme gruppe giver STRENGT mindre tidstab ved mekanisk uheld", () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 0.999, noNaN: true }), (magnitude) => {
      const base = { kind: 0, severity: 0.5, magnitude, injury: 0.5 };
      const withHelper = resolveIncident(base, { protectedByRule: false, helperNearby: true }, INCIDENTS_EXTRA_TUNING);
      const without = resolveIncident(base, { protectedByRule: false, helperNearby: false }, INCIDENTS_EXTRA_TUNING);
      assert.equal(withHelper.helperAssist, true);
      assert.equal(without.helperAssist, false);
      assert.ok(
        (withHelper.timeLossSeconds ?? 0) < (without.timeLossSeconds ?? 0),
        `hjaelper gav ${withHelper.timeLossSeconds}s, uden gav ${without.timeLossSeconds}s — skal vaere STRENGT mindre`,
      );
    }),
    { numRuns: 200, seed: 2944 },
  );
});

test("#2944 (d): hasHelperNearby kraever en ANDEN, stadig racende rytter med rollen helper i SAMME gruppe", () => {
  const entrants: Record<string, Entrant> = {
    victim: { ...makeEntrant("victim"), role: "helper" }, // egen rolle taeller ikke
    mate: { ...makeEntrant("mate"), role: "helper" },
    rival: { ...makeEntrant("rival"), role: "captain" },
    dropped: { ...makeEntrant("dropped"), role: "helper" },
  };
  const riders: Record<string, RiderState> = {
    victim: makeRiderState("victim", "g"),
    mate: makeRiderState("mate", "g"),
    rival: makeRiderState("rival", "g"),
    dropped: makeRiderState("dropped", "g", { status: "abandoned" }),
  };
  assert.equal(hasHelperNearby(["victim"], entrants, riders, "victim"), false, "man er ikke sin egen hjaelper");
  assert.equal(hasHelperNearby(["victim", "rival"], entrants, riders, "victim"), false, "en kaptajn er ikke en hjaelper");
  assert.equal(hasHelperNearby(["victim", "dropped"], entrants, riders, "victim"), false, "en udgaaet hjaelper er ikke taet paa");
  assert.equal(hasHelperNearby(["victim", "mate"], entrants, riders, "victim"), true);
  assert.equal(hasHelperNearby(["victim"], entrants, riders, "victim"), false, "en hjaelper i en ANDEN gruppe er ikke i rider_ids");
});

test("#2944 (d): hooket giver hjulskift-rabatten naar en helper er i gruppen", () => {
  const route = makeRoute("mountain", 200);
  const segment = flatSegment(50, 60);
  const hook = createIncidentHook(ladderTuning(ALWAYS_MECHANICAL));

  function lossFor(withHelper: boolean): number {
    const { state, ctx } = buildSingleGroupScenario([["a", 50], ["b", 50]], segment, route, "helper-hook-seed");
    const entrants: Record<string, Entrant> = {
      ...ctx.entrants,
      b: { ...ctx.entrants.b, role: withHelper ? "helper" : "captain" },
    };
    const result = hook(state, { ...ctx, entrants });
    const ev = eventsOfType(result.events, "incident").find((e) => e.params.rider_id === "a")!;
    assert.equal(ev.params.helper_assist, withHelper);
    return ev.params.time_loss_seconds as number;
  }

  assert.ok(lossFor(true) < lossFor(false), "hjulskift med hjaelper skal koste strengt mindre tid");
});

// ── (e) Determinisme ────────────────────────────────────────────────────────

test("#2944 (e): determinisme — samme seed giver byte-identiske uheld, ogsaa med trappen slaaet til", () => {
  const route = makeRoute("mountain", 200);
  const segment = flatSegment(20, 60);
  const pairs: Array<[string, number]> = [];
  for (let i = 0; i < 40; i += 1) pairs.push([`r${String(i).padStart(2, "0")}`, 30 + (i % 40)]);
  // Moderat (ikke rigget-til-1) risiko: nok uheld til at der ER noget at
  // sammenligne, men stadig et blandet billede paa tvaers af trappens trin.
  const hook = createIncidentHook(
    alwaysCrashTuning({ baseRiskPerSegment: { flat: 0.4, rolling: 0.4, climb: 0.4, descent: 0.4, cobbles: 0.4 } }),
  );

  const a = buildSingleGroupScenario(pairs, segment, route, "determinism-2944");
  const b = buildSingleGroupScenario(pairs, segment, route, "determinism-2944");
  const runA = hook(a.state, a.ctx);
  assert.ok(runA.events.length > 0, "riggen skal faktisk producere uheld (ellers er testen vakuoest sand)");
  assert.deepEqual(runA, hook(b.state, b.ctx));
  // ... og hele protokollen, ikke kun events.
  assert.deepEqual(runA.state.stage_incidents, hook(b.state, b.ctx).state.stage_incidents);

  const c = buildSingleGroupScenario(pairs, segment, route, "et-ANDET-seed");
  const same = JSON.stringify(runA.events) === JSON.stringify(hook(c.state, c.ctx).events);
  assert.ok(!same, "et andet seed skal give et andet uheldsbillede (ellers er seedet ikke i spil)");
});

test("#2944 (e): rng-streams er SEGMENT-noeglede — samme rytter styrter ikke paa hvert eneste segment", () => {
  // Uden segment-noeglen ville (seed, mekanik, rider_id) give SAMME foerste
  // lodtraekning paa hvert segment => en rytter der styrter paa segment 0
  // styrter paa dem alle. Her: 12 segmenter af samme kind og laengde, samme
  // rytter — antallet af uheld skal vaere langt under 12.
  const route = makeRoute("flat", 480);
  const tuning = alwaysCrashTuning({
    baseRiskPerSegment: { flat: 0.5, rolling: 0.5, climb: 0.5, descent: 0.5, cobbles: 0.5 },
    referenceSegmentKm: 40,
    maxIncidentsFieldShare: 1,
  });
  const hook = createIncidentHook(tuning);
  let hits = 0;
  for (let i = 0; i < 12; i += 1) {
    const segment = flatSegment(i * 40, (i + 1) * 40);
    const { state, ctx } = buildSingleGroupScenario([["a", 50]], segment, route, "segment-stream-seed");
    // Segment-noeglen bor i KERNEN (#4886): et nyt segment-index betyder ogsaa
    // en ny stream — praecis som segmentLoop bygger ctx'en.
    const result = hook(state, { ...ctx, segmentIndex: i, rngFor: segmentRngFor(ctx.rngForStage, i) });
    hits += eventsOfType(result.events, "incident").length;
  }
  assert.ok(hits > 0, "risikoen skal vaere hoej nok til at ramme mindst én gang");
  assert.ok(hits < 12, `rytteren ramte paa ALLE ${hits}/12 segmenter — rng-streamen er ikke segment-noeglet`);
});

// ── Laengde-skalering (grundlaget for at raten kan kalibreres pr. etape) ────

test("#2944: segmentLengthFactor er lineaer i laengden, 0 ved 0 km, aldrig negativ", () => {
  const t = INCIDENTS_EXTRA_TUNING;
  assert.equal(segmentLengthFactor({ from_km: 10, to_km: 10 }, t), 0);
  assert.equal(segmentLengthFactor({ from_km: 0, to_km: t.referenceSegmentKm }, t), 1);
  assert.equal(segmentLengthFactor({ from_km: 0, to_km: 2 * t.referenceSegmentKm }, t), 2);
  assert.equal(segmentLengthFactor({ from_km: 50, to_km: 10 }, t), 0, "negativ laengde => 0, aldrig negativ risiko");
});

test("#2944: to korte segmenter og ét langt af samme samlede laengde giver samme samlede risiko", () => {
  const t = INCIDENTS_EXTRA_TUNING;
  const whole = segmentLengthFactor({ from_km: 0, to_km: 60 }, t);
  const split =
    segmentLengthFactor({ from_km: 0, to_km: 25 }, t) + segmentLengthFactor({ from_km: 25, to_km: 60 }, t);
  assert.ok(Math.abs(whole - split) < 1e-12, "rute-modellens segment-granularitet maa ikke aendre uheldsraten");
});
