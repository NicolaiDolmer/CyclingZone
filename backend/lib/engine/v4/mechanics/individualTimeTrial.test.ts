// backend/lib/engine/v4/mechanics/individualTimeTrial.test.ts
// #5576: enkeltstarten koeres som individuel start. Daekker baade selve
// mekanikken (evne, fart, dagsudsving, M10/M15/M9 pr. rytter) og koblingen i
// simulateStageV4 (itt/itt_hilly forgrener hertil), plus golden fixture'n
// fixtures/itt-solo.
//
// Fejlen der ikke maa komme igen: paa en enkeltstart delte naesten hele feltet
// én tid, der dannedes udbrud, og finalen udsendte `sprint_decided`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStageV4 } from "../index.ts";
import { INCIDENTS_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import { validateGroupMembership, validateTimelineEvents } from "../timeline.ts";
import type { AbilityKey, EngineTuning, Entrant, ProfileType, RouteV2, Segment, StageInput, StageOutput } from "../types.ts";
import type { IncidentsTuning } from "./incidents.ts";
import type { TimeLimitTuning } from "./timeLimit.ts";
import { TIME_LIMIT_TUNING } from "./timeLimit.ts";
import {
  INDIVIDUAL_TIME_TRIAL_TUNING,
  isIndividualTimeTrial,
  ittAbilityScore,
  ittCapacityForSegment,
  ittReferenceByKind,
  ittSpeedKmh,
  ittStageNoise,
  simulateIndividualTimeTrialStage,
} from "./individualTimeTrial.ts";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(base: number, overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = base;
  return { ...out, ...overrides };
}

function rider(riderId: string, base: number, overrides: Partial<Record<AbilityKey, number>> = {}, teamId?: string): Entrant {
  const e: Entrant = { rider_id: riderId, abilities: abilities(base, overrides), role: "free_role", effort: "normal", condition: 1 };
  if (teamId) e.team_id = teamId;
  return e;
}

/** `n` ryttere med spredt evne (TT-evnen styrer, resten fast), fire pr. hold. */
function field(n = 40): Entrant[] {
  return Array.from({ length: n }, (_, i) =>
    rider(`r${String(i).padStart(2, "0")}`, 50, { time_trial: 95 - i * 2, tempo: 80 - i, endurance: 70 - Math.floor(i / 2) }, `team-${Math.floor(i / 4)}`),
  );
}

function route(profileType: ProfileType = "itt", segments?: Segment[]): RouteV2 {
  const segs = segments ?? [{ kind: "flat", from_km: 0, to_km: 32 }];
  const distance = segs[segs.length - 1].to_km;
  return {
    distance_km: distance,
    profile_type: profileType,
    finale_type: "solo_tt",
    segments: segs,
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distance }],
  };
}

const HILLY_SEGMENTS: Segment[] = [
  { kind: "flat", from_km: 0, to_km: 10 },
  { kind: "climb", from_km: 10, to_km: 15, category: "3", avg_gradient: 5.6, top_elevation_m: 480 },
  { kind: "descent", from_km: 15, to_km: 19, technicality: 1 },
  { kind: "flat", from_km: 19, to_km: 30 },
];

function input(overrides: Partial<StageInput> = {}): StageInput {
  return { route: route(), startlist: field(), orders: [], seed: "itt-seed", tuning: RACE_V4_TUNING, ...overrides };
}

/** Motor-tuning uden dagsform og jour sans — til tests der maaler evne alene. */
const NO_DAYFORM: EngineTuning = { ...RACE_V4_TUNING, dayform: { ...RACE_V4_TUNING.dayform, sd: 0, jourSansPBase: 0 } };
const NO_NOISE = { ...INDIVIDUAL_TIME_TRIAL_TUNING, stageNoiseSd: 0 };
const NO_INCIDENTS: IncidentsTuning = {
  ...INCIDENTS_EXTRA_TUNING,
  baseRiskPerSegment: { flat: 0, rolling: 0, climb: 0, descent: 0, cobbles: 0 },
};

function eventTypes(out: StageOutput): string[] {
  return out.timeline.events.map((e) => e.type);
}

// ── 1. Koblingen: itt og itt_hilly forgrener, alt andet goer ikke ─────────────

test("diskriminatoren: itt og itt_hilly er enkeltstarter, ttt og vejetaper er ikke", () => {
  assert.equal(isIndividualTimeTrial("itt"), true);
  assert.equal(isIndividualTimeTrial("itt_hilly"), true);
  for (const other of ["ttt", "flat", "mountain", null, undefined] as const) {
    assert.equal(isIndividualTimeTrial(other as ProfileType | null | undefined), false, String(other));
  }
});

for (const profileType of ["itt", "itt_hilly"] as const) {
  test(`#5576: ${profileType} giver HVER rytter sin egen tid (ikke en massestart)`, () => {
    const list = field(40);
    const segs = profileType === "itt_hilly" ? HILLY_SEGMENTS : undefined;
    const out = simulateStageV4(input({ route: route(profileType, segs), startlist: list }));
    assert.equal(out.results.length, list.length, "invariant 6: hele startlisten i resultatet");
    const distinct = new Set(out.results.map((r) => r.time_seconds));
    assert.equal(distinct.size, list.length, `${distinct.size} forskellige tider for ${list.length} ryttere`);
  });

  test(`#5576: ${profileType} har intet udbrud, ingen finale-spurt og win_type itt_win`, () => {
    const segs = profileType === "itt_hilly" ? HILLY_SEGMENTS : undefined;
    const out = simulateStageV4(input({ route: route(profileType, segs) }));
    const types = eventTypes(out);
    assert.ok(!types.includes("sprint_decided"), "en enkeltstart har ingen spurt");
    assert.ok(!types.some((t) => t.startsWith("breakaway")), "en enkeltstart har intet udbrud");
    assert.ok(!types.includes("peloton_splits"), "der er intet felt at splitte");
    for (const snapshot of out.groupSnapshots) {
      assert.ok(snapshot.groups.every((g) => g.kind === "solo"), "hver rytter koerer alene");
    }
    const finish = out.timeline.events.find((e) => e.type === "finish");
    assert.equal(finish?.params.win_type, "itt_win");
    const start = out.timeline.events.find((e) => e.type === "stage_start");
    assert.equal(start?.params.profile_type, profileType);
  });
}

test("holdkammerater faar hver sin tid paa en enkeltstart (holdet er ikke en gruppe)", () => {
  const list = [
    rider("a", 50, { time_trial: 90 }, "team-x"), rider("b", 50, { time_trial: 70 }, "team-x"),
    rider("c", 50, { time_trial: 50 }, "team-x"), rider("d", 50, { time_trial: 30 }, "team-x"),
  ];
  const out = simulateStageV4(input({ startlist: list }));
  assert.equal(new Set(out.results.map((r) => r.time_seconds)).size, 4);
  assert.ok(out.results.every((r) => r.group_id === `itt-${r.rider_id}`), "gruppe-id er rytterens egen");
});

test("hold-id aendrer intet paa en enkeltstart (der er intet holdspil mod uret)", () => {
  const withTeams = field(24);
  const withoutTeams = withTeams.map(({ team_id: _team, ...rest }) => rest as Entrant);
  const a = simulateStageV4(input({ startlist: withTeams }));
  const b = simulateStageV4(input({ startlist: withoutTeams }));
  assert.deepEqual(a.results, b.results);
});

// ── 2. Determinisme (§3 invariant 1) ────────────────────────────────────────

test("determinisme: samme input giver byte-identisk output, og startlistens raekkefoelge er ligegyldig", () => {
  const list = field(30);
  const a = simulateStageV4(input({ startlist: list }));
  const b = simulateStageV4(input({ startlist: list }));
  const c = simulateStageV4(input({ startlist: [...list].reverse() }));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a.results), JSON.stringify(c.results));
});

test("dagsudsvinget er seedet pr. rytter og nul naar det er slaaet fra", () => {
  assert.equal(ittStageNoise("s", "r1", INDIVIDUAL_TIME_TRIAL_TUNING), ittStageNoise("s", "r1", INDIVIDUAL_TIME_TRIAL_TUNING));
  assert.notEqual(ittStageNoise("s", "r1", INDIVIDUAL_TIME_TRIAL_TUNING), ittStageNoise("s", "r2", INDIVIDUAL_TIME_TRIAL_TUNING));
  assert.notEqual(ittStageNoise("s", "r1", INDIVIDUAL_TIME_TRIAL_TUNING), ittStageNoise("t", "r1", INDIVIDUAL_TIME_TRIAL_TUNING));
  assert.equal(ittStageNoise("s", "r1", NO_NOISE), 0);
});

// ── 3. Styrke straffes aldrig (§3 invariant 3, ejer 4/8) ─────────────────────

test("evne-scoren er monotont ikke-faldende i hver evne, paa hvert terraen", () => {
  for (const kind of ["flat", "rolling", "climb", "descent", "cobbles"] as const) {
    for (const key of ABILITY_KEYS) {
      for (const level of [0, 11, 30, 60, 98]) {
        const lo = ittAbilityScore(abilities(50, { [key]: level }), kind, RACE_V4_TUNING);
        const hi = ittAbilityScore(abilities(50, { [key]: level + 1 }), kind, RACE_V4_TUNING);
        assert.ok(hi >= lo, `${kind}/${key}@${level}: ${hi} < ${lo}`);
      }
    }
  }
});

test("farten er stigende i evne paa hvert terraen, og feltets reference flytter kun nulpunktet", () => {
  for (const kind of ["flat", "rolling", "climb", "descent", "cobbles"] as const) {
    let previous = -Infinity;
    for (let c = -0.2; c <= 1.0; c += 0.05) {
      const v = ittSpeedKmh(c, 0.5, kind, RACE_V4_TUNING);
      assert.ok(v >= previous, `${kind}: fart faldt ved evne ${c.toFixed(2)}`);
      previous = v;
    }
    // Samme evne-forskel giver samme TIDSGAB, uanset feltets niveau (inden for
    // clamp): afstanden mellem to ryttere afhaenger af DERES evne, ikke af
    // hvem der ellers stiller op.
    const secondsPer10Km = (c: number, ref: number) => (10 / ittSpeedKmh(c, ref, kind, RACE_V4_TUNING)) * 3600;
    const strongField = secondsPer10Km(0.5, 0.6) - secondsPer10Km(0.6, 0.6);
    const weakField = secondsPer10Km(0.2, 0.3) - secondsPer10Km(0.3, 0.3);
    assert.ok(strongField > 0);
    assert.ok(Math.abs(strongField - weakField) < 1e-6, `${kind}: gab ${strongField} i staerkt felt, ${weakField} i svagt`);
  }
});

test("hele etapen: to ryttere skilles af samme tid i et staerkt og et svagt felt", () => {
  const pair = [rider("x", 50, { time_trial: 80 }), rider("y", 50, { time_trial: 60 })];
  const strong = [...pair, ...Array.from({ length: 20 }, (_, i) => rider(`s${i}`, 75, { time_trial: 90 }))];
  const weak = [...pair, ...Array.from({ length: 20 }, (_, i) => rider(`w${i}`, 20, { time_trial: 20 }))];
  const opts = { ittTuning: NO_NOISE, incidentsTuning: NO_INCIDENTS };
  const gap = (list: Entrant[]) => {
    const out = simulateIndividualTimeTrialStage(route(), list, "field", NO_DAYFORM, opts);
    const t = new Map(out.results.map((r) => [r.rider_id, r.time_seconds]));
    return t.get("y")! - t.get("x")!;
  };
  assert.ok(gap(strong) > 0);
  assert.ok(Math.abs(gap(strong) - gap(weak)) <= 0.02, `gab ${gap(strong)} s i staerkt felt, ${gap(weak)} s i svagt`);
});

test("uden stoej er raekkefoelgen praecis TT-evnens (flad enkeltstart)", () => {
  const list = field(30);
  const out = simulateIndividualTimeTrialStage(route(), list, "ordered", NO_DAYFORM, { ittTuning: NO_NOISE, incidentsTuning: NO_INCIDENTS });
  const order = out.results.map((r) => r.rider_id);
  const expected = [...list].sort((a, b) => b.abilities.time_trial - a.abilities.time_trial).map((e) => e.rider_id);
  assert.deepEqual(order, expected);
});

test("stigningen giver klatreren en fordel paa itt_hilly, ikke paa den flade itt", () => {
  const list = [
    rider("tt", 50, { time_trial: 85, climbing: 40 }),
    rider("climber", 50, { time_trial: 70, climbing: 95 }),
    ...field(20),
  ];
  const opts = { ittTuning: NO_NOISE, incidentsTuning: NO_INCIDENTS };
  const flat = simulateIndividualTimeTrialStage(route("itt", [{ kind: "flat", from_km: 0, to_km: 30 }]), list, "x", NO_DAYFORM, opts);
  const hilly = simulateIndividualTimeTrialStage(route("itt_hilly", HILLY_SEGMENTS), list, "x", NO_DAYFORM, opts);
  const gap = (out: StageOutput) => {
    const t = new Map(out.results.map((r) => [r.rider_id, r.time_seconds]));
    return t.get("climber")! - t.get("tt")!;
  };
  assert.ok(gap(flat) > 0, "TT-rytteren slaar klatreren paa fladt");
  assert.ok(gap(hilly) < gap(flat), "stigningen skal hente tid ind for klatreren");
});

test("kapaciteten har intet gulv paa 0 (ellers ville de svageste dele én tid)", () => {
  const weak = rider("weak", 0);
  const seg: Segment = { kind: "flat", from_km: 0, to_km: 10 };
  const bad = ittCapacityForSegment(weak, { wprime: 1, wprimeMax: 1, dayform: -0.05 }, seg, RACE_V4_TUNING, { kind: "sun", wind_exposure: 0 }, -0.02);
  const worse = ittCapacityForSegment(weak, { wprime: 1, wprimeMax: 1, dayform: -0.05 }, seg, RACE_V4_TUNING, { kind: "sun", wind_exposure: 0 }, -0.04);
  assert.ok(bad < 0 && worse < bad);
  const ref = ittReferenceByKind(field(20), RACE_V4_TUNING).flat;
  assert.ok(ittSpeedKmh(worse, ref, "flat", RACE_V4_TUNING) < ittSpeedKmh(bad, ref, "flat", RACE_V4_TUNING));
});

// ── 4. Realisme (størrelsesorden, ikke kalibrering — den bor i harnessen) ────

test("tiderne er i virkelighedens stoerrelsesorden: 32 km flad enkeltstart", () => {
  const out = simulateStageV4(input());
  const winner = out.results[0].time_seconds;
  // Gennemsnitsfart for vinderen mellem 40 og 60 km/t.
  const speed = 32 / (winner / 3600);
  assert.ok(speed > 40 && speed < 60, `vinderfart ${speed.toFixed(1)} km/t`);
  // Et spredt felt (TT-evne fra top til bund) skilles af minutter, ikke sekunder,
  // og holder sig inden for tidsgraensen.
  const last = out.results.filter((r) => r.status === "finished").at(-1)!.time_seconds;
  assert.ok(last - winner > 60, `hele feltet inden for ${(last - winner).toFixed(0)} s`);
  assert.ok(out.results.every((r) => r.status !== "otl"), "ingen rytter uden for tidsgraensen paa en normal enkeltstart");
});

test("gabene vokser med distancen (en prolog er taettere end en lang enkeltstart)", () => {
  const list = field(20);
  const opts = { ittTuning: NO_NOISE, incidentsTuning: NO_INCIDENTS };
  const spread = (km: number) => {
    const out = simulateIndividualTimeTrialStage(route("itt", [{ kind: "flat", from_km: 0, to_km: km }]), list, "d", NO_DAYFORM, opts);
    return out.results.at(-1)!.time_seconds - out.results[0].time_seconds;
  };
  assert.ok(spread(40) > 3 * spread(8), "en 40 km-enkeltstart skal sprede langt mere end en 8 km-prolog");
});

// ── 5. M10/M15/M9 pr. rytter (kernens mekanikker med én rytter pr. enhed) ────

test("M10: et uheld koster kun den ramte rytter tid; ingen hjaelper taet paa", () => {
  const list = [rider("victim", 50, { positioning: 0, time_trial: 60 }), ...field(10).map((e) => ({ ...e, abilities: { ...e.abilities, positioning: 99 } }))];
  const oneIncident: IncidentsTuning = {
    ...INCIDENTS_EXTRA_TUNING,
    baseRiskPerSegment: { flat: 1, rolling: 1, climb: 1, descent: 1, cobbles: 1 },
    positioningDampening: 0.02,
    referenceSegmentKm: 0.01,
    maxIncidentsFieldShare: 1e-6,
    mechanicalShare: 1,
  };
  const base = simulateIndividualTimeTrialStage(route(), list, "m10", RACE_V4_TUNING, { incidentsTuning: NO_INCIDENTS });
  const hit = simulateIndividualTimeTrialStage(route(), list, "m10", RACE_V4_TUNING, { incidentsTuning: oneIncident });
  assert.equal(hit.incidents?.length, 1);
  assert.equal(hit.incidents?.[0].rider_id, "victim");
  assert.equal(hit.incidents?.[0].helper_assist, false, "en enkeltstart har ingen holdkammerat taet paa");
  const t = (out: StageOutput) => new Map(out.results.map((r) => [r.rider_id, r.time_seconds]));
  const before = t(base);
  const after = t(hit);
  assert.ok(after.get("victim")! > before.get("victim")!);
  for (const e of list.filter((x) => x.rider_id !== "victim")) {
    assert.equal(after.get(e.rider_id), before.get(e.rider_id), `${e.rider_id} maa ikke betale for andres uheld`);
  }
});

test("M15: tidsgraensen er individuel og maales mod vindertiden", () => {
  const strict: TimeLimitTuning = {
    ...TIME_LIMIT_TUNING,
    factorByProfileType: { ...TIME_LIMIT_TUNING.factorByProfileType, itt: 0.02 },
  };
  const out = simulateIndividualTimeTrialStage(route(), field(20), "m15", RACE_V4_TUNING, { timeLimitTuning: strict, incidentsTuning: NO_INCIDENTS });
  const winner = out.results[0];
  assert.equal(winner.status, "finished");
  const limit = winner.time_seconds * 1.02;
  for (const r of out.results) {
    assert.equal(r.status === "otl", r.time_seconds > limit, `${r.rider_id}: ${r.time_seconds} mod graensen ${limit}`);
  }
  assert.ok(out.results.some((r) => r.status === "otl"), "den stramme graense skal ramme nogen");
  assert.ok(out.timeline.events.some((e) => e.type === "outside_time_limit"));
});

test("M9: maalpassagen giver point i placeringsraekkefoelge, men aldrig bonussekunder", () => {
  const out = simulateStageV4(input());
  const finish = out.passages?.find((p) => p.kind === "finish");
  assert.ok(finish);
  assert.equal(finish.results[0].rider_id, out.results[0].rider_id);
  assert.ok(finish.results.some((r) => r.points > 0));
  assert.ok((out.passage_totals ?? []).every((t) => t.bonus_seconds === 0));
});

test("M9 undervejs: bjergpointene paa en kuperet enkeltstart gaar til den hurtigste op til toppen", () => {
  const list = [
    rider("tt", 50, { time_trial: 90, climbing: 40 }),
    rider("climber", 50, { time_trial: 60, climbing: 95 }),
    ...field(12),
  ];
  const r: RouteV2 = {
    ...route("itt_hilly", HILLY_SEGMENTS),
    waypoints: [
      { kind: "kom", index: 0, name: "Top", km: 15, category: "3", summit_finish: false },
      { kind: "finish", index: 0, name: "Maal", km: 30 },
    ],
  };
  const out = simulateIndividualTimeTrialStage(r, list, "kom", NO_DAYFORM, { ittTuning: NO_NOISE, incidentsTuning: NO_INCIDENTS });
  const kom = out.passages?.find((p) => p.kind === "kom");
  assert.ok(kom, "den kategoriserede stigning skal give bjergpoint (paritet med massestarts-vejen og v3)");
  assert.equal(kom.results[0].rider_id, "climber", "klatreren er hurtigst op til toppen");
  assert.ok(kom.results.every((x) => x.bonus_seconds === 0), "en bjergtop giver aldrig bonussekunder");
  assert.ok(out.timeline.events.some((e) => e.type === "kom_passage"));
  const totals = new Map((out.passage_totals ?? []).map((t) => [t.rider_id, t]));
  assert.ok((totals.get("climber")?.kom_points ?? 0) > 0);
  // Et indlagt spurt-vejpunkt paa en enkeltstart giver point, men aldrig sekunder.
  const withSprint = simulateIndividualTimeTrialStage(
    { ...r, waypoints: [...r.waypoints, { kind: "sprint", index: 0, name: "Spurt", km: 8 }] },
    list, "kom", NO_DAYFORM, { ittTuning: NO_NOISE, incidentsTuning: NO_INCIDENTS },
  );
  const sprint = withSprint.passages?.find((p) => p.kind === "sprint");
  assert.ok(sprint);
  assert.ok(sprint.results.every((x) => x.bonus_seconds === 0));
});

test("belastningen maales pr. rytter (#3459): alle ryttere har reelt arbejde", () => {
  const list = field(12);
  const out = simulateStageV4(input({ startlist: list }));
  assert.equal(out.loads.length, list.length);
  assert.ok(out.loads.every((l) => l.work_norm > 0));
});

test("tidslinjen og gruppe-snapshots er groenne i motorens egne validatorer", () => {
  const list = field(20);
  for (const segs of [undefined, HILLY_SEGMENTS]) {
    const r = route(segs ? "itt_hilly" : "itt", segs);
    const out = simulateStageV4(input({ route: r, startlist: list }));
    const violations = [
      ...validateTimelineEvents(out.timeline.events, { distanceKm: r.distance_km, knownRiderIds: new Set(list.map((e) => e.rider_id)) }),
      ...validateGroupMembership(out.timeline.events, out.groupSnapshots),
    ];
    assert.deepEqual(violations, [], violations.map((v) => `[${v.rule}] ${v.message}`).join("; "));
    assert.ok(!out.timeline.events.some((e) => e.type === "gap_update"), "ingen gap-kurve pr. rytter paa en enkeltstart");
  }
});

// ── 6. Golden fixture: itt-solo ─────────────────────────────────────────────

test("golden fixture: itt-solo — bit-identitet, individuelle tider, TT-specialisten vinder", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "itt-solo");
  const fixtureInput = JSON.parse(readFileSync(path.join(dir, "input.json"), "utf8")) as StageInput;
  const expected = JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")) as StageOutput;
  const actual = simulateStageV4(fixtureInput);
  assert.deepEqual(actual, expected, "simulateStageV4(input) skal matche det frosne expected.json bit-for-bit");

  assert.equal(actual.results[0].rider_id, "r01", "feltets bedste enkeltstartsrytter vinder");
  assert.equal(new Set(actual.results.map((r) => r.time_seconds)).size, fixtureInput.startlist.length);
  assert.ok(!eventTypes(actual).includes("sprint_decided"));
  const spread = actual.results.at(-1)!.time_seconds - actual.results[0].time_seconds;
  assert.ok(spread > 60 && spread < 600, `feltets spredning ${spread.toFixed(0)} s paa 32 km`);
});
