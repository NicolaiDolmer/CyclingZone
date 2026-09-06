// backend/lib/engine/v4/segmentLoop.rngStreams.test.ts
// Forward-guard for #4886: KOBLINGEN mellem segment-loopet og rng-streamene.
//
// rng.test.ts daekker segmentRngFor som ren funktion. Denne fil daekker det der
// faktisk gik galt: at segmentLoop gav hooksene etapens RAA stream, saa enhver
// mekanik der kaldes pr. segment genbrugte sin foerste lodtraekning paa hvert
// eneste segment (fundet i uheldsmodulet 6/9, #2944/PR #4882 — men fejlen laa i
// konteksten, ikke i mekanikken). Uden en test paa netop koblingen kan defaulten
// gaa tabt ved foerste refaktorering af ctx-konstruktionen.
//
// Testene laeser konteksten gennem et opsamlings-hook: MechanicHooks kan
// injiceres i runSegmentLoop, saa vi kan se praecis det en mekanik ser — uden at
// laene os op ad nogen enkelt mekaniks kalibrering.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MECHANIC_HOOKS, runSegmentLoop } from "./segmentLoop.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type {
  AbilityKey,
  Entrant,
  EngineState,
  MechanicHooks,
  RouteV2,
  SegmentHookContext,
  SegmentHookResult,
  StageInput,
} from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(level: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = level;
  return out;
}

function startlist(count: number): Entrant[] {
  return Array.from({ length: count }, (_, i) => ({
    rider_id: `r${String(i).padStart(2, "0")}`,
    abilities: abilities(50 + (i % 10)),
    role: "free_role" as const,
    effort: "normal" as const,
    condition: 1,
  }));
}

/** Fire IDENTISKE flade segmenter: alt der adskiller dem er segment-indekset. */
function fourIdenticalSegmentsRoute(): RouteV2 {
  return {
    distance_km: 200,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 50 },
      { kind: "flat", from_km: 50, to_km: 100 },
      { kind: "flat", from_km: 100, to_km: 150 },
      { kind: "flat", from_km: 150, to_km: 200 },
    ],
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 200 }],
  };
}

function stageInput(seed = "rng-streams-seed"): StageInput {
  return { route: fourIdenticalSegmentsRoute(), startlist: startlist(20), seed, tuning: RACE_V4_TUNING, orders: [] };
}

type Sample = { segmentIndex: number; segmentValue: number; stageValue: number };

/**
 * Hook der ikke aendrer noget, men noterer hvad konteksten giver en mekanik der
 * kaldes paa HVERT segment (som M5/M10/M16 gør).
 */
function samplingHooks(samples: Sample[]): MechanicHooks {
  const probe = (state: EngineState, ctx: SegmentHookContext): SegmentHookResult => {
    samples.push({
      segmentIndex: ctx.segmentIndex,
      segmentValue: ctx.rngFor("probe", "r00")(),
      stageValue: ctx.rngForStage("probe", "r00")(),
    });
    return { state, events: [] };
  };
  return { ...DEFAULT_MECHANIC_HOOKS, breakaway: probe };
}

test("#4886: ctx.rngFor ruller NYT paa hvert segment — samme mekanik, samme rytter", () => {
  const samples: Sample[] = [];
  runSegmentLoop(stageInput(), samplingHooks(samples));

  assert.equal(samples.length, 4, "hooket skal vaere kaldt paa alle fire segmenter");
  const values = samples.map((s) => s.segmentValue);
  assert.equal(
    new Set(values).size,
    values.length,
    `to segmenter delte lodtraekning (${values.join(", ")}) — ctx.rngFor er ikke segment-noeglet (#4886)`,
  );
});

test("#4886: ctx.rngForStage er etape-stabil — den er stedet for vejpunkter og maalstreg", () => {
  const samples: Sample[] = [];
  runSegmentLoop(stageInput(), samplingHooks(samples));

  const values = samples.map((s) => s.stageValue);
  assert.equal(new Set(values).size, 1, "rngForStage skal give SAMME vaerdi paa alle segmenter");
  assert.notEqual(values[0], samples[0].segmentValue, "de to streams maa ikke vaere den samme");
});

test("#4886: segment-streamene er deterministiske — samme seed, samme etape, samme tal", () => {
  const first: Sample[] = [];
  const second: Sample[] = [];
  runSegmentLoop(stageInput(), samplingHooks(first));
  runSegmentLoop(stageInput(), samplingHooks(second));
  assert.deepEqual(first, second);

  const other: Sample[] = [];
  runSegmentLoop(stageInput("et-ANDET-seed"), samplingHooks(other));
  assert.notDeepEqual(first.map((s) => s.segmentValue), other.map((s) => s.segmentValue));
});

test("#4886: en ekstra rytter i feltet flytter ikke en andens segment-stream (§3 invariant 1)", () => {
  const small: Sample[] = [];
  runSegmentLoop(stageInput(), samplingHooks(small));

  const bigger = stageInput();
  const withExtra: StageInput = {
    ...bigger,
    startlist: [
      ...bigger.startlist,
      { rider_id: "zz-ekstra", abilities: abilities(70), role: "free_role", effort: "normal", condition: 1 },
    ],
  };
  const large: Sample[] = [];
  runSegmentLoop(withExtra, samplingHooks(large));

  assert.deepEqual(
    large.map((s) => s.segmentValue),
    small.map((s) => s.segmentValue),
    "r00's lodtraekninger flyttede sig fordi en anden rytter kom med i feltet",
  );
});
