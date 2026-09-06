// backend/lib/engine/v4/index.teamTimeTrial.test.ts
// M13-WIRINGEN (#3463/#2412, #3855, ejer-beslutning 6/9): simulateStageV4
// forgrener paa profile_type "ttt" og koerer holdtidskoerslen.
//
// mechanics/teamTimeTrial.test.ts daekker selve mekanikken (17 tests). DENNE
// fil daekker koblingen: at forgreningen sker, at holdets tid lander pr. rytter
// (praecis #3463's fund: "ni ryttere fra samme hold ville hver faa deres egen
// tid"), at invariant 3 holder pr. hold, og at en almindelig vejetape er
// bit-uaendret.

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageV4 } from "./index.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import { validateTimelineEvents } from "./timeline.ts";
import type { AbilityKey, Entrant, ProfileType, RouteV2, Segment, StageInput } from "./types.ts";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(base: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = base;
  return out;
}

function rider(riderId: string, teamId: string | null, base: number): Entrant {
  const e: Entrant = { rider_id: riderId, abilities: abilities(base), role: "free_role", effort: "normal", condition: 1 };
  if (teamId !== null) e.team_id = teamId;
  return e;
}

/** `teams` hold à `perTeam` ryttere; hold i faar evne-niveau `bases[i]`. */
function startlist(bases: number[], perTeam = 8, withTeamId = true): Entrant[] {
  const out: Entrant[] = [];
  bases.forEach((base, t) => {
    for (let i = 0; i < perTeam; i++) {
      out.push(rider(`t${t}r${i}`, withTeamId ? `team-${t}` : null, base));
    }
  });
  return out;
}

function segments(count: number, kmPerSegment: number): Segment[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "flat" as const,
    from_km: i * kmPerSegment,
    to_km: (i + 1) * kmPerSegment,
  }));
}

function route(profileType: ProfileType, segmentCount = 6, kmPerSegment = 5): RouteV2 {
  return {
    distance_km: segmentCount * kmPerSegment,
    profile_type: profileType,
    // BEVIDST samme finale_type som en enkeltstart: raceStageProfileGenerator
    // mapper baade itt/itt_hilly OG ttt til "solo_tt". Testen ville vaere
    // vaerdiloes hvis finale_type kunne bruges som diskriminator.
    finale_type: "solo_tt",
    segments: segments(segmentCount, kmPerSegment),
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [],
  };
}

function input(overrides: Partial<StageInput> = {}): StageInput {
  return {
    route: route("ttt"),
    startlist: startlist([60, 50, 40]),
    orders: [],
    seed: "ttt-wiring-seed",
    tuning: RACE_V4_TUNING,
    ...overrides,
  };
}

function timesByTeam(output: ReturnType<typeof simulateStageV4>, list: Entrant[]): Map<string, Set<number>> {
  const teamOf = new Map(list.map((e) => [e.rider_id, e.team_id ?? ""]));
  const out = new Map<string, Set<number>>();
  for (const r of output.results) {
    const team = teamOf.get(r.rider_id) ?? "";
    if (!out.has(team)) out.set(team, new Set());
    out.get(team)!.add(r.time_seconds);
  }
  return out;
}

// ── 1. Forgreningen sker (og kun paa ttt) ───────────────────────────────────

test("#3463: ttt-etape giver ALLE holdets ryttere PRAECIS én faelles tid", () => {
  const list = startlist([60, 50, 40], 9);
  const out = simulateStageV4(input({ startlist: list }));

  assert.equal(out.results.length, list.length, "hele startlisten skal staa i resultatet (invariant 6)");
  for (const [team, times] of timesByTeam(out, list)) {
    assert.equal(times.size, 1, `hold ${team} har ${times.size} forskellige tider — TTT giver ÉN holdtid`);
  }
});

test("samme rute som ITT (profile_type itt) splitter det blandede hold — diskriminatoren er profile_type", () => {
  // #3463's kerne: paa en ENKELTSTART er holdet ikke en gruppe. Et hold med
  // spredte evner skal derfor have FLERE tider paa itt og PRAECIS ÉN paa ttt —
  // paa den samme rute, med den samme startliste og det samme seed. Den eneste
  // forskel er profile_type (finale_type er "solo_tt" i begge).
  const list = [
    rider("m0", "team-mixed", 85), rider("m1", "team-mixed", 65),
    rider("m2", "team-mixed", 45), rider("m3", "team-mixed", 25),
    ...startlist([50], 8).map((e) => ({ ...e, rider_id: `o-${e.rider_id}`, team_id: "team-other" })),
  ];
  const mixedTimes = (profileType: ProfileType): Set<number> => {
    const out = simulateStageV4(input({ route: route(profileType), startlist: list }));
    return new Set(out.results.filter((r) => r.rider_id.startsWith("m")).map((r) => r.time_seconds));
  };
  assert.ok(mixedTimes("itt").size > 1, "enkeltstarten gav holdet ÉN faelles tid — den er faldet i TTT-grenen");
  assert.equal(mixedTimes("ttt").size, 1);
});

test("ttt-rute UDEN hold-id paa nogen rytter falder tilbage paa vejetape-vejen", () => {
  const list = startlist([60, 50, 40], 8, false);
  const tttOut = simulateStageV4(input({ route: route("ttt"), startlist: list }));
  const roadOut = simulateStageV4(input({ route: route("flat"), startlist: list }));
  // Samme segmenter, samme seed, samme startliste => samme etape. Den eneste
  // forskel mellem de to ruter er profile_type, og uden hold-id maa den ikke
  // aendre en eneste tid.
  assert.deepEqual(
    tttOut.results.map((r) => [r.rider_id, r.time_seconds]),
    roadOut.results.map((r) => [r.rider_id, r.time_seconds]),
  );
});

// ── 2. Determinisme (§3 invariant 1) ────────────────────────────────────────

test("determinisme: samme input to gange giver byte-identisk output", () => {
  const a = simulateStageV4(input());
  const b = simulateStageV4(input());
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("determinisme: startlistens raekkefoelge aendrer intet", () => {
  const list = startlist([60, 50, 40]);
  const a = simulateStageV4(input({ startlist: list }));
  const b = simulateStageV4(input({ startlist: [...list].reverse() }));
  assert.equal(JSON.stringify(a.results), JSON.stringify(b.results));
});

// ── 3. Invariant 3 pr. hold (styrke straffes aldrig) ────────────────────────

test("invariant 3 pr. hold: alle paa samme hold faar samme tid, saa ingen rytter taber paa at vaere staerk", () => {
  // Holdet er gruppen i en TTT. Invariant 3 ("lavere evne giver aldrig bedre
  // tid i samme gruppe") holder derfor med lighed: ingen rytter i gruppen kan
  // faa en bedre tid end en staerkere holdkammerat.
  const list = [
    rider("strong", "team-mixed", 85),
    rider("mid", "team-mixed", 55),
    rider("weak", "team-mixed", 25),
    ...startlist([50], 8).map((e) => ({ ...e, rider_id: `other-${e.rider_id}`, team_id: "team-other" })),
  ];
  const out = simulateStageV4(input({ startlist: list }));
  const byId = new Map(out.results.map((r) => [r.rider_id, r.time_seconds]));
  assert.equal(byId.get("strong"), byId.get("mid"));
  assert.equal(byId.get("mid"), byId.get("weak"));
});

test("invariant 3 paa holdakse: et ens-men-staerkere hold faar aldrig en daarligere tid", () => {
  const list = [...startlist([70], 8), ...startlist([40], 8).map((e) => ({ ...e, rider_id: `w-${e.rider_id}`, team_id: "team-weak" }))];
  const out = simulateStageV4(input({ startlist: list }));
  const byId = new Map(out.results.map((r) => [r.rider_id, r.time_seconds]));
  const strongTime = byId.get("t0r0")!;
  const weakTime = byId.get("w-t0r0")!;
  assert.ok(strongTime <= weakTime, `staerkt hold ${strongTime}s vs. svagt hold ${weakTime}s — styrke maa aldrig straffes`);
});

// ── 4. Tidslinjen ───────────────────────────────────────────────────────────

test("tidslinjen er groen i motorens EGEN validator (km-monotoni + fog-gate)", () => {
  const list = startlist([60, 50, 40]);
  const out = simulateStageV4(input({ startlist: list }));
  const violations = validateTimelineEvents(out.timeline.events, {
    distanceKm: 30,
    knownRiderIds: new Set(list.map((e) => e.rider_id)),
  });
  assert.deepEqual(violations, [], violations.map((v) => `[${v.rule}] ${v.message}`).join("; "));
});

test("finish-eventet baerer win_type ttt_win (loebsfilmens EGEN noegle, ikke et opfundet navn)", () => {
  const out = simulateStageV4(input());
  const finish = out.timeline.events.find((e) => e.type === "finish");
  assert.ok(finish);
  assert.equal(finish.params.win_type, "ttt_win");
});

test("stage_start baerer profile_type ttt (filmens hold-vis start-linje)", () => {
  const out = simulateStageV4(input());
  const start = out.timeline.events.find((e) => e.type === "stage_start");
  assert.equal(start?.params.profile_type, "ttt");
});

// ── 5. En almindelig vejetape er upaavirket ─────────────────────────────────

test("en vejetape MED hold-id er bit-uaendret af M13-forgreningen", () => {
  // Regressionsvagt: forgreningen laeser profile_type FOER noget andet sker, saa
  // en flad etape med hold-id (den normale prod-tilstand siden M16) skal give
  // et resultat der ikke afhaenger af at M13 findes. Vi kan ikke sammenligne
  // mod "foer"-koden her, saa vi maaler det der ville braekke: en flad etape maa
  // ikke give holdvise faellestider.
  const list = startlist([60, 50, 40]);
  const out = simulateStageV4(input({ route: route("flat"), startlist: list }));
  const distinctPerTeam = [...timesByTeam(out, list).values()].map((s) => s.size);
  assert.ok(Math.max(...distinctPerTeam) > 1, "en flad etape maa ikke give ét hold ÉN faelles tid");
  assert.equal(out.results.length, list.length);
});
