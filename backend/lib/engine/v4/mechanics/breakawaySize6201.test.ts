// backend/lib/engine/v4/mechanics/breakawaySize6201.test.ts
// #6201 (ejer-beslutning 5/10): udbruddets stoerrelse foelger etapens profil,
// AI-hold uden klassementschance sender en klatrer paa bjerg, og farten foelger
// antallet. Alt gaelder KUN under orders_gc_v3.
//
// Laasen nedenfor koerer hele etapen gennem simulateStageV4 med alle live-hooks
// og AI-ordrer bygget gennem prod-adapterens vej (buildStageOrderPlan), og
// sammenligner en digest af StageOutput med en vaerdi fastfrosset mod koden
// FOER #6201 (main efter #6253, 093a3b1ec). Tre ruter (flad, kuperet, bjerg) rammer
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
import { readFileSync } from "node:fs";
import { morningBreakIntent, resolveMorningBreakFormation } from "./breakawayPermission.ts";
import { generateAiTeamOrder } from "../ai/aiTactics.ts";
import type { AiRosterEntrant, AiTacticsInput } from "../ai/aiTactics.ts";
import { __resetRaceEngineV4Cache, loadRaceEngineV4 } from "../../../raceEngineV4Bridge.js";
import { TOUR_BENCHMARKS, breakawayAttempts, breakawaySets, profileClass, runStagesInOrder } from "../../../../scripts/dev/lib/tourScorecard.mjs";

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

// Fastfrosset mod koden FOER #6201 (main 093a3b1ec; v1/v2-fastfrysningen er uaendret siden cbeb70c65).
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

// orders_gc_v3 paa samme etaper FOER #6201, men EFTER #6253 (tidsmodellen):
// beregnet paa main 093a3b1ec, som har #6253 men ikke #6201. Fladt er med
// for fuldstaendighedens skyld: dens dannelse er uaendret, men et lille
// udbrud koerer langsommere, saa den kan aendre sig.
const PINNED_V3_PRE_6201: Record<string, string> = {
  "flat/6201-pin-a/orders_gc_v3": "80c2e9b83f736fd351e7c253",
  "flat/6201-pin-b/orders_gc_v3": "3200d69ecc91d800c5cfbd47",
  "hilly/6201-pin-a/orders_gc_v3": "1b77bf8ecee12e677114a701",
  "hilly/6201-pin-b/orders_gc_v3": "355a2c2f6d43389a872c1874",
  "mountain/6201-pin-a/orders_gc_v3": "4f9ab37d122ead93affbcf1e",
  "mountain/6201-pin-b/orders_gc_v3": "7456dfe9055d5bd61d322c48",
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

// ── Ren revision spor 1 (official_times_v3): R1-R3 + ejer-valg B (10/10) ──────

test("#6201 R1: scorecardet doemmer udbruddets stoerrelse mod ejerens trappe", () => {
  const b = TOUR_BENCHMARKS.breakawaySize.byClass;
  assert.deepEqual({ min: b.flat.min, max: b.flat.max }, { min: 3, max: 6 });
  assert.deepEqual({ min: b.hilly.min, max: b.hilly.max }, { min: 5, max: 9 });
  assert.deepEqual({ min: b.mountain.min, max: b.mountain.max }, { min: 6, max: 12 });
  for (const cls of ["flat", "hilly", "mountain"] as const) assert.equal(b[cls].status, "ejer");
  for (const p of ["hilly", "rolling"]) assert.equal(profileClass(p), "hilly");
  for (const p of ["mountain", "high_mountain"]) assert.equal(profileClass(p), "mountain");
  const out = { timeline: { events: [{ type: "breakaway_attempt", params: { rider_ids: ["a", "b", "c"] } }] } };
  assert.equal(breakawayAttempts(out), 3);
});

test("#6201 ejer-valg B: hunter og fri rolle forsoeger uden ordre; hjaelper og kaptajner aldrig uden ordre; en ordre vinder altid", () => {
  const intent = (role: string, tryBreak: boolean | undefined, effort = "normal") => morningBreakIntent({ role, effort, tryBreak });
  assert.equal(intent("hunter", undefined), "ordered");
  assert.equal(intent("free_role", undefined), "spontaneous");
  assert.equal(intent("helper", undefined), "none");
  assert.equal(intent("captain", undefined), "none");
  assert.equal(intent("sprint_captain", undefined), "none");
  // Managerens eksplicitte ordre vinder begge veje.
  assert.equal(intent("captain", true), "ordered");
  assert.equal(intent("sprint_captain", true), "ordered");
  assert.equal(intent("helper", true), "ordered");
  assert.equal(intent("hunter", false), "none");
  assert.equal(intent("free_role", true), "ordered");
});

test("#6201 R3: et farligt forsoeg fylder ikke i traengslen for de andre (KUN med flaget), modstanden mod ham er uaendret", () => {
  const rider = (id: string, team: string, role = "hunter") => ({ rider_id: id, team_id: team, role, effort: "normal", tryBreak: undefined, strength: 0.5, spontaneousChance: 0, engine: 0.5, freshness: 1 });
  // 6 forsoeg fra 6 hold, room 4: overfyldt. r0 er farlig for hold X (der har arbejdere i feltet).
  const riders = [...Array.from({ length: 6 }, (_, i) => rider(`r${i}`, `T${i}`)), rider("x1", "X", "helper"), rider("x2", "X", "helper")];
  const size = { maxSize: 12, room: 4, successBonus: 0, roomCrowdWeight: 0.7 };
  let strictlyMore = false;
  for (let k = 1; k < 40; k++) {
    const r = k / 40;
    const roll = (_s: "attempt" | "success", id: string) => (id === "r0" ? 0.99 : r);
    const base = { riders, stances: new Map<string, "chase" | "neutral" | "let_go">(), roll, maxSize: 12, sizeProfile: size, dangerTeams: (id: string) => (id === "r0" ? ["X"] : []) };
    const without = resolveMorningBreakFormation(base);
    const withFlag = resolveMorningBreakFormation({ ...base, dangerousOutsideRoom: true });
    assert.ok(!withFlag.escaped.includes("r0"));
    // Aldrig faerre, og for nogle lodtraekninger flere: hans forsoeg fylder ikke for de andre.
    assert.ok(withFlag.escaped.length >= without.escaped.length, `rul ${r}: ${withFlag.escaped.length} < ${without.escaped.length}`);
    if (withFlag.escaped.length > without.escaped.length) strictlyMore = true;
    // Prisen for det farlige forsoeg er den samme (haardere modstand mod ham beholdes).
    assert.equal(withFlag.attemptCost.get("r0"), without.attemptCost.get("r0"));
  }
  assert.ok(strictlyMore, "flaget skal kunne ses");
});

const AI_ROSTER = (team: number): AiRosterEntrant[] => ROLES.map((role, r) => {
  const i = team * ROLES.length + r;
  const abilities = {} as Record<AbilityKey, number>;
  ABILITY_KEYS.forEach((key, k) => { abilities[key] = 15 + ((i * 37 + k * 23 + team * 11) % 80); });
  return { rider_id: `t${team}r${r}`, role: (role === "hunter" || role === "free_role" ? "helper" : role) as RiderRole, abilities };
});

test("#6201 R2a: official_times_v3 - et AI-hold uden klassementschance sender flere paa kuperet og bjerg end official_times_v2", () => {
  const field = Array.from({ length: 12 }, (_, t) => AI_ROSTER(t)).flat();
  const count = (profile: RouteV2["profile_type"], finale: RouteV2["finale_type"], revision: string) => {
    let n = 0;
    for (let t = 0; t < 12; t++) {
      const input: AiTacticsInput = { team_id: `T${t}`, route: { profile_type: profile, finale_type: finale }, roster: AI_ROSTER(t), field, race: { is_stage_race: true, later_stages: [] }, rules_revision: revision };
      const decision = generateAiTeamOrder(input);
      if (decision.order.breakaway_stance === "chase") continue;
      const tryBreak = decision.order.riders.filter((r) => r.try_break);
      // Aldrig kaptajn eller grupetto.
      for (const r of tryBreak) {
        const role = AI_ROSTER(t).find((x) => x.rider_id === r.rider_id)?.role;
        assert.ok(role !== "captain" && role !== "sprint_captain" && r.effort !== "grupetto", `${r.rider_id} (${role})`);
      }
      n += tryBreak.length;
    }
    return n;
  };
  for (const [profile, finale] of [["hilly", "breakaway"], ["rolling", "breakaway"], ["mountain", "long_climb"]] as const) {
    const v2 = count(profile, finale, "official_times_v2");
    const v3 = count(profile, finale, "official_times_v3");
    assert.ok(v3 > v2, `${profile}: v3 ${v3} <= v2 ${v2}`);
  }
  // Flad: uaendret.
  assert.equal(count("flat", "bunch_sprint", "official_times_v3"), count("flat", "bunch_sprint", "official_times_v2"));
});

test("#6201 trappen: official_times_v3 paa Giro-feltet - medianen pr. profil ligger i ejerens trappe (flad 3-6, kuperet/rullende 5-9, bjerg/hoejfjeld 6-12)", async () => {
  const data = JSON.parse(readFileSync(new URL("../../../../scripts/baselines/giro-field-6088-2026-10-02.json", import.meta.url), "utf8"));
  __resetRaceEngineV4Cache();
  const v4 = await loadRaceEngineV4();
  const sizes: Record<string, number[]> = {};
  for (let seed = 1; seed <= 3; seed++) {
    runStagesInOrder({
      v4, data, revision: "official_times_v3", seedTag: `staircase-${seed}`,
      onStage: ({ profile, res }: { profile: { profile_type: string }; res: { v4Output: unknown } }) => {
        if (["itt", "itt_hilly", "ttt"].includes(profile.profile_type)) return;
        const cls = profileClass(profile.profile_type);
        (sizes[cls] ??= []).push(breakawaySets(res.v4Output).formed.size);
      },
    });
  }
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  for (const [cls, xs] of Object.entries(sizes)) {
    const band = TOUR_BENCHMARKS.breakawaySize.byClass[cls as "flat" | "hilly" | "mountain"];
    const m = med(xs);
    assert.ok(m >= band.min && m <= band.max, `${cls}: median ${m} uden for ${band.min}-${band.max}`);
  }
});
