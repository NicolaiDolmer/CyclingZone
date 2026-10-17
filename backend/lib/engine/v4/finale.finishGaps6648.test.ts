// backend/lib/engine/v4/finale.finishGaps6648.test.ts
// #6648: maalgabet paa en selektiv afslutning kommer af loebet, ikke af et fast trin.
// Foer gav hver placerings-tier mergeThreshold + margin + jitter (+ en lille score-del),
// saa nr. 2 paa en bjergtop naesten altid kom praecis ca. 3 s efter vinderen. Under
// s5_profiles_v1 er en rytters tid hans eget tidstab: score-afstand x relativt fartab x
// den afgoerende indsats' varighed (paa en stigning stigningens egen fart). Ryttere inden
// for gruppe-taersklen af tierens foerste rytter deler tid (gap-reglen), ellers egen tid.
// Aeldre revisioner beholder det gamle trin (byte-identisk).
//
// Opsaetning (samme moenster som finale.tieTiers6199.test.ts): én frontgruppe, ingen
// jagt, topankomst (long_climb) paa en bjergprofil. Evnerne i long_climb-vektoren
// saettes ens til v, saa evne-leddet er praecis v/99 og dagens modifikatorer er ens.

import { test } from "node:test";
import assert from "node:assert/strict";

import { finaleHook, finishEffortSeconds, s5FinishGapSeconds } from "./finale.ts";
import { climbTimeSeconds } from "./mechanics/timeModel.ts";
import { makeHookCtx } from "./testUtils/makeHookCtx.ts";
import { FINALE_EXTRA_TUNING, RACE_V4_TUNING, S5_PROFILES_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, EngineState, FinaleType, RiderState, RouteV2, Segment, SegmentHookContext } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];
const DEMAND = RACE_V4_TUNING.finale.demandVectorByFinaleType.long_climb ?? {};
const SAME_TIME = RACE_V4_TUNING.groups.mergeThresholdSeconds + FINALE_EXTRA_TUNING.placementGapMarginSeconds;
const LOSS = S5_PROFILES_TUNING.finishGaps.default!.lossPerScoreUnit;
const climb = (km: number, gradient: number): Segment => ({ kind: "climb", from_km: 150 - km, to_km: 150, category: "1", avg_gradient: gradient, top_elevation_m: 1800 });

type Spec = { id: string; v: number };

function abilitiesFor(v: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = 50;
  for (const key of Object.keys(DEMAND) as AbilityKey[]) out[key] = v;
  return out;
}

function riderState(riderId: string): RiderState {
  return { rider_id: riderId, group_id: "front", cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0, seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0 };
}

function run(specs: Spec[], opts: { s5: boolean; segment?: Segment; finale?: FinaleType }): Map<string, number> {
  const segment = opts.segment ?? climb(8, 8);
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  for (const s of specs) {
    entrants[s.id] = { rider_id: s.id, abilities: abilitiesFor(s.v), role: "free_role", effort: "normal", condition: 1 };
    riders[s.id] = riderState(s.id);
  }
  const state: EngineState = {
    km: segment.from_km,
    groups: [{ id: "front", kind: "peloton", rider_ids: specs.map((s) => s.id), gap_seconds: 0, cohesion: 1 }],
    riders,
    virtual_gc: Object.fromEntries(specs.map((s) => [s.id, 0])),
  };
  const route: RouteV2 = { distance_km: 150, profile_type: "mountain", finale_type: opts.finale ?? "long_climb", segments: [segment], weather: { kind: "sun", wind_exposure: 0.1 }, waypoints: [] };
  const base = makeHookCtx({ segment, segmentIndex: 0, route, entrants, tuning: RACE_V4_TUNING, seed: "finish-gaps-6648" });
  // Jitteren nulstilles, saa det gamle trin er deterministisk i sammenligningen.
  let ctx: SegmentHookContext = { ...base, rngForStage: () => () => 0, ordersGcV3: true };
  if (opts.s5) ctx = { ...ctx, s5ProfilesV1: true };
  const gapOf = new Map<string, number>();
  for (const g of finaleHook(state, ctx).state.groups) for (const id of g.rider_ids) gapOf.set(id, g.gap_seconds);
  return gapOf;
}

const physical = (dv: number, segment: Segment = climb(8, 8)): number =>
  s5FinishGapSeconds(dv / 99, finishEffortSeconds(segment, RACE_V4_TUNING.terrain.baseSpeedKmh), LOSS);

test("#6648: tidstabet er 0 ved 0 afstand og vokser monotont med afstand og indsats (intet fast trin)", () => {
  assert.equal(s5FinishGapSeconds(0, 1200, LOSS), 0);
  assert.equal(s5FinishGapSeconds(-0.1, 1200, LOSS), 0, "en hoejere score giver aldrig et tab");
  let last = 0;
  for (const d of [0.001, 0.01, 0.03, 0.1, 0.3]) {
    const gap = s5FinishGapSeconds(d, 1200, LOSS);
    assert.ok(gap >= last, `afstand ${d}: aldrig mindre tab end en mindre afstand`);
    last = gap;
  }
  assert.ok(s5FinishGapSeconds(0.001, 1200, LOSS) < 1, "en lille afstand er et lille tab, ikke et trin");
  assert.ok(s5FinishGapSeconds(0.05, 2400, LOSS) > s5FinishGapSeconds(0.05, 1200, LOSS), "laengere indsats, stoerre tab");
});

test("#6648: indsatsen er stigningens egen tid paa en stigning, referencefarten ellers, og hoejst loftet", () => {
  const speeds = RACE_V4_TUNING.terrain.baseSpeedKmh;
  assert.equal(finishEffortSeconds(climb(8, 8), speeds), climbTimeSeconds(8, 8));
  assert.ok(finishEffortSeconds(climb(12, 8), speeds) > finishEffortSeconds(climb(6, 8), speeds), "mere stigning tilbage, laengere indsats");
  assert.ok(finishEffortSeconds(climb(8, 10), speeds) > finishEffortSeconds(climb(8, 5), speeds), "stejlere, langsommere");
  const descent: Segment = { kind: "descent", from_km: 135, to_km: 150, technicality: 2 };
  assert.equal(finishEffortSeconds(descent, speeds), (15 / speeds.descent) * 3600);
  assert.equal(finishEffortSeconds(descent, speeds, 120), 120, "en kort afslutning (mur, bakke) har et loft");
});

test("#6648 S5: nr. 2's gab er hans eget tidstab, ikke trin-summen", () => {
  const specs = [{ id: "A", v: 85 }, { id: "B", v: 80 }];
  const gap = run(specs, { s5: true }).get("B")!;
  assert.ok(physical(5) >= SAME_TIME, "forudsaetning: tabet er over gruppe-taersklen");
  assert.ok(Math.abs(gap - physical(5)) < 1e-9, `forventede ${physical(5)}, fik ${gap}`);
  // Det gamle trin for samme afstand: taersklen + margin + en lille score-del.
  const old = run(specs, { s5: false }).get("B")!;
  assert.ok(Math.abs(old - (SAME_TIME + FINALE_EXTRA_TUNING.placementGapScoreScale * (5 / 99))) < 1e-9, "aeldre revisioner beholder det gamle trin");
});

test("#6648 S5: gap-reglen - inden for taersklen af tierens foerste rytter deles tiden, ellers egen tid", () => {
  const specs = [{ id: "A", v: 85 }, { id: "B", v: 84 }, { id: "C", v: 80 }, { id: "D", v: 79 }, { id: "E", v: 75 }];
  const gapOf = run(specs, { s5: true });
  assert.ok(physical(1) < SAME_TIME && physical(5) - physical(6) < SAME_TIME, "forudsaetning");
  assert.equal(gapOf.get("A"), 0);
  assert.equal(gapOf.get("B"), 0, "B er inden for taersklen af vinderen: samme tid");
  assert.ok(Math.abs(gapOf.get("C")! - physical(5)) < 1e-9, "C starter en ny tier paa sin egen tid");
  assert.equal(gapOf.get("D"), gapOf.get("C"), "D er inden for taersklen af C: samme tid");
  assert.ok(Math.abs(gapOf.get("E")! - physical(10)) < 1e-9, "E paa sin egen tid, ikke C + et trin");
});

test("#6648 S5: samme evneforskel giver stoerre gab jo mere stigning der er tilbage", () => {
  const specs = [{ id: "A", v: 85 }, { id: "B", v: 78 }];
  const short = run(specs, { s5: true, segment: climb(4, 8) }).get("B")!;
  const long = run(specs, { s5: true, segment: climb(12, 8) }).get("B")!;
  assert.ok(long > short, `12 km (${long} s) skal give mere end 4 km (${short} s)`);
});

test("#6648 S5: en hoejere score giver aldrig en daarligere tid (ogsaa hen over haleklumpen)", () => {
  const specs = Array.from({ length: 30 }, (_, i) => ({ id: `r${String(i).padStart(2, "0")}`, v: 90 - i * 0.7 }));
  const gapOf = run(specs, { s5: true });
  for (let i = 1; i < specs.length; i++) {
    assert.ok(gapOf.get(specs[i].id)! >= gapOf.get(specs[i - 1].id)!, `${specs[i].id} bag ${specs[i - 1].id}`);
  }
  const distinct = [...new Set(specs.map((s) => gapOf.get(s.id)!))].sort((a, b) => a - b);
  for (let i = 1; i < distinct.length; i++) assert.ok(distinct[i] - distinct[i - 1] >= SAME_TIME - 1e-9, "to tider er altid mindst gruppe-taersklen fra hinanden (mergeGroups folder dem ikke)");
});
