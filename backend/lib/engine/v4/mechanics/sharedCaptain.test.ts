// backend/lib/engine/v4/mechanics/sharedCaptain.test.ts
// #5981 (KUN s5_profiles_v3, slukket): delt kaptajn i motoren.
// Garantierne testes som skala-uafhaengige udsagn (som teamPlay.test.ts), aldrig
// som forventede tal: tuning-tallene kalibreres privat (balance-internals/5981/).
// Scenarierne er virkelig cykelsport: to klassementsryttere paa samme hold
// (grand tour med fuld stab), et lille hold, kaptajnen der styrter, og de to
// ledere i hver sin gruppe paa en bjergetape.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CO_CAPTAIN_ROLE,
  SHARED_CAPTAIN_AI_TUNING,
  aiCoCaptainId,
  protectedRoleOrderWithCoCaptain,
  splitLeaderBonus,
} from "./sharedCaptain.ts";
import { buildGroupTeamContexts, protectedRoleOrder, teamPlayHook } from "./teamPlay.ts";
import { morningBreakIntent } from "./breakawayPermission.ts";
import { effortJoinBoost } from "./breakaway.ts";
import { availableReactionWorkers } from "./teamChaseReaction.ts";
import { oneDayProtectedRider } from "./gcThreat.ts";
import { KOM_FAVOURITE_ROLL_OVER_ROLES } from "./bonusSeconds.ts";
import { RIDER_ROLE_VALUES } from "../ai/teamOrderContract.ts";
import { buildStageOrderPlan } from "../orders/teamOrdersAdapter.ts";
import { RACE_V4_TUNING, TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";
import { makeHookCtx } from "../testUtils/makeHookCtx.ts";
import type {
  AbilityKey,
  EffortLevel,
  EngineState,
  Entrant,
  ProfileType,
  RaceGroup,
  RiderRole,
  RiderState,
  RouteV2,
  Segment,
  SegmentHookContext,
} from "../types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilitiesAt(level: number, over: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = level;
  return { ...out, ...over };
}

type Spec = { id: string; role: RiderRole; team?: string; effort?: EffortLevel; status?: RiderState["status"]; group?: string };

function riderState(spec: Spec): RiderState {
  return {
    rider_id: spec.id, group_id: spec.group ?? "g0", cp: 0.5, wprimeMax: 1, wprime: 1, dayform: 0,
    seconds_over_cp: 0, work_norm: 0, incidents: 0, status: spec.status ?? "racing", time_seconds: 0,
  };
}

/** Et felt i én eller flere grupper (spec.group, default "g0"). */
function scene(specs: Spec[], opts: { profile?: ProfileType; v3?: boolean } = {}) {
  const profile = opts.profile ?? "mountain";
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  const groupIds: string[] = [];
  const members = new Map<string, string[]>();
  for (const spec of specs) {
    entrants[spec.id] = { rider_id: spec.id, abilities: abilitiesAt(50), role: spec.role, effort: spec.effort ?? "normal", condition: 1, team_id: spec.team ?? "A" };
    riders[spec.id] = riderState(spec);
    const g = spec.group ?? "g0";
    if (!members.has(g)) { members.set(g, []); groupIds.push(g); }
    members.get(g)!.push(spec.id);
  }
  const groups: RaceGroup[] = groupIds.map((id, i) => ({ id, kind: i === 0 ? "peloton" : "chase", rider_ids: members.get(id)!, gap_seconds: i * 30, cohesion: 1 } as RaceGroup));
  const segment: Segment = { kind: "flat", from_km: 0, to_km: 200 };
  const route: RouteV2 = { distance_km: 200, profile_type: profile, finale_type: null, segments: [segment], weather: { kind: "sun", wind_exposure: 0 }, waypoints: [{ kind: "finish", index: 0, name: "Maal", km: 200 }] } as RouteV2;
  const state: EngineState = { km: 0, groups, riders, virtual_gc: Object.fromEntries(specs.map((s) => [s.id, 0])) };
  const base = makeHookCtx({ segment, segmentIndex: 0, route, entrants, tuning: RACE_V4_TUNING, seed: "shared-captain" });
  const ctx: SegmentHookContext = opts.v3 ? { ...base, s5ProfilesV3: true } : base;
  return { state, ctx };
}

/** CP-faktoren efter ét fuldt etape-segment holdspil. */
function factors(specs: Spec[], opts: { profile?: ProfileType; v3?: boolean } = {}): Record<string, number> {
  const { state, ctx } = scene(specs, opts);
  const out = teamPlayHook(state, ctx);
  return Object.fromEntries(Object.entries(out.state.riders).map(([id, r]) => [id, Number.isFinite(r.team_cp_factor) ? (r.team_cp_factor as number) : 1]));
}

const helpers = (n: number, group?: string): Spec[] => Array.from({ length: n }, (_, i) => ({ id: `h${i}${group ?? ""}`, role: "helper", ...(group ? { group } : {}) }));
const bonusOf = (f: Record<string, number>, id: string) => (f[id] ?? 1) - 1;

// ── Kontrakt ──────────────────────────────────────────────────────────────────

test("#5981: rollen hedder co_captain og er med i ordre-kontraktens vokabular", () => {
  assert.equal(CO_CAPTAIN_ROLE, "co_captain");
  assert.ok(RIDER_ROLE_VALUES.includes("co_captain"));
});

test("#5981: lederraekkefoelgen — flad: spurtkaptajn, kaptajn, delt; ellers kaptajn, delt, spurtkaptajn", () => {
  assert.deepEqual(protectedRoleOrderWithCoCaptain(protectedRoleOrder("flat")), ["sprint_captain", "captain", "co_captain"]);
  assert.deepEqual(protectedRoleOrderWithCoCaptain(protectedRoleOrder("mountain")), ["captain", "co_captain", "sprint_captain"]);
});

test("#5981 splitLeaderBonus: lederens del er uaendret, summen holder sig inden for det holdet betalte", () => {
  for (const fromTeam of [0, 0.001, 0.01, 0.05, 0.2, 1]) {
    for (const ceiling of [0, 0.005, 0.02, 0.1]) {
      const alone = splitLeaderBonus({ fromTeam, leaderCeiling: ceiling, coLeaderCeiling: ceiling, hasCoLeader: false });
      const shared = splitLeaderBonus({ fromTeam, leaderCeiling: ceiling, coLeaderCeiling: ceiling, hasCoLeader: true });
      assert.equal(shared.leader, alone.leader, "kaptajnen faar hjaelpen foerst (ejer-valg 1)");
      assert.equal(alone.coLeader, 0);
      assert.ok(shared.coLeader >= 0 && shared.leader >= 0);
      assert.ok(shared.leader + shared.coLeader <= fromTeam + 1e-12, "bevarelse");
      assert.ok(shared.coLeader <= ceiling + 1e-12, "bounded");
    }
  }
});

// ── Holdspil (M16) ────────────────────────────────────────────────────────────

test("#5981 holdspil: uden v3 er en stray delt kaptajn hverken beskyttet eller betalende (som fri rolle)", () => {
  const withCo = factors([{ id: "cap", role: "captain" }, { id: "co", role: "co_captain" }, ...helpers(7)]);
  const withFree = factors([{ id: "cap", role: "captain" }, { id: "co", role: "free_role" }, ...helpers(7)]);
  assert.deepEqual(withCo, withFree);
  assert.equal(withCo.co, 1);
});

test("#5981 holdspil: et hold uden delt kaptajn er identisk under v3 og uden (byte-identisk holdspil)", () => {
  for (const profile of ["flat", "mountain", "hilly"] as ProfileType[]) {
    const specs: Spec[] = [{ id: "cap", role: "captain" }, { id: "spr", role: "sprint_captain" }, { id: "hun", role: "hunter" }, { id: "fr", role: "free_role" }, ...helpers(5)];
    assert.deepEqual(factors(specs, { profile, v3: true }), factors(specs, { profile }), profile);
  }
});

test("#5981 holdspil: buildGroupTeamContexts uden flaget har samme form som foer (intet coLeaderId-felt)", () => {
  const { state, ctx } = scene([{ id: "cap", role: "captain" }, { id: "co", role: "co_captain" }, ...helpers(3)]);
  const [team] = buildGroupTeamContexts(state.groups[0], ctx.entrants, state.riders, "mountain");
  assert.equal("coLeaderId" in team, false);
  const [v3] = buildGroupTeamContexts(state.groups[0], ctx.entrants, state.riders, "mountain", true);
  assert.equal(v3.leaderId, "cap");
  assert.equal(v3.coLeaderId, "co");
});

test("#5981 grand tour med to klassementsryttere og fuld stab: delt kaptajn bedre end hjaelper, kaptajnen uaendret", () => {
  const coAsHelper = factors([{ id: "cap", role: "captain" }, { id: "co", role: "helper" }, ...helpers(6)], { v3: true });
  const shared = factors([{ id: "cap", role: "captain" }, { id: "co", role: "co_captain" }, ...helpers(6)], { v3: true });
  assert.ok(shared.co > coAsHelper.co, "som delt kaptajn betaler han ikke og faar laeskaerm");
  assert.ok(bonusOf(shared, "co") > 0, "en fuld stab har noget tilovers til den delte kaptajn");
  assert.ok(bonusOf(shared, "co") <= bonusOf(shared, "cap") + 1e-12, "aldrig mere end kaptajnen");
  const capAlone = factors([{ id: "cap", role: "captain" }, ...helpers(6)], { v3: true });
  assert.equal(shared.cap, capAlone.cap, "kaptajnen faar hjaelpen foerst: samme laeskaerm som uden delt kaptajn med samme hjaelpere");
});

test("#5981 lille hold: den delte kaptajn faar mindre end med fuld stab, og kaptajnen er uaendret", () => {
  const small = factors([{ id: "cap", role: "captain" }, { id: "co", role: "co_captain" }, ...helpers(2)], { v3: true });
  const big = factors([{ id: "cap", role: "captain" }, { id: "co", role: "co_captain" }, ...helpers(6)], { v3: true });
  assert.ok(bonusOf(small, "co") <= bonusOf(big, "co"));
  assert.ok(bonusOf(small, "co") < bonusOf(small, "cap") || bonusOf(small, "cap") === 0);
  const capAlone = factors([{ id: "cap", role: "captain" }, ...helpers(2)], { v3: true });
  assert.equal(small.cap, capAlone.cap);
});

test("#5981 bevarelse: kaptajnens og den delte kaptajns samlede laeskaerm overstiger aldrig hjaelpernes pris", () => {
  for (const n of [1, 2, 3, 4, 6, 8]) {
    for (const profile of ["flat", "hilly", "mountain", "high_mountain"] as ProfileType[]) {
      const f = factors([{ id: "cap", role: "captain" }, { id: "co", role: "co_captain" }, ...helpers(n)], { v3: true, profile });
      const paid = Array.from({ length: n }, (_, i) => 1 - f[`h${i}`]).reduce((a, b) => a + b, 0);
      const gained = bonusOf(f, "cap") + bonusOf(f, "co");
      assert.ok(gained <= paid * TEAM_PLAY_EXTRA_TUNING.transferEfficiency + 1e-12, `${profile}/${n}`);
    }
  }
});

test("#5981 kaptajnen styrter (udgaaet): den delte kaptajn faar hele hjaelpen", () => {
  const out = factors([{ id: "cap", role: "captain", status: "abandoned" }, { id: "co", role: "co_captain" }, ...helpers(6)], { v3: true });
  const asCaptain = factors([{ id: "co", role: "captain" }, ...helpers(6)], { v3: true });
  assert.equal(out.co, asCaptain.co);
});

test("#5981 vejen afgoer: de to i hver sin gruppe — hver gruppes hjaelpere koerer for lederen i deres gruppe", () => {
  const specs: Spec[] = [
    { id: "cap", role: "captain", group: "front" }, ...helpers(3, "front"),
    { id: "co", role: "co_captain", group: "back" }, ...helpers(3, "back"),
  ];
  const f = factors(specs, { v3: true });
  assert.ok(bonusOf(f, "cap") > 0 && bonusOf(f, "co") > 0);
  const capOnly = factors([{ id: "cap", role: "captain", group: "front" }, ...helpers(3, "front")], { v3: true });
  assert.equal(f.cap, capOnly.cap, "ingen hjaelper taelles to steder");
  assert.equal(f.co, capOnly.cap, "samme stab giver samme laeskaerm i den anden gruppe");
});

test("#5981 #6321: et hold med kun en spurtkaptajn som leder beskytter ham paa alle profiler", () => {
  for (const profile of ["flat", "mountain"] as ProfileType[]) {
    const f = factors([{ id: "spr", role: "sprint_captain" }, ...helpers(5)], { v3: true, profile });
    assert.ok(bonusOf(f, "spr") > 0, profile);
  }
});

// ── Udbrud, jagt, klassement ─────────────────────────────────────────────────

test("#5981 morgenudbrud: delt kaptajn forsoeger kun med en ordre (som kaptajnen)", () => {
  for (const effort of ["save", "normal", "protect", "all_out"] as EffortLevel[]) {
    assert.equal(morningBreakIntent({ role: "co_captain", effort, tryBreak: false }), "none", effort);
    assert.equal(morningBreakIntent({ role: "co_captain", effort, tryBreak: undefined }), "none", effort);
    assert.equal(morningBreakIntent({ role: "co_captain", effort, tryBreak: true }), morningBreakIntent({ role: "captain", effort, tryBreak: true }), effort);
  }
  assert.equal(morningBreakIntent({ role: "co_captain", effort: "grupetto", tryBreak: true }), "none");
});

test("#5981 protect: delt kaptajn foelger angreb som kaptajnen", () => {
  assert.equal(effortJoinBoost("co_captain", "protect"), effortJoinBoost("captain", "protect"));
  assert.ok(effortJoinBoost("co_captain", "protect") > 0);
  assert.equal(effortJoinBoost("co_captain", "normal"), 0);
});

test("#5981 jagt: delt kaptajn er aldrig reaktions-arbejder", () => {
  const { state, ctx } = scene([{ id: "cap", role: "captain" }, { id: "co", role: "co_captain" }, ...helpers(3)]);
  const workers = availableReactionWorkers({ teamId: "A", groupRiderIds: state.groups[0].rider_ids, entrants: ctx.entrants, riders: state.riders });
  assert.ok(!workers.includes("co") && !workers.includes("cap"));
  assert.equal(workers.length, 3);
});

test("#5981 endagsloeb: holdets beskyttede rytter er den af lederne der passer bedst til ruten", () => {
  const ent = (id: string, role: RiderRole, climbing: number): Entrant => ({ rider_id: id, team_id: "A", role, effort: "normal", condition: 1, abilities: abilitiesAt(40, { climbing }) });
  const entrants: Record<string, Entrant> = { cap: ent("cap", "captain", 70), co: ent("co", "co_captain", 80), h: ent("h", "helper", 85) };
  const groups = [{ id: "g0", kind: "peloton", rider_ids: ["cap", "co", "h"], gap_seconds: 0, cohesion: 1 } as RaceGroup];
  assert.equal(oneDayProtectedRider({ teamId: "A", groups, entrants, routeDemand: { climbing: 1 } }), "co");
});

test("#5981 bjergpoint i favoritgruppen: delt kaptajn ruller over toppen som kaptajnen", () => {
  assert.ok(KOM_FAVOURITE_ROLL_OVER_ROLES.includes("co_captain"));
});

// ── AI-hold ───────────────────────────────────────────────────────────────────

const gc = (level: number) => abilitiesAt(40, { climbing: level, tempo: level, time_trial: level });

test("#5981 AI: delt kaptajn kun naar holdets naestbedste klassementsrytter er taet paa kaptajnen", () => {
  const roster = (second: number) => [
    { rider_id: "cap", role: "captain" }, { rider_id: "two", role: "helper" },
    ...Array.from({ length: 6 }, (_, i) => ({ rider_id: `d${i}`, role: "helper" })),
  ].map((r) => ({ ...r, abil: r.rider_id === "cap" ? gc(80) : r.rider_id === "two" ? gc(second) : gc(50) }));
  const pick = (second: number) => {
    const r = roster(second);
    return aiCoCaptainId(r, (id) => r.find((x) => x.rider_id === id)?.abil);
  };
  assert.equal(pick(80), "two");
  assert.equal(pick(60), null, "en klar nummer to er hjaelper");
});

test("#5981 AI: et lille hold, et hold uden kaptajn eller et hold der allerede har en delt kaptajn faar ingen", () => {
  const abil = () => gc(80);
  const small = Array.from({ length: SHARED_CAPTAIN_AI_TUNING.minRosterSize - 1 }, (_, i) => ({ rider_id: `r${i}`, role: i === 0 ? "captain" : "helper" }));
  assert.equal(aiCoCaptainId(small, abil), null);
  const noCaptain = Array.from({ length: 8 }, (_, i) => ({ rider_id: `r${i}`, role: i === 0 ? "sprint_captain" : "helper" }));
  assert.equal(aiCoCaptainId(noCaptain, abil), null);
  const already = Array.from({ length: 8 }, (_, i) => ({ rider_id: `r${i}`, role: i === 0 ? "captain" : i === 1 ? "co_captain" : "helper" }));
  assert.equal(aiCoCaptainId(already, abil), null);
  const hunterOnly = [{ rider_id: "c", role: "captain" }, ...Array.from({ length: 7 }, (_, i) => ({ rider_id: `x${i}`, role: "hunter" }))];
  assert.equal(aiCoCaptainId(hunterOnly, abil), null, "jaeger og spurtkaptajn bliver ikke delt kaptajn");
});

function aiPlan(revision: string, isStageRace: boolean, isAi = true) {
  const roster = Array.from({ length: 8 }, (_, i) => ({
    team_id: "T", rider_id: `r${i}`, role: i === 0 ? "captain" : "helper", is_ai: isAi,
    abilities: i <= 1 ? gc(80) : gc(50),
  }));
  return buildStageOrderPlan({
    rows: [], stageNumber: 2, roster,
    context: { route: { profile_type: "mountain", finale_type: null }, race: { is_stage_race: isStageRace, later_stages: [] }, rules_revision: revision },
  } as Parameters<typeof buildStageOrderPlan>[0]);
}

test("#5981 AI: buildStageOrderPlan giver en delt kaptajn kun under s5_profiles_v3, i etapeloeb, for AI-hold", () => {
  assert.deepEqual([...(aiPlan("s5_profiles_v3", true).aiRoleByRider ?? new Map())], [["r1", "co_captain"]]);
  assert.equal(aiPlan("s5_profiles_v2", true).aiRoleByRider, undefined, "aeldre revision: uaendret plan");
  assert.equal(aiPlan("s5_profiles_v3", false).aiRoleByRider, undefined, "endagsloeb: ingen");
  assert.equal(aiPlan("s5_profiles_v3", true, false).aiRoleByRider, undefined, "menneskehold: ingen");
  const plan = aiPlan("s5_profiles_v3", true);
  assert.equal(plan.aiEffortByRider.get("r1"), "normal", "delt kaptajn arbejder ikke");
});

test("#5981 AI: planen under s5_profiles_v2 er identisk med foer (ingen aiRoleByRider-noegle)", () => {
  assert.equal("aiRoleByRider" in aiPlan("s5_profiles_v2", true), false);
});
