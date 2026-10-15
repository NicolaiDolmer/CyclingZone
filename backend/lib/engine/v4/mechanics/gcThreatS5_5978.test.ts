// backend/lib/engine/v4/mechanics/gcThreatS5_5978.test.ts
// #5978 (ejer 15/10): S5-trusselsmodellen (KUN s5_profiles_v1). Farlige
// klassementsryttere faar kortere snor, rivalerne jager haardere jo farligere de
// er, og foerste etape faar en reaktion (alle staar lige). Syntetiske ryttere;
// testene laaser strukturelle invarianter (monotoni, revisionsgraense, S4
// bit-identisk), ikke kalibrerede tal (de ligger i balance-internals/5978/).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessGcThreat,
  dangerOf,
  formationDangerTeams,
  isS5ThreatModel,
  normalizeGcContext,
  protectedRiderForTeam,
  S5_GC_THREAT_TUNING,
  V3_DANGER_TUNING,
  type DangerModel,
  type FormationDangerTeams,
  type GcThreat,
} from "./gcThreat.ts";
import { dangerScaledIntensity, planTeamReaction, TEAM_REACTION_TUNING } from "./teamChaseReaction.ts";
import { resolveMorningBreakFormation, type FormationRider } from "./breakawayPermission.ts";
import { rankedFormationPressure } from "./breakaway.ts";
import { SHARED_TIME_MODEL_V2_TUNING } from "./timeModel.ts";
import { buildGcContext, buildV4StageInput as buildV4StageInputJs, withS5ThreatModel } from "../../../raceEngineV4Bridge.js";
import type { AbilityKey, Entrant, GcContext, RaceGroup, RouteV2 } from "../types.ts";

// Broens JSDoc kender ikke rulesRevision/gcStandings eller gc_context paa svaret; testen kalder den raat.
const buildV4StageInput = buildV4StageInputJs as unknown as (args: Record<string, unknown>) => { gc_context: any };

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
function abilities(level: number): Record<AbilityKey, number> {
  return Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>;
}
function entrant(id: string, team: string, level: number, role: Entrant["role"] = "helper"): Entrant {
  return { rider_id: id, abilities: abilities(level), role, effort: "normal", condition: 1, team_id: team };
}

const MOUNTAIN: RouteV2 = {
  distance_km: 150, profile_type: "mountain", finale_type: "long_climb",
  segments: [
    { kind: "flat", from_km: 0, to_km: 100 },
    { kind: "climb", from_km: 100, to_km: 150, category: "HC", avg_gradient: 7, top_elevation_m: 2000 },
  ],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

// Hold A har kaptajnen; tre udbrydere med faldende styrke; et svagt hold uden kandidat.
const ENTRANTS: Record<string, Entrant> = {
  cap: entrant("cap", "A", 80, "captain"),
  aHelp: entrant("aHelp", "A", 60),
  equal: entrant("equal", "B", 80, "hunter"),
  near: entrant("near", "C", 78, "hunter"),
  weak: entrant("weak", "D", 60, "hunter"),
  ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, entrant(`f${i}`, `F${i % 6}`, 50)])),
  low: entrant("low", "Z", 40, "captain"),
};
const STARTERS = Object.keys(ENTRANTS);

/** Foerste etape som broen bygger den under s5_profiles_v1. */
const FIRST_S5 = normalizeGcContext(withS5ThreatModel(buildGcContext({ isStageRace: true, stageNumber: 1, standings: [], starterIds: STARTERS }), STARTERS.map((rider_id) => ({ rider_id }))));
const MODEL: DangerModel = { stagesRemaining: 4, tuning: V3_DANGER_TUNING };

function breakGroups(breakaway: string[], lead: number): RaceGroup[] {
  const rest = STARTERS.filter((id) => !breakaway.includes(id));
  return [
    { id: "breakaway-0", kind: "breakaway", rider_ids: breakaway, gap_seconds: 0, cohesion: 1 },
    { id: "peloton-0", kind: "peloton", rider_ids: rest, gap_seconds: lead, cohesion: 1 },
  ];
}

const assess = (gcContext: GcContext, breakaway: string[], lead: number, protectedRiderId = "cap", model: DangerModel | undefined = MODEL): GcThreat =>
  assessGcThreat({ gcContext, groups: breakGroups(breakaway, lead), entrants: ENTRANTS, route: MOUNTAIN, protectedRiderId, km: 20, ownTeamId: ENTRANTS[protectedRiderId].team_id ?? undefined, skipOwnRiderGroups: true, ...(model ? { dangerModel: model } : {}) });

// ── Broen og konteksten ─────────────────────────────────────────────────────

test("#5978 bro: foerste etape under S5 bliver et klassement hvor alle staar lige, uden foerer", () => {
  const raw = withS5ThreatModel({ status: "first_stage", stage_number: 1 }, [{ rider_id: "a" }, { rider_id: "b" }]);
  assert.deepEqual(raw, {
    status: "standings", stage_number: 1, leader_id: null, threat_model: "s5", first_stage: true,
    standings: [{ rider_id: "a", rank: 1, gap_seconds: 0 }, { rider_id: "b", rank: 1, gap_seconds: 0 }],
  });
  const ctx = normalizeGcContext(raw);
  assert.equal(ctx.status, "standings");
  assert.equal(ctx.status === "standings" ? ctx.leader_id : "x", null);
  assert.equal(isS5ThreatModel(ctx), true);
});

test("#5978 bro: et klassement faar kun maerket; endagsloeb og manglende data er uaendrede", () => {
  const standings = { status: "standings", stage_number: 3, leader_id: "a", standings: [{ rider_id: "a", rank: 1, gap_seconds: 0 }] };
  assert.deepEqual(withS5ThreatModel(standings, []), { ...standings, threat_model: "s5" });
  const oneDay = { status: "one_day" };
  assert.equal(withS5ThreatModel(oneDay, [{ rider_id: "a" }]), oneDay);
  const missing = { status: "missing", stage_number: 2 };
  assert.equal(withS5ThreatModel(missing, [{ rider_id: "a" }]), missing);
});

test("#5978 bro: kun s5_profiles_v1 baerer maerket; official_times_v4 (S4) er uaendret", () => {
  const modules = {
    route: { routeFromStageProfileRow: () => ({ distance_km: 10, segments: [], waypoints: [] }) },
    entrants: { entrantFromAbilitiesRow: (_row: unknown, opts: { riderId: string; condition: number }) => ({ rider_id: opts.riderId, condition: opts.condition }) },
    tuning: { RACE_V4_TUNING: {} },
    orders: { buildStageOrderPlan: () => ({ orders: [], aiEffortByRider: new Map() }) },
  };
  const entrants = [
    { rider_id: "a", team_id: "T1", race_role: "captain", abilities: {}, fatigue: 0 },
    { rider_id: "b", team_id: "T2", race_role: "captain", abilities: {}, fatigue: 0 },
  ];
  const raceStages = [1, 2, 3].map((n) => ({ stage_number: n }));
  const args = { modules, entrants, stageProfile: { stage_number: 1 }, seedString: "race:1", stageNumber: 1, isStageRace: true, raceStages, gcStandings: [] };
  assert.deepEqual(buildV4StageInput({ ...args, rulesRevision: "official_times_v4" }).gc_context, { status: "first_stage", stage_number: 1 });
  assert.deepEqual(buildV4StageInput({ ...args, rulesRevision: "s5_profiles_v1" }).gc_context, {
    status: "standings", stage_number: 1, leader_id: null, threat_model: "s5", first_stage: true, stages_remaining: 2,
    standings: [{ rider_id: "a", rank: 1, gap_seconds: 0 }, { rider_id: "b", rank: 1, gap_seconds: 0 }],
  });
  const later = { ...args, stageNumber: 2, gcStandings: [{ rider_id: "b", time: 10 }, { rider_id: "a", time: 25 }] };
  assert.equal("threat_model" in buildV4StageInput({ ...later, rulesRevision: "official_times_v4" }).gc_context, false);
  assert.equal(buildV4StageInput({ ...later, rulesRevision: "s5_profiles_v1" }).gc_context.threat_model, "s5");
});

test("#5978: uden maerke er klassementet praecis som foer (S4 og aeldre)", () => {
  const raw = { status: "standings", stage_number: 3, leader_id: "a", standings: [{ rider_id: "a", rank: 1, gap_seconds: 0 }] };
  const ctx = normalizeGcContext(raw);
  assert.deepEqual(ctx, { status: "standings", stage_number: 3, leader_id: "a", standings: [{ rider_id: "a", rank: 1, gap_seconds: 0 }] });
  assert.equal(isS5ThreatModel(ctx), false);
});

test("#5978: holdets GC-rytter paa samme tid er den bedste paa klassementsevne (kun S5)", () => {
  // Hold A: hjaelperen staar oeverst blandt de lige (rider_id-orden), kaptajnen er staerkere.
  const raw = { status: "standings", stage_number: 1, leader_id: null, standings: [{ rider_id: "aHelp", rank: 1, gap_seconds: 0 }, { rider_id: "cap", rank: 1, gap_seconds: 0 }] };
  assert.equal(protectedRiderForTeam({ gcContext: normalizeGcContext(raw), teamId: "A", entrants: ENTRANTS }), "aHelp");
  assert.equal(protectedRiderForTeam({ gcContext: normalizeGcContext({ ...raw, threat_model: "s5", first_stage: true }), teamId: "A", entrants: ENTRANTS }), "cap");
});

// ── Faren og snoren ─────────────────────────────────────────────────────────

test("#5978: faren er 0 under graensen, 1 ved lige saa staerk, og stiger monotont imellem", () => {
  assert.equal(dangerOf(S5_GC_THREAT_TUNING.dangerFloor - 0.01), 0);
  assert.equal(dangerOf(1), 1);
  assert.equal(dangerOf(1.3), 1);
  let prev = -1;
  for (let r = 0.9; r <= 1.0001; r += 0.005) {
    const d = dangerOf(r);
    assert.ok(d >= prev, `monoton ved ${r}`);
    prev = d;
  }
});

test("#5978 foerste etape: en lige saa staerk rytter i udbruddet er en alvorlig trussel med kortest snor", () => {
  const t = assess(FIRST_S5, ["equal"], 30);
  assert.equal(t.severity, "serious");
  assert.equal(t.danger, 1);
  assert.equal(t.leash_hold, true);
  assert.equal(t.tolerated_lead_seconds, 0);
});

test("#5978 foerste etape: en klart svagere rytter er ingen trussel (feltet lader ham gaa)", () => {
  const t = assess(FIRST_S5, ["weak"], 300);
  assert.equal(t.severity, "none");
  assert.notEqual(t.leash_hold, true);
});

test("#5978 foerste etape: et hold hvis kaptajn ikke er blandt feltets bedste har intet at forsvare", () => {
  const t = assess(FIRST_S5, ["equal"], 300, "low");
  assert.equal(t.severity, "none");
  assert.equal(t.reason, "no_gc_interest");
});

test("#5978: kortere snor jo farligere (samme afstand, samme forspring)", () => {
  const gc = normalizeGcContext({
    status: "standings", stage_number: 3, leader_id: "cap", threat_model: "s5", stages_remaining: 4,
    standings: [["cap", 0], ["equal", 240], ["near", 240], ["weak", 240], ["aHelp", 900]].map(([rider_id, gap], i) => ({ rider_id, rank: i + 1, gap_seconds: gap })),
  });
  const equal = assess(gc, ["equal"], 300);
  const near = assess(gc, ["near"], 300);
  assert.ok(equal.danger !== undefined && near.danger !== undefined);
  assert.ok(equal.danger! > near.danger!, "den staerkere er farligere");
  assert.ok((equal.tolerated_lead_seconds ?? Infinity) < (near.tolerated_lead_seconds ?? Infinity), "og faar kortere snor");
});

test("#5978: samme kontekst uden S5-maerket giver orders_gc_v3-vurderingen (ingen fare-felt)", () => {
  const raw = {
    status: "standings", stage_number: 3, leader_id: "cap", stages_remaining: 4,
    standings: [["cap", 0], ["equal", 240], ["near", 240]].map(([rider_id, gap], i) => ({ rider_id, rank: i + 1, gap_seconds: gap })),
  };
  const plain = assess(normalizeGcContext(raw), ["equal"], 300);
  assert.equal(plain.danger, undefined);
  const s5 = assess(normalizeGcContext({ ...raw, threat_model: "s5" }), ["equal"], 300);
  assert.equal(s5.danger, 1);
});

// ── Jagten og dannelsen ─────────────────────────────────────────────────────

test("#5978: rivalerne jager haardere jo farligere; uden fare er intensiteten uaendret", () => {
  const base: GcThreat = { severity: "moderate", reason: "rival_close", protected_rider_id: "cap", chase_group_id: "peloton-0", threat_rider_ids: ["near"], tied: false };
  const plan = (danger?: number) => planTeamReaction({ prior: undefined, threat: { ...base, ...(danger !== undefined ? { danger } : {}) }, stance: "neutral", availableWorkers: ["aHelp"], leash: true });
  assert.equal(plan().intensity, TEAM_REACTION_TUNING.neutralModerateIntensity);
  assert.equal(plan(0).intensity, TEAM_REACTION_TUNING.neutralModerateIntensity);
  assert.ok(plan(0.5).intensity > plan(0).intensity);
  assert.equal(plan(1).intensity, 1);
  assert.equal(dangerScaledIntensity(0.6, undefined), 0.6);
  // Lad-gaa: undtagelsen er stadig kun for en alvorlig trussel; budgettet er uaendret.
  const letGo = planTeamReaction({ prior: undefined, threat: { ...base, severity: "serious", danger: 1 }, stance: "let_go", availableWorkers: ["aHelp"], leash: true });
  assert.equal(letGo.mode, "preventive");
  assert.equal(letGo.budgetRemaining, TEAM_REACTION_TUNING.preventiveBudget);
});

function formationRider(id: string, team: string, over: Partial<FormationRider> = {}): FormationRider {
  return { rider_id: id, team_id: team, role: "helper", effort: "normal", tryBreak: undefined, strength: 0.5, spontaneousChance: 0, engine: 0.5, freshness: 1, ...over };
}

/** Succes-sandsynligheden for et forsoeg, fundet ved at lade succes-lodtraekningen vandre (deterministisk). */
function successChance(dangerLevel: number | null): number {
  const riders = [
    formationRider("X", "A", { role: "hunter" }),
    ...["B", "C"].flatMap((team) => [formationRider(`${team}-cap`, team, { role: "captain" }), ...[1, 2, 3].map((i) => formationRider(`${team}-h${i}`, team))]),
  ];
  const dangerTeams = (riderId: string) => {
    if (riderId !== "X") return [];
    const list: FormationDangerTeams = ["B", "C"];
    if (dangerLevel !== null) list.danger = new Map([["B", dangerLevel], ["C", dangerLevel]]);
    return list;
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const out = resolveMorningBreakFormation({ riders, stances: new Map(), roll: (stream) => (stream === "attempt" ? 0 : mid), maxSize: 8, dangerTeams });
    if (out.escaped.includes("X")) lo = mid; else hi = mid;
  }
  return lo;
}

test("#5978: et farligt forsoeg moeder haardere modstand jo farligere det er; uden fare-maal som foer", () => {
  const plain = successChance(null);
  const zero = successChance(0);
  const half = successChance(0.5);
  const full = successChance(1);
  assert.ok(Math.abs(plain - zero) < 1e-6, "fare 0 = orders_gc_v3-dannelsen");
  assert.ok(half <= zero && full <= half, "monoton i faren");
  assert.ok(full < zero, "fuld fare er svaerere end ingen");
});

test("#5978 foerste etape: dannelsen kender faren pr. hold (kun S5)", () => {
  const groups = breakGroups([], 0).slice(1);
  const teamIds = [...new Set(STARTERS.map((id) => ENTRANTS[id].team_id!))];
  const list = formationDangerTeams({ gcContext: FIRST_S5, riderId: "equal", teamIds, groups, entrants: ENTRANTS, route: MOUNTAIN, km: 0, dangerModel: MODEL });
  assert.ok(list.includes("A"), "kaptajnens hold forsvarer sig");
  assert.equal(list.danger?.get("A"), 1);
  const plainFirst = normalizeGcContext({ status: "first_stage", stage_number: 1 });
  assert.deepEqual([...formationDangerTeams({ gcContext: plainFirst, riderId: "equal", teamIds, groups, entrants: ENTRANTS, route: MOUNTAIN, km: 0, dangerModel: MODEL })], []);
});

test("#5978 foerste etape: det syntetiske klassement giver ingen rang-vaegt ved dannelsen (kun S5)", () => {
  const danger = SHARED_TIME_MODEL_V2_TUNING.gcDanger!;
  assert.equal(typeof danger.formationRankedPressureWeight, "number", "knappen findes, saa testen rammer vagten");
  assert.deepEqual(rankedFormationPressure(FIRST_S5, danger), {}, "alle staar paa rang 1, men ingen er forrest");
  // Et rigtigt klassement (S4 og S5 fra etape 2) beholder rang-vaegten uaendret.
  const real = normalizeGcContext({
    status: "standings", stage_number: 2, leader_id: "cap",
    standings: STARTERS.map((rider_id, i) => ({ rider_id, rank: i + 1, gap_seconds: i * 10 })),
  });
  const { dangerPressureWeight } = rankedFormationPressure(real, danger);
  assert.ok(dangerPressureWeight);
  assert.equal(dangerPressureWeight(STARTERS[0]), danger.formationRankedPressureWeight);
  const s5Real = normalizeGcContext(withS5ThreatModel(real, STARTERS.map((rider_id) => ({ rider_id }))));
  assert.equal(rankedFormationPressure(s5Real, danger).dangerPressureWeight?.(STARTERS[0]), danger.formationRankedPressureWeight);
});
