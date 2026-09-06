// backend/lib/engine/v4/mechanics/bonusSeconds.test.ts
// Kontrakt-tests + property-tests (fast-check, seeded) for M9 (passager:
// bjergpoint, spurtpoint, bonussekunder). SSOT:
// docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md §4 M9
// + #2413 (maal-bonus KUN masse-etaper, GC-effekt bounded ~10s/etape)
// + #2770 (passage-laget) + RACE_ENGINE_RULES §9 (ejer 6/9: v4's egen mekanik
// er eneste kilde naar v4 er on).
//
// Testene laaser HENSIGT, ikke tal: bonus falder ALTID inden for tuning-
// baandene, det samlede per-rytter-loft haandhaeves ALTID, point-skalaerne er
// PRAECIS v3's (paritets-vagten — driver de fra hinanden, taber spillerne den
// groenne/prikkede troeje ved flippet), og en passage flytter ALDRIG en tid,
// en gruppe eller en placering.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  buildFinishPassages,
  buildPassage,
  clampPassageBonusToPerRiderCap,
  computePassageOrder,
  finishPointScale,
  inRacePassageWaypoints,
  isMassFinishFinaleType,
  komPointScale,
  passageTotals,
  passagesHook,
  passagesToTimelineEvents,
  sortPassages,
  stageAwardsFinishBonus,
} from "./bonusSeconds.ts";
import {
  FINISH_BONUS_SECONDS,
  GREEN_FINISH_SCALES,
  INTERMEDIATE_BONUS_SECONDS,
  INTERMEDIATE_SPRINT_SCALE,
  KOM_SCALES,
} from "../../../racePassages.js";
import { boundRngFor } from "../rng.ts";
import { BONUS_SECONDS_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import type {
  AbilityKey,
  Entrant,
  EngineState,
  FinaleType,
  RaceGroup,
  RiderState,
  RouteV2,
  Segment,
  SegmentHookContext,
  StagePassage,
  StageResult,
  Waypoint,
} from "../types.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = overrides[key] ?? 50;
  return out;
}

function makeEntrant(riderId: string, ab: Record<AbilityKey, number>): Entrant {
  return { rider_id: riderId, abilities: ab, role: "free_role", effort: "normal", condition: 1 };
}

function makeRiderState(riderId: string, groupId: string): RiderState {
  return {
    rider_id: riderId,
    group_id: groupId,
    cp: 0.5,
    wprimeMax: 1,
    wprime: 1,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: "racing",
    time_seconds: 0,
  };
}

function makeResult(riderId: string, rank: number, status: StageResult["status"] = "finished"): StageResult {
  return { rider_id: riderId, rank, time_seconds: rank, group_id: "peloton-0", status };
}

// ── Point-skalaerne ER v3's (paritets-vagt) ────────────────────────────────
// Uden denne test kan de to lag drive fra hinanden usynligt: v4's mekanik er
// eneste kilde naar motoren er on, saa en skala-drift ville aendre alle
// groenne/prikkede troeje-regnskaber paa flip-dagen uden at nogen test faldt.

test("paritet: v4's maal-pointskalaer er PRAECIS racePassages' GREEN_FINISH_SCALES", () => {
  for (const [profileType, scale] of Object.entries(GREEN_FINISH_SCALES)) {
    assert.deepEqual([...finishPointScale(profileType)], [...(scale as number[])], `profil ${profileType}`);
  }
  // itt_hilly findes ikke i v3's tabel og ramte dér mountain-fallbacket.
  assert.deepEqual([...finishPointScale("itt_hilly")], [...GREEN_FINISH_SCALES.mountain]);
  assert.deepEqual([...finishPointScale("ukendt-type")], [...GREEN_FINISH_SCALES.mountain]);
});

test("paritet: v4's bjerg- og spurtskalaer er PRAECIS racePassages' KOM_SCALES/INTERMEDIATE_SPRINT_SCALE", () => {
  for (const [category, scale] of Object.entries(KOM_SCALES)) {
    assert.deepEqual([...komPointScale(category)], [...(scale as number[])], `kategori ${category}`);
  }
  assert.deepEqual(
    [...BONUS_SECONDS_EXTRA_TUNING.intermediateSprintPoints],
    [...INTERMEDIATE_SPRINT_SCALE],
  );
  assert.deepEqual([...RACE_V4_TUNING.bonusSeconds.finishSeconds], [...FINISH_BONUS_SECONDS]);
  assert.deepEqual([...RACE_V4_TUNING.bonusSeconds.intermediateSeconds], [...INTERMEDIATE_BONUS_SECONDS]);
});

test("komPointScale: summit finish fordobler HC/1, men ALDRIG 2/3/4 (racePassages.scaleFor)", () => {
  assert.deepEqual([...komPointScale("HC", true)], KOM_SCALES.HC.map((p: number) => p * 2));
  assert.deepEqual([...komPointScale("1", true)], KOM_SCALES["1"].map((p: number) => p * 2));
  assert.deepEqual([...komPointScale("2", true)], [...KOM_SCALES["2"]]);
  assert.deepEqual([...komPointScale("4", true)], [...KOM_SCALES["4"]]);
  assert.deepEqual([...komPointScale(null, true)], [], "ukendt kategori giver ingen passage");
});

// ── Maal-bonussens to gates ────────────────────────────────────────────────

test("isMassFinishFinaleType: solo_tt (ITT) er ALDRIG masse-etape, null/kendte masse-typer er", () => {
  assert.equal(isMassFinishFinaleType("solo_tt" as FinaleType), false);
  assert.equal(isMassFinishFinaleType(null), true);
  for (const t of BONUS_SECONDS_EXTRA_TUNING.finishBonusEligibleFinaleTypes) {
    assert.equal(isMassFinishFinaleType(t as FinaleType), true, `${t} skal vaere masse-etape`);
  }
});

test("stageAwardsFinishBonus: profil-typen gater ogsaa — en legacy-ITT uden finale_type faar ALDRIG bonus", () => {
  assert.equal(stageAwardsFinishBonus(null, "itt"), false);
  assert.equal(stageAwardsFinishBonus(null, "itt_hilly"), false);
  assert.equal(stageAwardsFinishBonus(null, "ttt"), false);
  assert.equal(stageAwardsFinishBonus("bunch_sprint" as FinaleType, "flat"), true);
  assert.equal(stageAwardsFinishBonus("solo_tt" as FinaleType, "flat"), false);
});

// ── buildPassage ───────────────────────────────────────────────────────────

test("buildPassage: point + bonus laegges paa i skalaernes raekkefolge, rader uden nogen af delene udelades", () => {
  const passage = buildPassage({
    kind: "sprint",
    index: 0,
    name: "Spurt",
    km: 42,
    order: ["a", "b", "c", "d"],
    pointScale: [20, 17],
    bonusScale: [3, 2, 1],
  });
  assert.ok(passage);
  assert.deepEqual(passage.results, [
    { rider_id: "a", passage_rank: 1, points: 20, bonus_seconds: 3 },
    { rider_id: "b", passage_rank: 2, points: 17, bonus_seconds: 2 },
    { rider_id: "c", passage_rank: 3, points: 0, bonus_seconds: 1 },
  ]);
});

test("buildPassage: tom pointskala uden bonus giver INGEN passage (v3's scaleFor-gate)", () => {
  assert.equal(buildPassage({ kind: "kom", index: 0, name: "x", km: 1, order: ["a"], pointScale: [] }), null);
});

test("buildPassage: faerre ryttere end skalapladser -> kun de tilgaengelige, ingen krasch", () => {
  const passage = buildPassage({
    kind: "finish", index: 0, name: "Maal", km: 100,
    order: ["a"], pointScale: [50, 30, 20], bonusScale: [10, 6, 4],
  });
  assert.ok(passage);
  assert.equal(passage.results.length, 1);
  assert.deepEqual(passage.results[0], { rider_id: "a", passage_rank: 1, points: 50, bonus_seconds: 10 });
});

// ── computePassageOrder ────────────────────────────────────────────────────

function scenarioState(groups: RaceGroup[], riderStates: Record<string, RiderState>): EngineState {
  return { km: 0, groups, riders: riderStates, virtual_gc: {} };
}

test("computePassageOrder: GRUPPEN gaar foer evnen — en staerkere rytter bagude kan ikke tage passagen", () => {
  const entrants: Record<string, Entrant> = {
    a: makeEntrant("a", abilities({ sprint: 60, acceleration: 60 })),
    back: makeEntrant("back", abilities({ sprint: 99, acceleration: 99 })),
  };
  const state = scenarioState(
    [
      { id: "break-0", kind: "breakaway", rider_ids: ["a"], gap_seconds: 0, cohesion: 1 },
      { id: "peloton-1", kind: "peloton", rider_ids: ["back"], gap_seconds: 120, cohesion: 1 },
    ],
    { a: makeRiderState("a", "break-0"), back: makeRiderState("back", "peloton-1") },
  );
  const order = computePassageOrder(state, entrants, boundRngFor("s"), {
    stream: "passage:sprint:0",
    qualityWeights: BONUS_SECONDS_EXTRA_TUNING.intermediateSprintQualityWeights,
    noiseSd: 0,
  });
  assert.deepEqual(order, ["a", "back"]);
});

test("computePassageOrder: inden for samme gruppe ranger hoejere relevante evner foerst (stoej=0)", () => {
  const entrants: Record<string, Entrant> = {
    high: makeEntrant("high", abilities({ sprint: 95, acceleration: 95, positioning: 95 })),
    mid: makeEntrant("mid", abilities({ sprint: 60, acceleration: 60, positioning: 60 })),
    low: makeEntrant("low", abilities({ sprint: 10, acceleration: 10, positioning: 10 })),
  };
  const state = scenarioState(
    [{ id: "p0", kind: "peloton", rider_ids: ["high", "mid", "low"], gap_seconds: 0, cohesion: 1 }],
    { high: makeRiderState("high", "p0"), mid: makeRiderState("mid", "p0"), low: makeRiderState("low", "p0") },
  );
  const order = computePassageOrder(state, entrants, boundRngFor("s"), {
    stream: "passage:sprint:0",
    qualityWeights: BONUS_SECONDS_EXTRA_TUNING.intermediateSprintQualityWeights,
    noiseSd: 0,
  });
  assert.deepEqual(order, ["high", "mid", "low"]);
});

test("computePassageOrder: en UDGAAET rytter er ude af opgoerelsen", () => {
  const entrants: Record<string, Entrant> = {
    a: makeEntrant("a", abilities()),
    gone: makeEntrant("gone", abilities({ sprint: 99, acceleration: 99, positioning: 99 })),
  };
  const gone = { ...makeRiderState("gone", "p0"), status: "abandoned" as const };
  const state = scenarioState(
    [{ id: "p0", kind: "peloton", rider_ids: ["a", "gone"], gap_seconds: 0, cohesion: 1 }],
    { a: makeRiderState("a", "p0"), gone },
  );
  const order = computePassageOrder(state, entrants, boundRngFor("s"), {
    stream: "passage:sprint:0",
    qualityWeights: BONUS_SECONDS_EXTRA_TUNING.intermediateSprintQualityWeights,
    noiseSd: 0,
  });
  assert.deepEqual(order, ["a"]);
});

// ── passagesHook (segment-hook-kontrakt) ───────────────────────────────────

const ROUTE_STUB: RouteV2 = {
  distance_km: 150,
  profile_type: "flat",
  finale_type: "bunch_sprint",
  segments: [],
  weather: { kind: "sun", wind_exposure: 0 },
  waypoints: [],
};

function sprintWaypoint(km: number, index = 0): Waypoint {
  return { kind: "sprint", index, name: "Test Sprint", km };
}

function komWaypoint(km: number, category: Waypoint["category"], summitFinish = false, index = 0): Waypoint {
  return { kind: "kom", index, name: "Test Stigning", km, category, summit_finish: summitFinish };
}

function buildScenario(args: {
  groups: RaceGroup[];
  entrants: Record<string, Entrant>;
  riderStates: Record<string, RiderState>;
  waypoints: Waypoint[];
  segment: Segment;
  seed?: string;
}): { state: EngineState; ctx: SegmentHookContext } {
  const state: EngineState = { km: args.segment.from_km, groups: args.groups, riders: args.riderStates, virtual_gc: {} };
  const ctx: SegmentHookContext = {
    segment: args.segment,
    segmentIndex: 0,
    route: { ...ROUTE_STUB, waypoints: args.waypoints },
    entrants: args.entrants,
    tuning: RACE_V4_TUNING,
    rngFor: boundRngFor(args.seed ?? "bonus-seed"),
    rngForStage: boundRngFor(args.seed ?? "bonus-seed"),
    orders: [],
  };
  return { state, ctx };
}

function threeRiderScenario(waypoints: Waypoint[], segment: Segment, seed?: string) {
  const entrants: Record<string, Entrant> = {
    a: makeEntrant("a", abilities({ sprint: 90, acceleration: 90, climbing: 90 })),
    b: makeEntrant("b", abilities({ sprint: 70, acceleration: 70, climbing: 70 })),
    c: makeEntrant("c", abilities({ sprint: 50, acceleration: 50, climbing: 50 })),
  };
  const riderStates: Record<string, RiderState> = {
    a: makeRiderState("a", "p0"), b: makeRiderState("b", "p0"), c: makeRiderState("c", "p0"),
  };
  return buildScenario({
    groups: [{ id: "p0", kind: "peloton", rider_ids: ["a", "b", "c"], gap_seconds: 0, cohesion: 1 }],
    entrants, riderStates, waypoints, segment, seed,
  });
}

test("passagesHook: segment uden vejpunkt -> ingen passager, state uaendret (samme reference)", () => {
  const { state, ctx } = threeRiderScenario([], { kind: "flat", from_km: 0, to_km: 10 });
  const result = passagesHook(state, ctx);
  assert.equal(result.events.length, 0);
  assert.strictEqual(result.state, state);
});

test("passagesHook: indlagt spurt i segmentet -> point + bonussekunder, INGEN aendring af tid/gruppe/placering", () => {
  const { state, ctx } = threeRiderScenario([sprintWaypoint(5)], { kind: "flat", from_km: 0, to_km: 10 });
  const result = passagesHook(state, ctx);
  const passages = result.state.stage_passages ?? [];
  assert.equal(passages.length, 1);
  assert.equal(passages[0].kind, "sprint");
  assert.deepEqual(
    passages[0].results.slice(0, 3).map((r) => r.bonus_seconds),
    [...RACE_V4_TUNING.bonusSeconds.intermediateSeconds],
  );
  assert.deepEqual(passages[0].results.map((r) => r.points), [20, 17, 15]);
  assert.deepEqual(result.state.riders, state.riders, "tid/status maa aldrig roeres af en passage");
  assert.deepEqual(result.state.groups, state.groups, "gruppe-strukturen maa aldrig roeres af en passage");
});

test("passagesHook: bjergtop giver bjergpoint og ALDRIG bonussekunder (#2413-scope)", () => {
  const { state, ctx } = threeRiderScenario([komWaypoint(5, "1")], { kind: "flat", from_km: 0, to_km: 10 });
  const passages = passagesHook(state, ctx).state.stage_passages ?? [];
  assert.equal(passages.length, 1);
  assert.equal(passages[0].kind, "kom");
  assert.equal(passages[0].category, "1");
  assert.ok(passages[0].results.every((r) => r.bonus_seconds === 0));
  assert.deepEqual(passages[0].results.map((r) => r.points), [10, 8, 6]);
});

test("passagesHook: en summit-finish-top afgoeres IKKE undervejs (den hoerer til maalordenen)", () => {
  const { state, ctx } = threeRiderScenario(
    [komWaypoint(10, "HC", true)],
    { kind: "flat", from_km: 0, to_km: 10 },
  );
  const result = passagesHook(state, ctx);
  assert.strictEqual(result.state, state);
});

test("passagesHook: vejpunkter uden for segmentets km-vindue ignoreres", () => {
  const { state, ctx } = threeRiderScenario([sprintWaypoint(50)], { kind: "flat", from_km: 0, to_km: 10 });
  assert.strictEqual(passagesHook(state, ctx).state, state);
});

test("inRacePassageWaypoints: (from, to]-vinduet er halvaabent, saa en graense-km taelles PRAECIS én gang", () => {
  const wps = [sprintWaypoint(10, 0), sprintWaypoint(20, 1)];
  assert.deepEqual(inRacePassageWaypoints(wps, 0, 10).map((w) => w.index), [0]);
  assert.deepEqual(inRacePassageWaypoints(wps, 10, 20).map((w) => w.index), [1]);
});

test("passagesHook: determinisme — samme seed+input giver byte-identisk resultat", () => {
  const a = threeRiderScenario([sprintWaypoint(5)], { kind: "flat", from_km: 0, to_km: 10 }, "det-seed");
  const b = threeRiderScenario([sprintWaypoint(5)], { kind: "flat", from_km: 0, to_km: 10 }, "det-seed");
  assert.deepEqual(passagesHook(a.state, a.ctx), passagesHook(b.state, b.ctx));
});

test("passagesHook: to spurter i samme segment faar hver sin rng-stroem (#4886)", () => {
  // Fire IDENTISKE ryttere: evne-leddet er ens for alle, saa raekkefolgen ved
  // hver spurt afgoeres UDELUKKENDE af den seedede stoej. Var stroemmen kun
  // mekaniknavnet, ville de to spurter faa praecis samme stoej og dermed
  // praecis samme raekkefolge — vagten her er at vejpunktets index er en del
  // af stroem-noeglen.
  const ids = ["a", "b", "c", "d", "e", "f"];
  const entrants: Record<string, Entrant> = Object.fromEntries(
    ids.map((id) => [id, makeEntrant(id, abilities())]),
  );
  const riderStates: Record<string, RiderState> = Object.fromEntries(
    ids.map((id) => [id, makeRiderState(id, "p0")]),
  );
  const { state, ctx } = buildScenario({
    groups: [{ id: "p0", kind: "peloton", rider_ids: [...ids], gap_seconds: 0, cohesion: 1 }],
    entrants,
    riderStates,
    waypoints: [sprintWaypoint(3, 0), sprintWaypoint(7, 1)],
    segment: { kind: "flat", from_km: 0, to_km: 10 },
    seed: "stream-seed",
  });
  const passages = passagesHook(state, ctx).state.stage_passages ?? [];
  assert.equal(passages.length, 2);
  assert.notDeepEqual(
    passages[0].results.map((r) => r.rider_id),
    passages[1].results.map((r) => r.rider_id),
    "to vejpunkter deler rng-stroem — noeglen mangler vejpunktets index",
  );
});

// ── buildFinishPassages ────────────────────────────────────────────────────

test("buildFinishPassages: maalet giver groenne point + 10/6/4 paa en masse-etape", () => {
  const passages = buildFinishPassages({
    results: [makeResult("a", 1), makeResult("b", 2), makeResult("c", 3)],
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 150 }],
    distanceKm: 150,
    profileType: "flat",
    finaleType: "bunch_sprint" as FinaleType,
    tuning: RACE_V4_TUNING.bonusSeconds,
  });
  assert.equal(passages.length, 1);
  assert.equal(passages[0].kind, "finish");
  assert.deepEqual(passages[0].results.map((r) => r.points), [50, 30, 20]);
  assert.deepEqual(passages[0].results.map((r) => r.bonus_seconds), [10, 6, 4]);
});

test("buildFinishPassages: enkeltstart giver point men ALDRIG bonussekunder", () => {
  const passages = buildFinishPassages({
    results: [makeResult("a", 1), makeResult("b", 2), makeResult("c", 3)],
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 40 }],
    distanceKm: 40,
    profileType: "itt",
    finaleType: "solo_tt" as FinaleType,
    tuning: RACE_V4_TUNING.bonusSeconds,
  });
  assert.ok(passages[0].results.every((r) => r.bonus_seconds === 0));
  assert.deepEqual(passages[0].results.map((r) => r.points), [20, 17, 15]);
});

test("buildFinishPassages: summit-finish-toppen koeres paa MAALORDENEN med dobbelt point", () => {
  const passages = buildFinishPassages({
    results: [makeResult("a", 1), makeResult("b", 2), makeResult("c", 3)],
    waypoints: [
      komWaypoint(180, "HC", true, 0),
      { kind: "finish", index: 1, name: "Bjergmaal", km: 180 },
    ],
    distanceKm: 180,
    profileType: "high_mountain",
    finaleType: "long_climb" as FinaleType,
    tuning: RACE_V4_TUNING.bonusSeconds,
  });
  const kom = passages.find((p) => p.kind === "kom");
  assert.ok(kom, "summit-finish skal give en kom-passage");
  assert.deepEqual(kom.results.map((r) => r.rider_id), ["a", "b", "c"]);
  assert.deepEqual(kom.results.map((r) => r.points), [40, 30, 24]);
});

test("buildFinishPassages: udgaaede og OTL-ryttere er ude af maalordenen", () => {
  const passages = buildFinishPassages({
    results: [
      makeResult("otl", 1, "otl"),
      makeResult("gone", 2, "abandoned"),
      makeResult("a", 3),
      makeResult("b", 4),
    ],
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 150 }],
    distanceKm: 150,
    profileType: "flat",
    finaleType: "bunch_sprint" as FinaleType,
    tuning: RACE_V4_TUNING.bonusSeconds,
  });
  assert.deepEqual(passages[0].results.map((r) => r.rider_id), ["a", "b"]);
});

test("buildFinishPassages: rute uden finish-vejpunkt bruger stadig distancen som maalstreg", () => {
  const passages = buildFinishPassages({
    results: [makeResult("a", 1)],
    waypoints: [],
    distanceKm: 123.45,
    profileType: "flat",
    finaleType: null,
    tuning: RACE_V4_TUNING.bonusSeconds,
  });
  assert.equal(passages[0].km, 123.45);
});

// ── Per-rytter-loftet (#2413) ──────────────────────────────────────────────

test("clampPassageBonusToPerRiderCap: totalen under loftet er uaendret", () => {
  const passages: StagePassage[] = [
    { kind: "sprint", index: 0, name: "s", km: 10, category: null, results: [{ rider_id: "a", passage_rank: 1, points: 20, bonus_seconds: 3 }] },
  ];
  assert.deepEqual(clampPassageBonusToPerRiderCap(passages, 10), passages);
});

test("clampPassageBonusToPerRiderCap: sum over loftet klemmes PROPORTIONALT, point roeres ALDRIG", () => {
  const passages: StagePassage[] = [
    { kind: "sprint", index: 0, name: "s", km: 10, category: null, results: [{ rider_id: "a", passage_rank: 1, points: 20, bonus_seconds: 3 }] },
    { kind: "finish", index: 0, name: "m", km: 100, category: null, results: [{ rider_id: "a", passage_rank: 1, points: 50, bonus_seconds: 10 }] },
  ];
  const clamped = clampPassageBonusToPerRiderCap(passages, 10);
  const total = clamped.flatMap((p) => p.results).reduce((s, r) => s + r.bonus_seconds, 0);
  assert.ok(total <= 10, `samlet bonus ${total} maa aldrig overstige loftet`);
  assert.ok(clamped[0].results[0].bonus_seconds < 3 && clamped[1].results[0].bonus_seconds < 10, "begge kilder reduceres");
  assert.ok(
    clamped.flatMap((p) => p.results).every((r) => Number.isInteger(r.bonus_seconds)),
    "bonus_seconds er en INTEGER-kolonne i race_results — klemningen maa aldrig give en broekdel",
  );
  assert.deepEqual(clamped.flatMap((p) => p.results).map((r) => r.points), [20, 50], "point er ikke GC og klemmes aldrig");
});

test("clampPassageBonusToPerRiderCap: ALDRIG over loftet for nogen rytter, fast-check (200 runs)", () => {
  const cap = BONUS_SECONDS_EXTRA_TUNING.maxTotalBonusSecondsPerRiderPerStage;
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          rider_id: fc.constantFrom("a", "b", "c"),
          bonus_seconds: fc.integer({ min: 0, max: 12 }),
        }),
        { minLength: 0, maxLength: 12 },
      ),
      (rows) => {
        const passages: StagePassage[] = rows.map((r, i) => ({
          kind: "sprint" as const, index: i, name: "s", km: i + 1, category: null,
          results: [{ rider_id: r.rider_id, passage_rank: 1, points: 0, bonus_seconds: r.bonus_seconds }],
        }));
        const totals = new Map<string, number>();
        for (const p of clampPassageBonusToPerRiderCap(passages, cap)) {
          for (const r of p.results) {
            // race_results.bonus_seconds er en INTEGER-kolonne — en broekdel
            // ville braekke castet midt i en afvikling.
            if (!Number.isInteger(r.bonus_seconds)) return false;
            totals.set(r.rider_id, (totals.get(r.rider_id) ?? 0) + r.bonus_seconds);
          }
        }
        return [...totals.values()].every((v) => v <= cap);
      },
    ),
    { numRuns: 200, seed: 2413 },
  );
});

// ── Aggregering + events ───────────────────────────────────────────────────

test("passageTotals: kom-passager giver bjergpoint, spurt/maal giver spurtpoint (racePassages' bump-regel)", () => {
  const totals = passageTotals([
    { kind: "kom", index: 0, name: "k", km: 50, category: "1", results: [{ rider_id: "a", passage_rank: 1, points: 10, bonus_seconds: 0 }] },
    { kind: "sprint", index: 0, name: "s", km: 80, category: null, results: [{ rider_id: "a", passage_rank: 1, points: 20, bonus_seconds: 3 }] },
    { kind: "finish", index: 0, name: "m", km: 150, category: null, results: [{ rider_id: "a", passage_rank: 1, points: 50, bonus_seconds: 10 }] },
  ]);
  assert.deepEqual(totals, [{ rider_id: "a", sprint_points: 70, kom_points: 10, bonus_seconds: 13 }]);
});

test("passageTotals: sorteret paa rider_id (determinisme helt ud i databasen)", () => {
  const totals = passageTotals([
    { kind: "sprint", index: 0, name: "s", km: 10, category: null, results: [
      { rider_id: "z", passage_rank: 1, points: 20, bonus_seconds: 3 },
      { rider_id: "a", passage_rank: 2, points: 17, bonus_seconds: 2 },
    ] },
  ]);
  assert.deepEqual(totals.map((t) => t.rider_id), ["a", "z"]);
});

test("passagesToTimelineEvents: maalpassagen udsender INTET event (finish-eventet er maalstregen)", () => {
  const events = passagesToTimelineEvents([
    { kind: "kom", index: 0, name: "Toppen", km: 50, category: "2", results: [{ rider_id: "a", passage_rank: 1, points: 5, bonus_seconds: 0 }] },
    { kind: "sprint", index: 0, name: "Spurten", km: 80, category: null, results: [{ rider_id: "b", passage_rank: 1, points: 20, bonus_seconds: 3 }] },
    { kind: "finish", index: 0, name: "Maal", km: 150, category: null, results: [{ rider_id: "c", passage_rank: 1, points: 50, bonus_seconds: 10 }] },
  ]);
  assert.deepEqual(events.map((e) => e.type), ["kom_passage", "intermediate_sprint"]);
  assert.deepEqual(events[0].params, { name: "Toppen", category: "2", top: [{ rider_id: "a", points: 5 }] });
  assert.deepEqual(events[1].params, { name: "Spurten", top: [{ rider_id: "b", points: 20, bonus_seconds: 3 }] });
});

test("sortPassages: km-orden, og kom foer sprint foer maal paa samme km (racePassages' egen orden)", () => {
  const sorted = sortPassages([
    { kind: "finish", index: 0, name: "m", km: 100, category: null, results: [] },
    { kind: "sprint", index: 0, name: "s", km: 100, category: null, results: [] },
    { kind: "kom", index: 0, name: "k", km: 100, category: "1", results: [] },
    { kind: "kom", index: 1, name: "k2", km: 20, category: "2", results: [] },
  ]);
  assert.deepEqual(sorted.map((p) => `${p.kind}@${p.km}`), ["kom@20", "kom@100", "sprint@100", "finish@100"]);
});
