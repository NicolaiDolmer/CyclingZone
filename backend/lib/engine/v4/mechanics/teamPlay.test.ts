// backend/lib/engine/v4/mechanics/teamPlay.test.ts
// M16 holdspil (#4246): MEKANIKKEN (rene funktioner + hooket isoleret).
// Koblingen — at motoren faktisk kalder hooket — daekkes af
// ../segmentLoop.teamPlay.test.ts, samme opdeling som M7/M8.
//
// Formuleringsprincip som fieldIntegrity.test.ts: garantierne testes som
// SKALA-UAFHAENGIGE udsagn ("kreditten er aldrig stoerre end det holdet
// betalte", "prisen er aldrig negativ"), ikke som forventede tal — tallene i
// TEAM_PLAY_EXTRA_TUNING er startgaet og flytter sig ved naeste kalibrering.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TEAM_PLAY_TUNING,
  baseCostFraction,
  buildGroupTeamContexts,
  helperCostMultiplier,
  protectedRoleOrder,
  supportShare,
  teamPlayHook,
} from "./teamPlay.ts";
import { RACE_V4_TUNING } from "../tuning.ts";
import { makeHookCtx, rekeyHookCtxForSegment } from "../testUtils/makeHookCtx.ts";
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

const ALL_EFFORTS: EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];
const ALL_ROLES: RiderRole[] = ["captain", "sprint_captain", "helper", "hunter", "free_role"];
const ALL_PROFILES: ProfileType[] = [
  "flat", "rolling", "hilly", "mountain", "high_mountain", "cobbles", "gravel",
  "classic", "itt", "itt_hilly", "ttt",
];

function abilitiesAt(level: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = Math.max(0, Math.min(99, level));
  return out;
}

type Spec = {
  id: string;
  role: RiderRole;
  team?: string | null;
  effort?: EffortLevel;
  wprimeMax?: number;
  wprime?: number;
  status?: RiderState["status"];
};

function entrantOf(spec: Spec): Entrant {
  return {
    rider_id: spec.id,
    abilities: abilitiesAt(50),
    role: spec.role,
    effort: spec.effort ?? "normal",
    condition: 1,
    team_id: spec.team === undefined ? null : spec.team,
  };
}

function riderStateOf(spec: Spec): RiderState {
  const wprimeMax = spec.wprimeMax ?? 1;
  return {
    rider_id: spec.id,
    group_id: "g0",
    cp: 0.5,
    wprimeMax,
    wprime: spec.wprime ?? wprimeMax,
    dayform: 0,
    seconds_over_cp: 0,
    work_norm: 0,
    incidents: 0,
    status: spec.status ?? "racing",
    time_seconds: 0,
  };
}

/** Ét felt i ÉN gruppe — den enhed holdspillet arbejder paa. */
function scenario(specs: Spec[], profileType: ProfileType = "mountain", distanceKm = 200) {
  const entrants: Record<string, Entrant> = {};
  const riders: Record<string, RiderState> = {};
  for (const spec of specs) {
    entrants[spec.id] = entrantOf(spec);
    riders[spec.id] = riderStateOf(spec);
  }
  const group: RaceGroup = {
    id: "g0",
    kind: "peloton",
    rider_ids: specs.map((s) => s.id),
    gap_seconds: 0,
    cohesion: 1,
  };
  const segment: Segment = { kind: "flat", from_km: 0, to_km: distanceKm };
  const route: RouteV2 = {
    distance_km: distanceKm,
    profile_type: profileType,
    finale_type: null,
    segments: [segment],
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distanceKm }],
  };
  const state: EngineState = {
    km: 0,
    groups: [group],
    riders,
    virtual_gc: Object.fromEntries(specs.map((s) => [s.id, 0])),
  };
  // #4949: ctx spejler segmentLoop.ts's noegling (segment-noeglet rngFor).
  const ctx: SegmentHookContext = makeHookCtx({
    segment,
    segmentIndex: 0,
    route,
    entrants,
    tuning: RACE_V4_TUNING,
    seed: "team-play-test",
  });
  return { state, ctx, entrants, riders, group };
}

// ── Rene funktioner ───────────────────────────────────────────────────────────

test("baseCostFraction: kun arbejdende roller betaler, og aldrig negativt", () => {
  for (const profile of ALL_PROFILES) {
    for (const role of ALL_ROLES) {
      const fraction = baseCostFraction(role, profile);
      assert.ok(fraction >= 0, `${role}/${profile}: pris maa aldrig vaere negativ (fik ${fraction})`);
      if (role === "captain" || role === "sprint_captain" || role === "free_role") {
        assert.equal(fraction, 0, `${role} arbejder aldrig for holdet (${profile})`);
      } else {
        assert.ok(fraction > 0, `${role} skal betale noget paa ${profile}`);
      }
    }
  }
});

test("baseCostFraction: v3's profil-rangorden bevaret (GC > flad > oevrige for helper)", () => {
  assert.ok(baseCostFraction("helper", "mountain") > baseCostFraction("helper", "flat"));
  assert.ok(baseCostFraction("helper", "flat") > baseCostFraction("helper", "cobbles"));
  // hunter er profil-uafhaengig (v3's WORK_COST_HUNTER)
  const hunterCosts = new Set(ALL_PROFILES.map((p) => baseCostFraction("hunter", p)));
  assert.equal(hunterCosts.size, 1, "hunter-prisen skal vaere den samme paa alle profiler");
});

test("helperCostMultiplier: all_out fjerner prisen, aldrig under 0 (ejer §9 punkt 3)", () => {
  assert.equal(helperCostMultiplier("all_out"), 0, "all_out fjerner holdarbejdets pris");
  assert.ok(helperCostMultiplier("grupetto") < helperCostMultiplier("normal"));
  assert.equal(
    helperCostMultiplier("grupetto"),
    helperCostMultiplier("save"),
    "grupetto maa ikke vaere BILLIGERE end save — en lavere pris ville vaere en resultat-FORDEL",
  );
  assert.equal(helperCostMultiplier("protect"), helperCostMultiplier("normal"), "protect ER holdarbejdet, den rabatteres aldrig");
  for (const effort of ALL_EFFORTS) {
    assert.ok(helperCostMultiplier(effort) >= 0, `${effort}: multiplikatoren maa aldrig vende fortegn`);
  }
  // Ukendt/manglende effort -> fuld pris, aldrig rabat.
  assert.equal(helperCostMultiplier(undefined), helperCostMultiplier("normal"));
  assert.equal(helperCostMultiplier("ukendt" as EffortLevel), helperCostMultiplier("normal"));
});

test("supportShare: 0 under minimum, monotont ikke-faldende, clampet til 1", () => {
  assert.equal(supportShare(0), 0, "ingen arbejdende holdkammerater => ingen beskyttelse");
  let prev = -1;
  for (let n = 0; n <= 12; n++) {
    const share = supportShare(n);
    assert.ok(share >= 0 && share <= 1, `n=${n}: ${share} skal ligge i [0,1]`);
    assert.ok(share >= prev, `n=${n}: stoetten maa aldrig falde naar holdet vokser`);
    prev = share;
  }
  assert.equal(supportShare(TEAM_PLAY_TUNING.supportSaturationWorkers), 1, "maetning ved holdstoerrelsen");
  assert.equal(supportShare(50), 1, "et ubegraenset hold giver ikke ubegraenset stoette");
});

test("protectedRoleOrder: spurt-kaptajnen beskyttes paa flade etaper, kaptajnen ellers", () => {
  assert.equal(protectedRoleOrder("flat")[0], "sprint_captain");
  for (const profile of ALL_PROFILES.filter((p) => p !== "flat")) {
    assert.equal(protectedRoleOrder(profile)[0], "captain", `${profile}: kaptajnen er den beskyttede`);
  }
  // Fallback-halvdelen er der altid (v3's `sprintCaptainId ?? captainId`).
  for (const profile of ALL_PROFILES) assert.equal(protectedRoleOrder(profile).length, 2);
});

// ── Holdkontekst ──────────────────────────────────────────────────────────────

test("buildGroupTeamContexts: ryttere uden team_id danner aldrig et hold", () => {
  const { state, ctx, group } = scenario([
    { id: "a", role: "captain" },
    { id: "b", role: "helper" },
    { id: "c", role: "helper" },
  ]);
  assert.deepEqual(buildGroupTeamContexts(group, ctx.entrants, state.riders, "mountain"), []);
});

test("buildGroupTeamContexts: free_role taeller aldrig som arbejdende (#2376)", () => {
  const { state, ctx, group } = scenario([
    { id: "a", role: "captain", team: "T1" },
    { id: "b", role: "free_role", team: "T1" },
  ]);
  const [team] = buildGroupTeamContexts(group, ctx.entrants, state.riders, "mountain");
  assert.equal(team.leaderId, "a");
  assert.deepEqual(team.workerIds, [], "en free_role-holdkammerat bidrager 0");
});

test("buildGroupTeamContexts: udgaaede ryttere taeller hverken som leder eller hjaelper", () => {
  const { state, ctx, group } = scenario([
    { id: "a", role: "captain", team: "T1", status: "abandoned" },
    { id: "b", role: "helper", team: "T1", status: "abandoned" },
    { id: "c", role: "helper", team: "T1" },
  ]);
  const [team] = buildGroupTeamContexts(group, ctx.entrants, state.riders, "mountain");
  assert.equal(team.leaderId, null, "en udgaaet kaptajn skal ikke beskyttes");
  assert.deepEqual(team.workerIds, ["c"], "en udgaaet hjaelper traekker ikke");
});

test("buildGroupTeamContexts: dublet-roller (de 119 beskidte prod-raekker) giver ÉN stabil leder", () => {
  const { state, ctx, group } = scenario([
    { id: "z", role: "captain", team: "T1" },
    { id: "a", role: "captain", team: "T1" },
    { id: "m", role: "captain", team: "T1" },
    { id: "h", role: "helper", team: "T1" },
  ]);
  const first = buildGroupTeamContexts(group, ctx.entrants, state.riders, "mountain");
  const second = buildGroupTeamContexts(group, ctx.entrants, state.riders, "mountain");
  assert.equal(first[0].leaderId, "a", "stabil rider_id-orden vaelger lederen");
  assert.deepEqual(first, second, "samme input => samme leder (determinisme foer skoenhed)");
});

test("buildGroupTeamContexts: sprint-kaptajnen er lederen paa flad vej, kaptajnen paa bjerg", () => {
  const specs: Spec[] = [
    { id: "cap", role: "captain", team: "T1" },
    { id: "spr", role: "sprint_captain", team: "T1" },
    { id: "hlp", role: "helper", team: "T1" },
  ];
  const flat = scenario(specs, "flat");
  assert.equal(buildGroupTeamContexts(flat.group, flat.ctx.entrants, flat.state.riders, "flat")[0].leaderId, "spr");
  const mtn = scenario(specs, "mountain");
  assert.equal(buildGroupTeamContexts(mtn.group, mtn.ctx.entrants, mtn.state.riders, "mountain")[0].leaderId, "cap");
});

// ── Hooket: de fire garantier ────────────────────────────────────

/** Holdspils-faktoren for én rytter, 1 hvis mekanikken ikke roerte ham. */
function factorOf(state: EngineState, riderId: string): number {
  const raw = state.riders[riderId].team_cp_factor;
  return Number.isFinite(raw) ? (raw as number) : 1;
}

test("hook: uden team_id er mekanikken en EKSAKT no-op (fixtures er bit-uaendrede)", () => {
  const { state, ctx } = scenario([
    { id: "cap", role: "captain" },
    { id: "h1", role: "helper" },
    { id: "h2", role: "helper" },
  ]);
  const result = teamPlayHook(state, ctx);
  assert.equal(result.state, state, "samme state-reference tilbage");
  assert.deepEqual(result.events, []);
});

test("hook: hjaelperen betaler, kaptajnen faar lae", () => {
  const { state, ctx } = scenario([
    { id: "cap", role: "captain", team: "T1" },
    { id: "h1", role: "helper", team: "T1" },
    { id: "h2", role: "helper", team: "T1" },
  ]);
  const { state: next, events } = teamPlayHook(state, ctx);
  assert.deepEqual(events, [], "holdarbejde er en tilstand, ikke et oejeblik — ingen events");
  assert.ok(factorOf(next, "h1") < 1, "hjaelperen betaler med sin CP");
  assert.ok(factorOf(next, "h2") < 1, "begge hjaelpere betaler");
  assert.ok(factorOf(next, "cap") > 1, "kaptajnen koerer i lae");
  assert.equal(next.riders.h1.work_norm, 0, "work_norm roeres ALDRIG af holdspillet — se hookets note");
  assert.equal(next.riders.cap.work_norm, 0, "heller ikke kaptajnens");
  assert.notEqual(next, state);
  assert.equal(factorOf(state, "h1"), 1, "input-state maa ALDRIG muteres");
});

test("hook: kaptajn uden hjaelpere i gruppen faar intet (gruppen ER naerheden)", () => {
  const { state, ctx } = scenario([
    { id: "cap", role: "captain", team: "T1" },
    { id: "rival", role: "free_role", team: "T2" },
  ]);
  const { state: next } = teamPlayHook(state, ctx);
  assert.equal(next, state);
});

test("hook: hjaelpere uden leder i gruppen betaler stadig (holdet braendte dagen)", () => {
  const { state, ctx } = scenario([
    { id: "h1", role: "helper", team: "T1" },
    { id: "h2", role: "helper", team: "T1" },
  ]);
  const { state: next } = teamPlayHook(state, ctx);
  assert.ok(factorOf(next, "h1") < 1);
});

test("GARANTI 1 (bevarelse): bonussen overstiger aldrig det holdet paadrog sig", () => {
  for (const workerCount of [1, 2, 3, 5, 8]) {
    for (const effort of ALL_EFFORTS) {
      const specs: Spec[] = [{ id: "cap", role: "captain", team: "T1" }];
      for (let i = 0; i < workerCount; i++) specs.push({ id: `h${i}`, role: "helper", team: "T1", effort });
      const { state, ctx } = scenario(specs);
      const { state: next } = teamPlayHook(state, ctx);
      const paid = specs
        .filter((s) => s.role === "helper")
        .reduce((sum, s) => sum + (1 - factorOf(next, s.id)), 0);
      const bonus = factorOf(next, "cap") - 1;
      assert.ok(
        bonus <= paid + 1e-9,
        `n=${workerCount} effort=${effort}: bonus ${bonus} maa aldrig overstige paadraget ${paid} — holdspil flytter kraefter, det skaber dem ikke`,
      );
    }
  }
});

test("GARANTI 2 (bounded): otte hjaelpere giver ikke otte gange fordel", () => {
  const bonusFor = (workerCount: number): number => {
    const specs: Spec[] = [{ id: "cap", role: "captain", team: "T1" }];
    for (let i = 0; i < workerCount; i++) specs.push({ id: `h${i}`, role: "helper", team: "T1" });
    const { state, ctx } = scenario(specs);
    return factorOf(teamPlayHook(state, ctx).state, "cap") - 1;
  };
  for (const n of [1, 2, 4, 8, 20]) {
    assert.ok(
      bonusFor(n) <= TEAM_PLAY_TUNING.captainMaxBonusFraction + 1e-9,
      `n=${n}: bonussen skal respektere etape-loftet`,
    );
  }
  assert.ok(bonusFor(8) >= bonusFor(2), "mere hjaelp er aldrig daarligere end mindre");
});

test("GARANTI 3 (intet fortegns-skift): all_out fjerner prisen og giver ALDRIG CP", () => {
  const { state, ctx } = scenario([
    { id: "cap", role: "captain", team: "T1" },
    { id: "h1", role: "helper", team: "T1", effort: "all_out" },
  ]);
  const { state: next } = teamPlayHook(state, ctx);
  assert.equal(next, state, "ingen betalte => intet at flytte => eksakt no-op");
});

test("GARANTI 3: faktoren holder sig inden for [gulv, loft] uanset hvor laenge holdet arbejder", () => {
  const specs: Spec[] = [{ id: "cap", role: "captain", team: "T1" }];
  for (let i = 0; i < 8; i++) specs.push({ id: `h${i}`, role: "helper", team: "T1" });
  const { state, ctx } = scenario(specs);
  // 40 hele etaper i traek paa samme state: langt ud over hvad et loeb kan give.
  let current = state;
  for (let i = 0; i < 40; i++) current = teamPlayHook(current, ctx).state;
  for (const spec of specs) {
    const f = factorOf(current, spec.id);
    assert.ok(f >= TEAM_PLAY_TUNING.minCpFactor - 1e-9, `${spec.id}: faktoren maa aldrig falde under gulvet (fik ${f})`);
    assert.ok(
      f <= 1 + TEAM_PLAY_TUNING.captainMaxBonusFraction + 1e-9,
      `${spec.id}: faktoren maa aldrig overstige loftet (fik ${f})`,
    );
    assert.ok(f > 0, `${spec.id}: CP kan aldrig nulstilles af holdarbejde`);
  }
});

test("GARANTI 4 (monotoni): faktoren er ens for to hjaelpere i samme klasse", () => {
  // To hjaelpere paa samme hold, samme rolle, samme effort — kun reserven
  // adskiller dem. Faktoren er MULTIPLIKATIV og skal vaere identisk, saa deres
  // indbyrdes CP-orden er uroerlig (§3 invariant 3).
  const { state, ctx } = scenario([
    { id: "cap", role: "captain", team: "T1" },
    { id: "weak", role: "helper", team: "T1", wprimeMax: 1 },
    { id: "strong", role: "helper", team: "T1", wprimeMax: 2 },
  ]);
  const { state: next } = teamPlayHook(state, ctx);
  assert.equal(
    factorOf(next, "weak"),
    factorOf(next, "strong"),
    "samme rolle + samme effort + samme profil => samme faktor; holdspillet vender aldrig to hjaelperes indbyrdes orden",
  );
});

test("ROLLER: hunter betaler mindre end helper, kaptajn og free_role betaler intet", () => {
  const { state, ctx } = scenario([
    { id: "cap", role: "captain", team: "T1" },
    { id: "hlp", role: "helper", team: "T1" },
    { id: "hun", role: "hunter", team: "T1" },
    { id: "fre", role: "free_role", team: "T1" },
  ]);
  const { state: next } = teamPlayHook(state, ctx);
  assert.ok(factorOf(next, "hlp") < factorOf(next, "hun"), "hjaelperen betaler mest");
  assert.ok(factorOf(next, "hun") < 1, "jaegeren betaler en lille pris");
  assert.equal(factorOf(next, "fre"), 1, "free_role: 0 holdbidrag, 0 pris (#2376)");
  assert.ok(factorOf(next, "cap") > 1, "kaptajnen modtager");
});

// ── Determinisme + granularitet ──────────────────────────────────

test("determinisme: samme input giver byte-identisk output (ingen rng overhovedet)", () => {
  const specs: Spec[] = [
    { id: "cap", role: "captain", team: "T1" },
    { id: "h1", role: "helper", team: "T1" },
    { id: "h2", role: "hunter", team: "T1" },
    { id: "rival", role: "captain", team: "T2" },
    { id: "r1", role: "helper", team: "T2" },
  ];
  const a = scenario(specs);
  const b = scenario(specs);
  assert.deepEqual(teamPlayHook(a.state, a.ctx).state.riders, teamPlayHook(b.state, b.ctx).state.riders);
});

test("granularitet: prisen over en etape er den samme uanset hvor fint ruten er skaaret op", () => {
  const specs: Spec[] = [
    { id: "cap", role: "captain", team: "T1" },
    { id: "h1", role: "helper", team: "T1" },
  ];

  const runWithSegments = (count: number): { helper: number; captain: number } => {
    const { state, ctx } = scenario(specs, "mountain", 200);
    let current = state;
    const width = 200 / count;
    for (let i = 0; i < count; i++) {
      const segment: Segment = { kind: "flat", from_km: i * width, to_km: (i + 1) * width };
      // #4949: re-noegler rngFor til det nye segmentIndex (samme rngForStage-
      // stream genbrugt) — ellers ville hvert segment i loekken faa den SAMME
      // foerste lodtraekning, praecis den fejlklasse #4886 fandt i produktion.
      current = teamPlayHook(current, rekeyHookCtxForSegment(ctx, segment, i)).state;
    }
    return { helper: factorOf(current, "h1"), captain: factorOf(current, "cap") };
  };

  const one = runWithSegments(1);
  for (const count of [2, 5, 20]) {
    const many = runWithSegments(count);
    assert.ok(
      Math.abs(many.helper - one.helper) < 1e-9 && Math.abs(many.captain - one.captain) < 1e-9,
      `${count} segmenter skal koste det samme som 1 — ellers bestemmer rutemodellens granularitet balancen`,
    );
  }
});

test("granularitet: en etape uden laengde koster ingenting", () => {
  const { state, ctx } = scenario([
    { id: "cap", role: "captain", team: "T1" },
    { id: "h1", role: "helper", team: "T1" },
  ]);
  const zeroSegment: Segment = { kind: "flat", from_km: 50, to_km: 50 };
  const { state: next } = teamPlayHook(state, { ...ctx, segment: zeroSegment });
  assert.equal(next, state);
});

test("PROFIL: en hel etapes holdarbejde koster praecis baseCostFraction x effort", () => {
  for (const profile of ALL_PROFILES) {
    for (const effort of ALL_EFFORTS) {
      const { state, ctx } = scenario(
        [
          { id: "cap", role: "captain", team: "T1" },
          { id: "h1", role: "helper", team: "T1", effort },
        ],
        profile,
      );
      const { state: next } = teamPlayHook(state, ctx); // ét segment = hele etapen
      const expected = 1 - baseCostFraction("helper", profile) * helperCostMultiplier(effort);
      assert.ok(
        Math.abs(factorOf(next, "h1") - expected) < 1e-9,
        `${profile}/${effort}: forventede faktor ${expected}, fik ${factorOf(next, "h1")}`,
      );
    }
  }
});
