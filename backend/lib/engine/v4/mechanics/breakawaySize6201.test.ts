// backend/lib/engine/v4/mechanics/breakawaySize6201.test.ts
// #6201 (ejer-beslutning 5/10): udbruddets stoerrelse foelger etapens profil,
// AI-hold uden klassementschance sender en klatrer paa bjerg, og farten foelger
// antallet. Alt gaelder KUN under orders_gc_v3.
//
// Laasen nedenfor koerer hele etapen gennem simulateStageV4 med alle live-hooks
// og AI-ordrer bygget gennem prod-adapterens vej (buildStageOrderPlan), og
// sammenligner en digest af StageOutput med en vaerdi fastfrosset mod koden
// FOER #6201 (main paa cbeb70c65). Tre ruter (flad, kuperet, bjerg) rammer
// dannelsen, AI-ordren og udbruddets fart. Giver en af dem en anden digest for
// legacy, orders_gc_v1 eller orders_gc_v2, er det et laek ud af v3. Aendrer en
// LEGITIM senere aendring etapen, opdateres tallene sammen med den.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { simulateStageV4 } from "../index.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { isOrdersGcV2OrLater } from "../../../raceEngineRulesRevision.ts";
import type { AbilityKey, Entrant, RiderRole, RouteV2, RulesRevision, Segment, StageInput } from "../types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

const ROLES: RiderRole[] = ["captain", "helper", "helper", "helper", "hunter", "free_role"];

/** 12 hold a 6 ryttere med spredte evner (deterministisk, ingen rng). Hold 0-7 er AI, 8-11 menneskehold uden ordre. */
function field(): Array<Entrant & { is_ai: boolean }> {
  const out: Array<Entrant & { is_ai: boolean }> = [];
  for (let team = 0; team < 12; team++) {
    for (let r = 0; r < ROLES.length; r++) {
      const i = team * ROLES.length + r;
      const abilities = {} as Record<AbilityKey, number>;
      ABILITY_KEYS.forEach((key, k) => {
        abilities[key] = 15 + ((i * 37 + k * 23 + team * 11) % 80);
      });
      out.push({ rider_id: `t${team}r${r}`, abilities, role: ROLES[r], effort: "normal", condition: 1, team_id: `T${team}`, is_ai: team < 8 });
    }
  }
  return out;
}

function climb(fromKm: number, toKm: number, category: "HC" | "1" | "2" | "3" | "4", gradient: number, topM: number): Segment {
  return { kind: "climb", from_km: fromKm, to_km: toKm, category, avg_gradient: gradient, top_elevation_m: topM };
}

export const ROUTES: Record<"flat" | "hilly" | "mountain", RouteV2> = {
  flat: {
    distance_km: 180,
    profile_type: "flat",
    finale_type: "bunch_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 90 },
      { kind: "rolling", from_km: 90, to_km: 120 },
      { kind: "flat", from_km: 120, to_km: 180 },
    ],
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 180 }],
  },
  hilly: {
    distance_km: 170,
    profile_type: "hilly",
    finale_type: "reduced_sprint",
    segments: [
      { kind: "flat", from_km: 0, to_km: 50 },
      climb(50, 54, "3", 5, 500),
      { kind: "descent", from_km: 54, to_km: 60, technicality: 2 },
      { kind: "rolling", from_km: 60, to_km: 110 },
      climb(110, 114, "2", 6.5, 800),
      { kind: "descent", from_km: 114, to_km: 120, technicality: 3 },
      { kind: "rolling", from_km: 120, to_km: 170 },
    ],
    weather: { kind: "sun", wind_exposure: 0.3 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 170 }],
  },
  mountain: {
    distance_km: 160,
    profile_type: "mountain",
    finale_type: "long_climb",
    segments: [
      { kind: "flat", from_km: 0, to_km: 60 },
      climb(60, 72, "1", 7, 1700),
      { kind: "descent", from_km: 72, to_km: 85, technicality: 2 },
      { kind: "rolling", from_km: 85, to_km: 145 },
      climb(145, 160, "HC", 8, 2100),
    ],
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 160 }],
  },
};

/** Etapens input som prod-broen bygger det: AI-holdenes ordrer (og indsats) fra M14 under revisionen. */
export function stageInput(routeName: keyof typeof ROUTES, revision: RulesRevision, seed: string): StageInput {
  const route = ROUTES[routeName];
  const riders = field();
  const plan = buildStageOrderPlan({
    rows: [],
    stageNumber: 1,
    roster: riders.map((r) => ({ team_id: r.team_id as string, rider_id: r.rider_id, role: r.role, is_ai: r.is_ai, abilities: r.abilities })),
    context: {
      route: { profile_type: route.profile_type, finale_type: route.finale_type },
      race: { is_stage_race: true, later_stages: [] },
      ...(isOrdersGcV2OrLater(revision) ? { rules_revision: revision } : {}),
    },
  });
  const startlist: Entrant[] = riders.map(({ is_ai: _ai, ...e }) => ({ ...e, effort: plan.aiEffortByRider.get(e.rider_id) ?? e.effort }));
  return { route, startlist, orders: plan.orders, seed, tuning: RACE_V4_TUNING, rules_revision: revision };
}

function stageDigest(routeName: keyof typeof ROUTES, revision: RulesRevision, seed: string): string {
  // Afrundet til 1e-6 foer hash (samme grund som segmentLoop.timeModel6199.test.ts:
  // Linux og Windows kan afvige paa sidste bit i Math.cos/log).
  const quantized = JSON.stringify(simulateStageV4(stageInput(routeName, revision, seed)), (_k, v) =>
    typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v);
  return createHash("sha256").update(quantized).digest("hex").slice(0, 24);
}

const SEEDS = ["6201-pin-a", "6201-pin-b"];

// Fastfrosset mod koden FOER #6201 (main cbeb70c65).
const PINNED_PRE_6201: Record<string, string> = {
  "flat/6201-pin-a/legacy": "6f086d048dc87c1949963405",
  "flat/6201-pin-a/orders_gc_v1": "1a601a7872ac2bc3edbff5e3",
  "flat/6201-pin-a/orders_gc_v2": "80c2e9b83f736fd351e7c253",
  "flat/6201-pin-b/legacy": "66471c497f7176b5d8cac85e",
  "flat/6201-pin-b/orders_gc_v1": "4cd919f8e4e73e9f7384a311",
  "flat/6201-pin-b/orders_gc_v2": "3200d69ecc91d800c5cfbd47",
  "hilly/6201-pin-a/legacy": "fd577134b896bc2e3bb47b80",
  "hilly/6201-pin-a/orders_gc_v1": "01093a90dcdf0066ce3596f8",
  "hilly/6201-pin-a/orders_gc_v2": "2c80b2833b71dfd781e596cd",
  "hilly/6201-pin-b/legacy": "9a94d01b16268b009c2161db",
  "hilly/6201-pin-b/orders_gc_v1": "f199859ac3f65b375462f660",
  "hilly/6201-pin-b/orders_gc_v2": "4c276aab702b9a25a909cfec",
  "mountain/6201-pin-a/legacy": "75f3efe7c91951e0b07211a9",
  "mountain/6201-pin-a/orders_gc_v1": "5d6973a93e230c098acbe2b2",
  "mountain/6201-pin-a/orders_gc_v2": "996d12be3c0028e7b37199a6",
  "mountain/6201-pin-b/legacy": "11ac2f3b94aac32b1e82a7ca",
  "mountain/6201-pin-b/orders_gc_v1": "c19d725791a6d2a3f525f8f2",
  "mountain/6201-pin-b/orders_gc_v2": "1efa5d064817cb8516743f92",
};

test("#6201 v3 slukket: legacy/v1/v2 giver en byte-identisk etape med koden foer #6201 (fastfrosset digest)", () => {
  const actual: Record<string, string> = {};
  for (const routeName of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
    for (const seed of SEEDS) {
      for (const revision of ["legacy", "orders_gc_v1", "orders_gc_v2"] as RulesRevision[]) {
        actual[`${routeName}/${seed}/${revision}`] = stageDigest(routeName, revision, seed);
      }
    }
  }
  if (process.env.PRINT_6201_PINS) console.log(JSON.stringify(actual, null, 2));
  // Hele tabellen paa een gang, saa en CI-afvigelse viser alle beroerte noegler.
  assert.deepEqual(actual, PINNED_PRE_6201);
});

// orders_gc_v3 paa samme etaper FOER #6201 (main cbeb70c65). Flad er med for
// fuldstaendighedens skyld: dens dannelse er uaendret, men et lille udbrud
// koerer langsommere, saa den kan aendre sig.
const PINNED_V3_PRE_6201: Record<string, string> = {
  "hilly/6201-pin-a/orders_gc_v3": "335bff19e6579829b840d174",
  "hilly/6201-pin-b/orders_gc_v3": "bc2a253254e7c3584698af18",
  "mountain/6201-pin-a/orders_gc_v3": "9ffafdc98317b790c3d6a72d",
  "mountain/6201-pin-b/orders_gc_v3": "dce04f2249b2d18af6beaabb",
};

test("#6201 foelsomhed: kuperet og bjerg under orders_gc_v3 giver en anden etape end foer, ellers beviste digesten intet", () => {
  for (const routeName of ["hilly", "mountain"] as const) {
    const changed = SEEDS.some((seed) => stageDigest(routeName, "orders_gc_v3", seed) !== PINNED_V3_PRE_6201[`${routeName}/${seed}/orders_gc_v3`]);
    assert.ok(changed, `${routeName}: #6201 skal kunne ses under v3`);
  }
});

function morningBreak(routeName: keyof typeof ROUTES, revision: RulesRevision, seed: string): { size: number; attempts: number } {
  const events = simulateStageV4(stageInput(routeName, revision, seed)).timeline.events;
  const formed = events.find((e) => e.type === "breakaway_formed");
  const attempt = events.find((e) => e.type === "breakaway_attempt");
  return {
    size: ((formed?.params?.["rider_ids"] as string[] | undefined) ?? []).length,
    attempts: ((attempt?.params?.["rider_ids"] as string[] | undefined) ?? []).length,
  };
}

test("#6201 orders_gc_v3: udbruddet holder sig under profilens loft (flad 8, kuperet 12, bjerg 16)", () => {
  const caps = { flat: 8, hilly: 12, mountain: 16 } as const;
  for (const routeName of Object.keys(ROUTES) as Array<keyof typeof ROUTES>) {
    for (let i = 0; i < 6; i++) {
      const { size } = morningBreak(routeName, "orders_gc_v3", `6201-cap-${i}`);
      assert.ok(size <= caps[routeName], `${routeName} seed ${i}: ${size} > ${caps[routeName]}`);
    }
  }
});

test("#6201 orders_gc_v3: AI-holdene sender flere forsoeg paa bjerg end under orders_gc_v2 (klatreren fra hold uden klassementschance)", () => {
  let v2 = 0;
  let v3 = 0;
  for (const seed of SEEDS) {
    v2 += morningBreak("mountain", "orders_gc_v2", seed).attempts;
    v3 += morningBreak("mountain", "orders_gc_v3", seed).attempts;
  }
  assert.ok(v3 > v2, `v3 ${v3} <= v2 ${v2}`);
});
