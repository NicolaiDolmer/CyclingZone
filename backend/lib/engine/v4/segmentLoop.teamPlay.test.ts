// backend/lib/engine/v4/segmentLoop.teamPlay.test.ts
// Forward-guard for M16-WIRINGEN (#4246): holdspillet er koblet ind i
// segment-loopet og naar hele vejen ud i resultatet.
//
// mechanics/teamPlay.test.ts daekker MEKANIKKEN (rene funktioner + hooket
// isoleret). Denne fil daekker KOBLINGEN — at motoren faktisk kalder den, og
// at den ikke braekker nogen af motorens haarde garantier undervejs. Uden en
// test paa koblingen kan mekanikken blive "bygget, ikke koblet ind" igen ved
// den foerste refaktorering: praecis den tilstand auditten 5/9 fandt paa otte
// mekanikker. Samme opdeling som M7's segmentLoop.distanceFatigue.test.ts.
//
// Invarianterne er SKALA-UAFHAENGIGE udsagn, ikke forventede tal.

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageV4 } from "./index.ts";
import { DEFAULT_MECHANIC_HOOKS, runSegmentLoop } from "./segmentLoop.ts";
import { teamPlayHook } from "./mechanics/teamPlay.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import { validateTimelineEvents } from "./timeline.ts";
import type {
  AbilityKey,
  Entrant,
  ProfileType,
  RiderRole,
  RouteV2,
  Segment,
  StageInput,
  StageOutput,
} from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

/** Evne-niveauerne fra #4604-load-guarden: bund, prod-median, midt, hoej, top. */
const ABILITY_LEVELS = [5, 11, 30, 60, 99];

function clamp99(n: number): number {
  return Math.max(0, Math.min(99, n));
}

function abilitiesAt(level: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = clamp99(level);
  return out;
}

function segmentsFor(distanceKm: number): Segment[] {
  const third = distanceKm / 3;
  return [
    { kind: "flat", from_km: 0, to_km: third },
    { kind: "climb", from_km: third, to_km: 2 * third, category: "1", avg_gradient: 7, top_elevation_m: 1800 },
    { kind: "flat", from_km: 2 * third, to_km: distanceKm },
  ];
}

function routeOf(profileType: ProfileType, distanceKm = 180): RouteV2 {
  return {
    distance_km: distanceKm,
    profile_type: profileType,
    finale_type: profileType === "flat" ? "bunch_sprint" : "long_climb",
    segments: segmentsFor(distanceKm),
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distanceKm }],
  };
}

type RiderSpec = { id: string; level: number; role: RiderRole; team?: string | null };

function entrantsOf(specs: RiderSpec[]): Entrant[] {
  return specs.map((s) => ({
    rider_id: s.id,
    abilities: abilitiesAt(s.level),
    role: s.role,
    effort: "normal" as const,
    condition: 1,
    ...(s.team === undefined ? {} : { team_id: s.team }),
  }));
}

function stage(startlist: Entrant[], route: RouteV2, seed: string): StageInput {
  return { route, startlist, orders: [], seed, tuning: RACE_V4_TUNING };
}

function rankOf(output: StageOutput, riderId: string): number {
  const row = output.results.find((r) => r.rider_id === riderId);
  assert.ok(row, `${riderId} skal staa i resultatet`);
  return row!.rank;
}

/**
 * To identiske hold paa samme etape — det ENESTE der adskiller dem er om
 * kaptajnen har hjaelpere paa sit eget hold. `teamed` faar hold-id paa alle,
 * `lone` giver hver rytter sit eget hold, saa ingen har en holdkammerat.
 */
function twoWorldFields(level: number, helpersPerTeam: number): { teamed: Entrant[]; lone: Entrant[] } {
  const specs: RiderSpec[] = [];
  for (let team = 0; team < 6; team++) {
    specs.push({ id: `t${team}cap`, level, role: "captain", team: `T${team}` });
    for (let h = 0; h < helpersPerTeam; h++) {
      specs.push({ id: `t${team}h${h}`, level: level - 1 > 0 ? level - 1 : level, role: "helper", team: `T${team}` });
    }
  }
  const teamed = entrantsOf(specs);
  const lone = entrantsOf(specs.map((s) => ({ ...s, team: `SOLO-${s.id}` })));
  return { teamed, lone };
}

// ── Koblingen findes ──────────────────────────────────────────────────────────

test("WIRING: index.ts registrerer teamPlay-hooket (bygget vs. koblet ind)", () => {
  const { teamed, lone } = twoWorldFields(60, 3);
  const route = routeOf("mountain");
  const withTeams = simulateStageV4(stage(teamed, route, "wiring-1"));
  const withoutTeams = simulateStageV4(stage(lone, route, "wiring-1"));
  assert.notDeepEqual(
    withTeams.results.map((r) => [r.rider_id, r.time_seconds]),
    withoutTeams.results.map((r) => [r.rider_id, r.time_seconds]),
    "hold-id skal aendre etapens udfald — ellers er M16 bygget men ikke koblet ind",
  );
});

test("WIRING: segmentLoop kalder hooket paa HVERT segment, ikke kun ét", () => {
  const seen: number[] = [];
  const { teamed } = twoWorldFields(60, 2);
  const route = routeOf("mountain");
  runSegmentLoop(stage(teamed, route, "wiring-2"), {
    ...DEFAULT_MECHANIC_HOOKS,
    teamPlay: (state, ctx) => {
      seen.push(ctx.segmentIndex);
      return teamPlayHook(state, ctx);
    },
  });
  assert.deepEqual(seen, [0, 1, 2], "holdarbejde er ambient — hooket er ikke kind-gated");
});

test("WIRING: et hook-saet UDEN teamPlay koerer etapen som foer (F2-adfaerd)", () => {
  const { teamed } = twoWorldFields(60, 3);
  const route = routeOf("mountain");
  const input = stage(teamed, route, "wiring-3");
  const withoutHook = { ...DEFAULT_MECHANIC_HOOKS };
  delete (withoutHook as { teamPlay?: unknown }).teamPlay;
  const a = runSegmentLoop(input, withoutHook);
  const b = runSegmentLoop(input, DEFAULT_MECHANIC_HOOKS); // no-op-hooket
  assert.deepEqual(a.state.riders, b.state.riders);
});

test("WIRING: en startliste UDEN team_id giver bit-identisk output (fixture-garantien)", () => {
  const specs: RiderSpec[] = [];
  for (let i = 0; i < 18; i++) {
    specs.push({ id: `r${i}`, level: 40 + (i % 7), role: i % 3 === 0 ? "captain" : "helper" });
  }
  const route = routeOf("mountain");
  // Ingen team_id-noegle overhovedet (som fixtures) mod eksplicit null.
  const withoutKey = simulateStageV4(stage(entrantsOf(specs), route, "wiring-4"));
  const withNull = simulateStageV4(stage(entrantsOf(specs.map((s) => ({ ...s, team: null }))), route, "wiring-4"));
  assert.deepEqual(withNull, withoutKey, "manglende og null-hold skal behandles ens");
});

// ── Holdspillets to kanaler, maalt paa udfaldet ───────────────────────────────

test("KAPTAJNEN BESKYTTES: en kaptajn med hjaelpere slaar sin egen tvilling uden hjaelpere", () => {
  // Samme rytter, samme seed, samme felt — kun holdkammeraterne adskiller de
  // to verdener. Testes over hele evne-spektret, saa udsagnet er skala-
  // uafhaengigt (samme princip som fieldIntegrity.test.ts).
  for (const level of ABILITY_LEVELS) {
    const { teamed, lone } = twoWorldFields(level, 4);
    const route = routeOf("mountain");
    const withTeams = simulateStageV4(stage(teamed, route, `protect-${level}`));
    const withoutTeams = simulateStageV4(stage(lone, route, `protect-${level}`));
    const rankWith = rankOf(withTeams, "t0cap");
    const rankWithout = rankOf(withoutTeams, "t0cap");
    assert.ok(
      rankWith <= rankWithout,
      `evne ${level}: kaptajnen med fire hjaelpere (${rankWith}) maa aldrig staa daarligere end uden (${rankWithout})`,
    );
  }
});

test("HJAELPEREN BETALER: holdarbejdet koster placering mod en identisk fri rytter", () => {
  // Feltet er ÉT hold plus lige saa mange frie ryttere med SAMME evne. Betaler
  // hjaelperen ikke, ville de to grupper vaere umulige at skelne.
  const specs: RiderSpec[] = [{ id: "cap", level: 60, role: "captain", team: "T1" }];
  for (let i = 0; i < 6; i++) specs.push({ id: `h${i}`, level: 55, role: "helper", team: "T1" });
  for (let i = 0; i < 6; i++) specs.push({ id: `f${i}`, level: 55, role: "free_role", team: `SOLO-f${i}` });

  const output = simulateStageV4(stage(entrantsOf(specs), routeOf("mountain"), "cost-1"));
  const helperRanks = specs.filter((s) => s.role === "helper").map((s) => rankOf(output, s.id));
  const freeRanks = specs.filter((s) => s.role === "free_role").map((s) => rankOf(output, s.id));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(
    mean(helperRanks) > mean(freeRanks),
    `hjaelperne (gns. ${mean(helperRanks)}) skal i snit staa daarligere end lige saa staerke frie ryttere (gns. ${mean(freeRanks)}) — ellers er arbejdet gratis`,
  );
});

test("ALL_OUT: en hjaelper der giver alt for sig selv betaler ingen holdpris", () => {
  const base: RiderSpec[] = [{ id: "cap", level: 60, role: "captain", team: "T1" }];
  for (let i = 0; i < 5; i++) base.push({ id: `h${i}`, level: 55, role: "helper", team: "T1" });
  for (let i = 0; i < 6; i++) base.push({ id: `f${i}`, level: 55, role: "free_role", team: `SOLO-f${i}` });

  // Maalt paa team_cp_factor og IKKE paa placeringen (aendret 6/9 ved M12-
  // wiringen, #4632). Placeringen var et fair maal saa laenge holdprisen var
  // den eneste kanal effort-valget havde; nu ganger M12 ogsaa trinnet paa
  // rytterens EGET kraftkrav, saa en all_out-rytter braender mere W' og kan
  // sagtens ende daarligere placeret — af sin egen indsats, ikke af holdet.
  // Udsagnet her er uaendret ("all_out betaler ingen holdpris"); det er nu
  // bare maalt paa den stoerrelse der faktisk BAERER holdprisen, saa testen
  // ikke igen faelder en anden mekaniks wiring.
  const teamFactorOf = (effort: "normal" | "all_out"): number => {
    const startlist = entrantsOf(base).map((e) => (e.rider_id === "h0" ? { ...e, effort } : e));
    const { state } = runSegmentLoop(stage(startlist, routeOf("mountain"), "allout-1"), {
      ...DEFAULT_MECHANIC_HOOKS,
      teamPlay: teamPlayHook,
    });
    return state.riders["h0"].team_cp_factor ?? 1;
  };
  assert.ok(
    teamFactorOf("all_out") >= teamFactorOf("normal"),
    `all_out fjerner holdarbejdets pris (ejer §9 punkt 3): team_cp_factor ${teamFactorOf("all_out")} skal vaere >= ${teamFactorOf("normal")}`,
  );
  assert.ok(teamFactorOf("normal") < 1, "en normal hjaelper skal faktisk betale en holdpris — ellers maaler testen ingenting");
});

// ── Motorens haarde garantier holder MED holdspil ─────────────────────────────

test("INVARIANT 3 (monotoni): inden for samme hold og rolle vinder den staerkeste", () => {
  // Holdspillet er en kanal MELLEM roller (som i v3), ikke stoej inden for en.
  // Testen laaser at den ikke er blevet stoej: to hjaelpere paa samme hold, samme
  // effort, kun evne adskiller dem — den staerkeste skal aldrig staa daarligst.
  for (const level of ABILITY_LEVELS) {
    const specs: RiderSpec[] = [{ id: "cap", level, role: "captain", team: "T1" }];
    // Stigende evne: h0 svagest, h5 staerkest.
    for (let i = 0; i < 6; i++) specs.push({ id: `h${i}`, level: clamp99(level - 10 + i * 4), role: "helper", team: "T1" });
    const output = simulateStageV4(stage(entrantsOf(specs), routeOf("mountain"), `mono-${level}`));
    const byId = new Map(output.results.map((r) => [r.rider_id, r]));
    for (let i = 0; i < 5; i++) {
      const weaker = byId.get(`h${i}`)!;
      const stronger = byId.get(`h${i + 1}`)!;
      if (weaker.group_id !== stronger.group_id) continue; // invariant 3 gaelder INDEN FOR en gruppe
      assert.ok(
        stronger.time_seconds <= weaker.time_seconds,
        `evne ${level}: h${i + 1} (staerkere) maa aldrig faa daarligere tid end h${i} i samme gruppe`,
      );
    }
  }
});

test("INVARIANT 6 (laast feltstoerrelse): holdspil taber og duplikerer ingen ryttere", () => {
  for (const level of ABILITY_LEVELS) {
    for (const profile of ["flat", "mountain", "cobbles"] as ProfileType[]) {
      const { teamed } = twoWorldFields(level, 4);
      const output = simulateStageV4(stage(teamed, routeOf(profile), `field-${level}-${profile}`));
      assert.equal(output.results.length, teamed.length, `${profile}/${level}: lige saa mange i maal som paa startlisten`);
      const ranks = output.results.map((r) => r.rank).sort((a, b) => a - b);
      assert.deepEqual(ranks, teamed.map((_, i) => i + 1), "placeringerne skal vaere en komplet permutation 1..N");
      assert.equal(new Set(output.results.map((r) => r.rider_id)).size, teamed.length, "hver rytter praecis én gang");
    }
  }
});

test("DETERMINISME: samme input med hold giver byte-identisk output", () => {
  const { teamed } = twoWorldFields(60, 4);
  const input = stage(teamed, routeOf("mountain"), "determinism-1");
  assert.deepEqual(simulateStageV4(input), simulateStageV4(input));
});

test("TIDSLINJE: holdspil emitterer ingen events og bryder ikke validatoren", () => {
  const { teamed } = twoWorldFields(60, 4);
  const output = simulateStageV4(stage(teamed, routeOf("mountain"), "timeline-1"));
  const breaches = validateTimelineEvents(output.timeline.events, {
    distanceKm: 180,
    knownRiderIds: new Set(teamed.map((e) => e.rider_id)),
  });
  assert.deepEqual(breaches, [], "fog-gaten og #2410-taksonomien skal vaere ubroedte");
});

test("BELASTNING: holdspillet roerer ALDRIG RiderLoad-kontraktens work_norm", () => {
  // `work_norm` er segment-loopets akkumulerede arbejde i motorens EGNE
  // enheder. Holdspillet har ingen aerlig omregning til den enhed (se
  // mechanics/teamPlay.ts's note), saa det maa ikke skrive der. Testen er en
  // forward-guard: et fremtidigt "lille load-led" ville se harmloest ud og
  // forurene netop det tal traeningssystemet (#4850/D2) skal bygge paa.
  const specs: RiderSpec[] = [{ id: "cap", level: 60, role: "captain", team: "T1" }];
  for (let i = 0; i < 5; i++) specs.push({ id: `h${i}`, level: 60, role: "helper", team: "T1" });
  const route = routeOf("mountain");
  const withTeams = runSegmentLoop(stage(entrantsOf(specs), route, "load-1"), {
    ...DEFAULT_MECHANIC_HOOKS,
    teamPlay: teamPlayHook,
  });
  const withoutTeams = runSegmentLoop(stage(entrantsOf(specs), route, "load-1"), DEFAULT_MECHANIC_HOOKS);
  for (const spec of specs) {
    const a = withTeams.state.riders[spec.id];
    const b = withoutTeams.state.riders[spec.id];
    // CP-faktoren SKAL vaere sat paa de involverede — ellers tester vi ingenting.
    if (spec.role === "helper") {
      assert.ok((a.team_cp_factor ?? 1) < 1, `${spec.id}: hjaelperen skal have betalt`);
    }
    assert.equal(b.team_cp_factor, undefined, `${spec.id}: uden hooket saettes faktoren aldrig`);
  }
  // work_norm afviger kun via CP-kanalen (lavere CP => anden front-/draft-
  // placering), ALDRIG via et direkte holdspils-led: hooket skriver ikke feltet.
  const capWithHookOnly = teamPlayHook(withoutTeams.state, {
    segment: route.segments[0],
    segmentIndex: 0,
    route,
    entrants: Object.fromEntries(entrantsOf(specs).map((e) => [e.rider_id, e])),
    tuning: RACE_V4_TUNING,
    rngFor: () => () => 0,
    orders: [],
  }).state;
  for (const spec of specs) {
    assert.equal(
      capWithHookOnly.riders[spec.id].work_norm,
      withoutTeams.state.riders[spec.id].work_norm,
      `${spec.id}: hooket alene maa ikke flytte work_norm ét eneste trin`,
    );
  }
});
