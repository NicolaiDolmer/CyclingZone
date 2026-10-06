// backend/lib/engine/v4/mechanics/breakawayDropped6185.test.ts
// #6185 del 2 + #6234 (KUN orders_gc_v3):
//   1. Motoren melder selv "sat af fra udbruddet" (`breakaway_dropped`), naar en
//      udbryder havner i en gruppe bag udbruddet.
//   2. Et afsat stykke af udbruddet, der lukker hullet, er ikke en indhentning:
//      `breakaway_caught` kun naar ikke-udbrydere henter udbruddet.
// Laasen nederst koerer hele etapen gennem simulateStageV4 og sammenligner en
// digest af StageOutput med vaerdier fastfrosset mod koden FOER denne aendring
// (main paa cbeb70c65). Giver legacy, orders_gc_v1 eller orders_gc_v2 en anden
// digest, er det et laek ud af v3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, RiderRole, RouteV2, RulesRevision, Segment, StageInput, StageOutput } from "../types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

/** 8 hold a 5 ryttere med spredte evner (deterministisk, ingen rng). */
function field(): Entrant[] {
  const out: Entrant[] = [];
  for (let team = 0; team < 8; team++) {
    for (let r = 0; r < 5; r++) {
      const i = team * 5 + r;
      const abilities = {} as Record<AbilityKey, number>;
      ABILITY_KEYS.forEach((key, k) => {
        abilities[key] = 15 + ((i * 37 + k * 23 + team * 11) % 80);
      });
      const role: RiderRole = r === 0 ? "captain" : r === 4 ? "hunter" : "helper";
      out.push({ rider_id: `t${team}r${r}`, abilities, role, effort: "normal", condition: 1, team_id: `T${team}` });
    }
  }
  return out;
}

function climb(fromKm: number, toKm: number, category: "HC" | "1" | "2" | "3" | "4", gradient: number, topM: number): Segment {
  return { kind: "climb", from_km: fromKm, to_km: toKm, category, avg_gradient: gradient, top_elevation_m: topM };
}

const ROUTES: Record<"mountain" | "hilly", RouteV2> = {
  mountain: {
    distance_km: 160,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments: [
      { kind: "flat", from_km: 0, to_km: 40 },
      climb(40, 52, "2", 6, 1200),
      { kind: "descent", from_km: 52, to_km: 62, technicality: 2 },
      { kind: "rolling", from_km: 62, to_km: 95 },
      climb(95, 110, "1", 7.5, 1800),
      { kind: "descent", from_km: 110, to_km: 125, technicality: 2 },
      { kind: "flat", from_km: 125, to_km: 145 },
      climb(145, 160, "HC", 8, 2000),
    ],
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 160 }],
  },
  hilly: {
    distance_km: 175,
    profile_type: "hilly",
    finale_type: "reduced_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 45 },
      climb(45, 50, "3", 6, 600),
      { kind: "descent", from_km: 50, to_km: 58, technicality: 2 },
      { kind: "rolling", from_km: 58, to_km: 100 },
      climb(100, 106, "2", 7, 900),
      { kind: "descent", from_km: 106, to_km: 114, technicality: 2 },
      { kind: "rolling", from_km: 114, to_km: 168 },
      climb(168, 175, "3", 5.5, 700),
    ],
    weather: { kind: "sun", wind_exposure: 0.3 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 175 }],
  },
};

const SEEDS = ["6185-pin-a", "6185-pin-b", "6185-pin-c"];

function stage(routeName: keyof typeof ROUTES, revision: RulesRevision, seed: string): StageOutput {
  const input: StageInput = { route: ROUTES[routeName], startlist: field(), orders: [], seed, tuning: RACE_V4_TUNING, rules_revision: revision };
  return simulateStageV4(input);
}

function digestOf(output: StageOutput): string {
  // Afrundet til 1e-6 foer hash (samme grund som segmentLoop.timeModel6199.test.ts).
  const quantized = JSON.stringify(output, (_k, v) =>
    typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);
  return createHash("sha256").update(quantized).digest("hex").slice(0, 24);
}

// Fastfrosset mod koden FOER #6234/#6185 del 2 (main cbeb70c65).
const PINNED_PRE_6234: Record<string, string> = {
  "mountain/6185-pin-a/legacy": "b19588f5a20461918ea68f31",
  "mountain/6185-pin-a/orders_gc_v1": "ab7e30c0e7dd012460dee93e",
  "mountain/6185-pin-a/orders_gc_v2": "f3b67f3ee035e8f271054f2f",
  "mountain/6185-pin-b/legacy": "2646f69fe0ec5fdbaefd47f8",
  "mountain/6185-pin-b/orders_gc_v1": "a10142c9b752ca39b0cdfc82",
  "mountain/6185-pin-b/orders_gc_v2": "81a217e14a8dce301ef7312b",
  "mountain/6185-pin-c/legacy": "2361a9cf81ed7daadebc0524",
  "mountain/6185-pin-c/orders_gc_v1": "b91e055296b1395e95712215",
  "mountain/6185-pin-c/orders_gc_v2": "12da82c852c1ddc4937d1391",
  "hilly/6185-pin-a/legacy": "ce36b8c9d8f0cadea1d8e5d9",
  "hilly/6185-pin-a/orders_gc_v1": "b0fd5ae1a074e6a9c147eceb",
  "hilly/6185-pin-a/orders_gc_v2": "bb0428130081a7bcee3739b2",
  "hilly/6185-pin-b/legacy": "dcaf542dbccdab730c2798e4",
  "hilly/6185-pin-b/orders_gc_v1": "c58ee9e4311427728d62683a",
  "hilly/6185-pin-b/orders_gc_v2": "9c103121b611e5064d7ee895",
  "hilly/6185-pin-c/legacy": "b8e75b66d9dba10ca36a3b4f",
  "hilly/6185-pin-c/orders_gc_v1": "120e44fce73dd05110d37111",
  "hilly/6185-pin-c/orders_gc_v2": "d4a94e61b4280adb3b8c5bcd",
};

test("#6234/#6185 v3 slukket: legacy/v1/v2 giver en byte-identisk etape med koden foer aendringen (fastfrosset digest)", () => {
  const actual: Record<string, string> = {};
  for (const routeName of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
    for (const seed of SEEDS) {
      for (const revision of ["legacy", "orders_gc_v1", "orders_gc_v2"] as RulesRevision[]) {
        actual[`${routeName}/${seed}/${revision}`] = digestOf(stage(routeName, revision, seed));
      }
    }
  }
  if (process.env.PRINT_PINS_6234) console.log(JSON.stringify(actual, null, 2));
  assert.deepEqual(actual, PINNED_PRE_6234);
});
