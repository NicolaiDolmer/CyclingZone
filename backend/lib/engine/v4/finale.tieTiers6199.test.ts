// backend/lib/engine/v4/finale.tieTiers6199.test.ts
// #6199 / review af PR #6223: placerings-tiers i finalen under orders_gc_v3.
// RULES ("Én tidsmodel", punkt 5): taet score giver samme tid, og afstanden til
// naeste tier regnes fra tierens FOERSTE rytter (finale.ts, tier-grenen og
// haleklumpens foerste skridt). Uden orders_gc_v3 er opgoeret det gamle: hver
// lavere score faar sin egen tier, og skridtet regnes fra rytteren lige foran.
// Egen fil, saa den ikke kolliderer med andre spors aendringer i finale.test.ts.
//
// Opsaetning (samme moenster som finale.test.ts): én frontgruppe, ingen jagt,
// finale_type "punch" paa en bakket profil (selektiv finale, ingen massespurt).
// Evnerne i punch-vektoren saettes ens til v, saa evne-leddet er praecis v/99.
// Alle ryttere ligger over kandidat-referencen, saa dagens modifikatorer er ens
// for alle, og score-afstanden mellem to ryttere er afstanden i v/99.
// Jitteren nulstilles (rngForStage => 0), saa hvert skridt er
// mergeThreshold + margin + scoreScale x score-afstand, helt deterministisk.

import { test } from "node:test";
import assert from "node:assert/strict";

import { finaleHook } from "./finale.ts";
import { TIME_MODEL_V3_TUNING } from "./mechanics/timeModel.ts";
import { makeHookCtx } from "./testUtils/makeHookCtx.ts";
import { FINALE_EXTRA_TUNING, RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, EngineState, RaceGroup, RiderState, RouteV2, Segment, SegmentHookContext } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];
const PUNCH_DEMAND = RACE_V4_TUNING.finale.demandVectorByFinaleType.punch ?? {};
const EPS = TIME_MODEL_V3_TUNING.finaleTieScoreEpsilon;
const BASE_STEP = RACE_V4_TUNING.groups.mergeThresholdSeconds + FINALE_EXTRA_TUNING.placementGapMarginSeconds;
const SCALE = FINALE_EXTRA_TUNING.placementGapScoreScale;
const SEGMENT: Segment = { kind: "flat", from_km: 149, to_km: 150 };

type Spec = { id: string; v: number; flat?: number };

/** Evne-leddet for punch-finalen er v/99, naar alle vektorens noegler er v. */
const term = (v: number): number => v / 99;
const stepFor = (scoreDelta: number): number => BASE_STEP + SCALE * scoreDelta;

function abilitiesFor(spec: Spec): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = 50;
  for (const key of Object.keys(PUNCH_DEMAND) as AbilityKey[]) out[key] = spec.v;
  // `flat` indgaar ikke i punch-vektoren: samme score, men en anden profil.
  if (spec.flat !== undefined) out.flat = spec.flat;
  return out;
}

function riderState(riderId: string): RiderState {
  return {
    rider_id: riderId,
    group_id: "front",
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

function run(specs: Spec[], v3: boolean, zeroJitter = true): { gapOf: Map<string, number>; groups: RaceGroup[]; result: ReturnType<typeof finaleHook> } {
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  for (const spec of specs) {
    entrants[spec.id] = { rider_id: spec.id, abilities: abilitiesFor(spec), role: "free_role", effort: "normal", condition: 1 };
    riders[spec.id] = riderState(spec.id);
  }
  const state: EngineState = {
    km: 149,
    groups: [{ id: "front", kind: "peloton", rider_ids: specs.map((s) => s.id), gap_seconds: 0, cohesion: 1 }],
    riders,
    virtual_gc: Object.fromEntries(specs.map((s) => [s.id, 0])),
  };
  const route: RouteV2 = {
    distance_km: 150,
    profile_type: "hilly",
    finale_type: "punch",
    segments: [SEGMENT],
    weather: { kind: "sun", wind_exposure: 0.1 },
    waypoints: [],
  };
  const base = makeHookCtx({ segment: SEGMENT, segmentIndex: 0, route, entrants, tuning: RACE_V4_TUNING, seed: "tie-tiers-6199" });
  let ctx: SegmentHookContext = zeroJitter ? { ...base, rngForStage: () => () => 0 } : base;
  if (v3) ctx = { ...ctx, ordersGcV3: true };
  const result = finaleHook(state, ctx);
  const gapOf = new Map<string, number>();
  for (const group of result.state.groups) for (const id of group.rider_ids) gapOf.set(id, group.gap_seconds);
  return { gapOf, groups: result.state.groups, result };
}

function assertClose(actual: number | undefined, expected: number, label: string): void {
  assert.ok(actual !== undefined, `${label}: rytteren mangler i maal`);
  assert.ok(Math.abs(actual! - expected) < 1e-9, `${label}: forventede ${expected}, fik ${actual}`);
}

/** Lavere score maa aldrig give bedre tid (hoejere v = hoejere score her). */
function assertMonotone(specs: Spec[], gapOf: Map<string, number>): void {
  for (const a of specs) {
    for (const b of specs) {
      if (a.v > b.v) {
        assert.ok(gapOf.get(a.id)! <= gapOf.get(b.id)! + 1e-12, `${b.id} (lavere score) maa ikke faa bedre tid end ${a.id}`);
      }
    }
  }
}

// Fem ryttere. A/B inden for epsilon (samme tier). C ligger mindst epsilon under
// A, men inden for epsilon af B: ny tier kun naar der maales fra tierens foerste
// rytter. C2 inden for epsilon af C. D ligger mindst epsilon under C, men inden
// for epsilon af C2.
const CORE: Spec[] = [
  { id: "A", v: 90 },
  { id: "B", v: 89 },
  { id: "C", v: 87.5 },
  { id: "C2", v: 87 },
  { id: "D", v: 85.5 },
];

test("#6199 forudsaetning: scenariets score-afstande ligger tydeligt paa hver sin side af epsilon", () => {
  const v = Object.fromEntries(CORE.map((s) => [s.id, term(s.v)]));
  assert.ok(v.A - v.B < EPS && v.C - v.C2 < EPS, "A/B og C/C2 skal ligge inden for epsilon");
  assert.ok(v.A - v.C >= EPS && v.C - v.D >= EPS, "C skal ligge mindst epsilon under A, D mindst epsilon under C");
  assert.ok(v.B - v.C < EPS && v.C2 - v.D < EPS, "C inden for epsilon af B, D inden for epsilon af C2 (fanger en maaling fra forrige rytter)");
});

test("#6199 v3: taet score giver samme tid inden for en tier", () => {
  const { gapOf, groups } = run(CORE, true);
  assert.equal(gapOf.get("A"), 0, "vinderen har gap 0");
  assert.equal(gapOf.get("B"), gapOf.get("A"), "B inden for epsilon af A faar samme tid");
  assert.equal(gapOf.get("C2"), gapOf.get("C"), "C2 inden for epsilon af C faar samme tid");
  assert.ok(gapOf.get("C")! > gapOf.get("B")!, "C er en ny tier bag A/B");
  assert.ok(gapOf.get("D")! > gapOf.get("C2")!, "D er en ny tier bag C/C2");
  assert.deepEqual(
    groups.map((g) => g.rider_ids),
    [["A", "B"], ["C", "C2"], ["D"]],
    "tre tiers i score-orden",
  );
});

test("#6199 v3: naeste tiers skridt regnes fra tierens FOERSTE rytter, ikke fra rytteren lige foran", () => {
  const { gapOf } = run(CORE, true);
  const tier2 = stepFor(term(90) - term(87.5)); // A -> C, ikke B -> C
  const tier3 = tier2 + stepFor(term(87.5) - term(85.5)); // C -> D, ikke C2 -> D
  assertClose(gapOf.get("C"), tier2, "C (tier 2)");
  assertClose(gapOf.get("C2"), tier2, "C2 (tier 2)");
  assertClose(gapOf.get("D"), tier3, "D (tier 3)");
});

test("#6199 v3: tiden er monoton i score", () => {
  const { gapOf } = run(CORE, true);
  assertMonotone(CORE, gapOf);
});

// 22 ryttere: de 20 bedste faar oploeste tiers, resten haleklumpen. r00-r17 i
// hver sin tier (2,5/99 > epsilon), r18/r19 i én tier (1/99 < epsilon). r20 og
// r21 har samme score som r19 (kun `flat` adskiller profilen), saa kandidat-
// referencen (den 20. bedste) holder alle modifikatorer ens. Fra tierens foerste
// rytter (r18) er haleklumpens foerste skridt stoerre end fra r19.
const TAIL: Spec[] = [
  ...Array.from({ length: 18 }, (_, i): Spec => ({ id: `r${String(i).padStart(2, "0")}`, v: 99 - 2.5 * i })),
  { id: "r18", v: 54 },
  { id: "r19", v: 53 },
  { id: "r20", v: 53, flat: 40 },
  { id: "r21", v: 53, flat: 30 },
];

test("#6199 v3: haleklumpens foerste skridt regnes ogsaa fra tierens foerste rytter", () => {
  assert.equal(FINALE_EXTRA_TUNING.placementFullResolutionCount, 20, "scenariet forudsaetter 20 oploeste placeringer");
  const { gapOf, groups } = run(TAIL, true);
  assert.equal(gapOf.get("r19"), gapOf.get("r18"), "r18/r19 deler tier");
  const tail = groups.find((g) => g.id.startsWith("finale-tail-"));
  assert.ok(tail, "haleklumpen findes");
  assert.deepEqual([...tail!.rider_ids].sort(), ["r20", "r21"]);
  assertClose(gapOf.get("r20"), gapOf.get("r18")! + stepFor(term(54) - term(53)), "haleklumpen (fra r18, ikke r19)");
  assertMonotone(TAIL, gapOf);
});

test("#6199 uden v3: samme input giver det gamle resultat (hver lavere score sin egen tier, skridt fra rytteren foran)", () => {
  const { gapOf, groups } = run(CORE, false);
  assert.deepEqual(groups.map((g) => g.rider_ids), [["A"], ["B"], ["C"], ["C2"], ["D"]]);
  let expected = 0;
  for (let i = 0; i < CORE.length; i++) {
    if (i > 0) expected += stepFor(term(CORE[i - 1].v) - term(CORE[i].v));
    assertClose(gapOf.get(CORE[i].id), expected, `${CORE[i].id} (legacy)`);
  }

  const tailRun = run(TAIL, false);
  // Legacy: r19 er sin egen tier (lavere score end r18); haleklumpen maales fra r19.
  assert.ok(tailRun.gapOf.get("r19")! > tailRun.gapOf.get("r18")!);
  assertClose(tailRun.gapOf.get("r20"), tailRun.gapOf.get("r19")! + stepFor(0), "haleklumpen (legacy, fra r19)");
});

test("#6199 med rigtig jitter: legacy er deterministisk og holder A/B adskilt, v3 slaar dem sammen", () => {
  // Samme kontrol uden nulstillet jitter: kun v3-noeglen skiller de to opgoer.
  const first = run(CORE, false, false);
  const second = run(CORE, false, false);
  assert.deepEqual(first.result, second.result);
  assert.notEqual(first.gapOf.get("B"), first.gapOf.get("A"));
  assert.equal(run(CORE, true, false).gapOf.get("B"), run(CORE, true, false).gapOf.get("A"));
});
