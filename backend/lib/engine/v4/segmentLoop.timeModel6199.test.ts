// backend/lib/engine/v4/segmentLoop.timeModel6199.test.ts
// #6199 + #6200 (review af #6223, punkt e): den faelles tidsmodel gaelder KUN
// under orders_gc_v3. Laasen her koerer hele etapen gennem simulateStageV4 med
// alle live-hooks og sammenligner en digest af StageOutput med en vaerdi der er
// fastfrosset mod koden FOER #6223 (main paa c25caf905). To ruter rammer alle
// de steder tidsmodellen roerer:
//   - "descent_finish": to kat. 1/HC-stigninger, en teknisk nedkoersel midt paa
//     etapen, dal bagefter og en teknisk nedkoersel til maal (regruppering,
//     nedkoerselsangreb, udbrudsjagt og finalens jagt paa sidste segment);
//   - "rolling": rullende etape med smaa stigninger, nedkoersler og dale og maal
//     paa en kat. 3 (bloed selektion, dal-reglen, kort afslutning opad).
// Giver en af dem en anden digest for legacy, orders_gc_v1 eller orders_gc_v2,
// er det et laek ud af v3. Aendrer en LEGITIM senere aendring etapen,
// opdateres tallene sammen med den.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { simulateStageV4 } from "./index.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, RiderRole, RouteV2, RulesRevision, Segment, StageInput } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

/** 8 hold a 5 ryttere med spredte evner (deterministisk, ingen rng), saa nedkoerselsangreb og splits opstaar. */
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

const ROUTES: Record<"descent_finish" | "rolling", RouteV2> = {
  descent_finish: {
    distance_km: 150,
    profile_type: "mountain",
    finale_type: "descent",
    segments: [
      { kind: "flat", from_km: 0, to_km: 60 },
      climb(60, 72, "1", 7, 1700),
      { kind: "descent", from_km: 72, to_km: 85, technicality: 2 },
      { kind: "rolling", from_km: 85, to_km: 110 },
      climb(110, 125, "HC", 8, 2100),
      { kind: "descent", from_km: 125, to_km: 150, technicality: 3 },
    ],
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 150 }],
  },
  rolling: {
    distance_km: 170,
    profile_type: "rolling",
    finale_type: "reduced_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 50 },
      climb(50, 54, "3", 5, 500),
      { kind: "descent", from_km: 54, to_km: 60, technicality: 2 },
      { kind: "rolling", from_km: 60, to_km: 110 },
      climb(110, 114, "2", 6.5, 800),
      { kind: "descent", from_km: 114, to_km: 120, technicality: 3 },
      { kind: "rolling", from_km: 120, to_km: 165 },
      climb(165, 170, "3", 5.8, 720),
    ],
    weather: { kind: "rain", wind_exposure: 0.3 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 170 }],
  },
};

function stageDigest(routeName: keyof typeof ROUTES, revision: RulesRevision, seed: string): string {
  const input: StageInput = { route: ROUTES[routeName], startlist: field(), orders: [], seed, tuning: RACE_V4_TUNING, rules_revision: revision };
  // Afrundet til 1e-6 foer hash: Linux (glibc) og Windows kan afvige paa sidste bit i Math.cos/log
  // (rng.ts), saa en raa digest lavet paa Windows fejlede i CI uden at motoren var aendret (6/10).
  const quantized = JSON.stringify(simulateStageV4(input), (_k, v) =>
    typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);
  return createHash("sha256").update(quantized).digest("hex").slice(0, 24);
}

const SEEDS = ["6199-pin-a", "6199-pin-b"];

// Fastfrosset mod koden FOER #6223 (main c25caf905, engine-filerne lagt midlertidigt ind).
// Paa den kode gav orders_gc_v3 samme digest som orders_gc_v2 paa alle fire
// (feltet har intet klassement og ingen spar-hjaelpere, saa #6187 og #3460 er
// inaktive); forskellen under v3 er derfor tidsmodellens.
const PINNED_PRE_6223: Record<string, string> = {
  "descent_finish/6199-pin-a/legacy": "4ea54e74c93f1cafbf2f11c5",
  "descent_finish/6199-pin-a/orders_gc_v1": "922a0ae0f4774304f763ca84",
  "descent_finish/6199-pin-a/orders_gc_v2": "d1f6caeedcf09a80f7b11364",
  "descent_finish/6199-pin-b/legacy": "1933aa55ea45e2eec661be43",
  "descent_finish/6199-pin-b/orders_gc_v1": "29df7986ac17d3bc770c4a8e",
  "descent_finish/6199-pin-b/orders_gc_v2": "3ce78d7971ad467aaf287e62",
  "rolling/6199-pin-a/legacy": "611acdf6c6bbacaf050baa37",
  "rolling/6199-pin-a/orders_gc_v1": "195535f8d169b19e13db2988",
  "rolling/6199-pin-a/orders_gc_v2": "195535f8d169b19e13db2988",
  "rolling/6199-pin-b/legacy": "dde6bb8fba67716cebe23abd",
  "rolling/6199-pin-b/orders_gc_v1": "31e250b9da048b4ccbfe6326",
  "rolling/6199-pin-b/orders_gc_v2": "31e250b9da048b4ccbfe6326",
};

test("#6199/#6200 v3 slukket: legacy/v1/v2 giver en byte-identisk etape med koden foer #6223 (fastfrosset digest)", () => {
  const actual: Record<string, string> = {};
  for (const routeName of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
    for (const seed of SEEDS) {
      for (const revision of ["legacy", "orders_gc_v1", "orders_gc_v2"] as RulesRevision[]) {
        const key = `${routeName}/${seed}/${revision}`;
        actual[key] = stageDigest(routeName, revision, seed);
      }
    }
  }
  // Hele tabellen paa een gang, saa en CI-afvigelse viser alle beroerte noegler.
  assert.deepEqual(actual, PINNED_PRE_6223);
});

test("#6199/#6200 foelsomhed: samme etaper under orders_gc_v3 giver en anden etape, ellers beviste digesten intet", () => {
  for (const routeName of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
    const changed = SEEDS.some((seed) => stageDigest(routeName, "orders_gc_v3", seed) !== PINNED_PRE_6223[`${routeName}/${seed}/orders_gc_v2`]);
    assert.ok(changed, `${routeName}: v3 skal kunne ses`);
  }
});
