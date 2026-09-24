// backend/lib/engine/v4/mechanics/teamTimeTrial.test.ts
// Kontrakt- + property-tests for M13 (TTT/holdtidskoersel), #4030.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §8b beslutning 21. Design-skitse: gh issue #2412. Verifikations-baggrund: #3463.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  applyTeamTimeLimit,
  rotationFrontRiderIds,
  simulateTeamTimeTrialStage,
  type TeamRoster,
} from "./teamTimeTrial.ts";
import { INCIDENTS_EXTRA_TUNING, RACE_V4_TUNING, TTT_EXTRA_TUNING } from "../tuning.ts";
import { validateTimelineEvents } from "../timeline.ts";
import { TIME_LIMIT_TUNING, timeLimitSecondsFor, type TimeLimitTuning } from "./timeLimit.ts";
import { finishPointScale } from "./bonusSeconds.ts";
import type { IncidentsTuning } from "./incidents.ts";
import type { AbilityKey, Entrant, FlatSegment, RouteV2, StageResult } from "../types.ts";

// ── fixtures (samme moenster som groups.test.ts/climbSelection.test.ts) ───────

function abilities(overrides: Partial<Record<AbilityKey, number>> = {}): Record<AbilityKey, number> {
  return {
    climbing: 50, time_trial: 50, flat: 50, tempo: 50, sprint: 50, acceleration: 50,
    punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50,
    cobblestone: 50, positioning: 50, aggression: 50, tactics: 50,
    ...overrides,
  };
}

function entrant(riderId: string, overrides: Partial<Record<AbilityKey, number>> = {}): Entrant {
  return { rider_id: riderId, abilities: abilities(overrides), role: "free_role", effort: "normal", condition: 1 };
}

function roster(teamId: string, riderIds: string[], overrides: Partial<Record<AbilityKey, number>> = {}): TeamRoster {
  return { team_id: teamId, riders: riderIds.map((id) => entrant(id, overrides)) };
}

function flatSegments(count: number, kmPerSegment = 5): FlatSegment[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "flat" as const,
    from_km: i * kmPerSegment,
    to_km: (i + 1) * kmPerSegment,
  }));
}

function route(segmentCount = 6, kmPerSegment = 5): RouteV2 {
  const segments = flatSegments(segmentCount, kmPerSegment);
  return {
    distance_km: segmentCount * kmPerSegment,
    profile_type: "ttt",
    finale_type: "solo_tt",
    segments,
    weather: { kind: "sun", wind_exposure: 0 },
    waypoints: [],
  };
}

// ── #4915: riggede tunings (samme moenster som incidents.test.ts) ─────────────

/** Ingen uheld overhovedet. */
const NO_INCIDENTS: IncidentsTuning = {
  ...INCIDENTS_EXTRA_TUNING,
  baseRiskPerSegment: { flat: 0, rolling: 0, climb: 0, descent: 0, cobbles: 0 },
};

/**
 * Praecis ét uheld pr. etape, og kun for ryttere med positioning 0: risikoen er
 * 1 dér og 0 fra positioning 50 og op, laengde-faktoren daemper ikke, og
 * etape-loftet er ét uheld. Uheldet lander derfor paa segment 0 hos den
 * foerste positioning-0-rytter i rider_id-orden.
 */
function oneIncidentTuning(overrides: Partial<IncidentsTuning> = {}): IncidentsTuning {
  return {
    ...INCIDENTS_EXTRA_TUNING,
    baseRiskPerSegment: { flat: 1, rolling: 1, climb: 1, descent: 1, cobbles: 1 },
    positioningDampening: 0.02,
    referenceSegmentKm: 0.01,
    maxIncidentsFieldShare: 1e-6,
    ...overrides,
  };
}

const ALWAYS_MECHANICAL: Partial<IncidentsTuning> = { mechanicalShare: 1 };
const ALWAYS_SERIOUS_CRASH: Partial<IncidentsTuning> = { mechanicalShare: 0, crashSeverityShares: { hard: 0, serious: 1 } };

/** Hold "team-a" hvor `victim` er den eneste der kan ramme et uheld (positioning 0). */
function victimTeam(victim: string, others: string[], base: Partial<Record<AbilityKey, number>> = {}): TeamRoster {
  return {
    team_id: "team-a",
    riders: [
      entrant(victim, { ...base, positioning: 0 }),
      ...others.map((id) => entrant(id, { ...base, positioning: 99 })),
    ],
  };
}

// ── rotationFrontRiderIds (ren funktion, work-rotation-kravet) ────────────────

test("rotationFrontRiderIds: tomt array giver tomt front-set", () => {
  const front = rotationFrontRiderIds([], 2, 0);
  assert.equal(front.size, 0);
});

test("rotationFrontRiderIds: frontCount clampes til [1, n]", () => {
  const ids = ["a", "b", "c"];
  assert.equal(rotationFrontRiderIds(ids, 0, 0).size, 1);
  assert.equal(rotationFrontRiderIds(ids, 99, 0).size, 3);
});

test("rotationFrontRiderIds: forskellige ryttere paa fronten over segmenter (work-rotation)", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const frontCount = 2;
  const seenAsFront = new Set<string>();
  for (let seg = 0; seg < 6; seg++) {
    for (const id of rotationFrontRiderIds(ids, frontCount, seg)) seenAsFront.add(id);
  }
  // Over en fuld cyklus (n/frontCount = 3 segmenter) skal ALLE ryttere have
  // staaet paa fronten mindst én gang — ikke kun de(n) samme hele vejen.
  assert.deepEqual([...seenAsFront].sort(), ids);
});

test("rotationFrontRiderIds: deterministisk (samme input => samme output)", () => {
  const ids = ["r1", "r2", "r3", "r4", "r5"];
  const a = [...rotationFrontRiderIds(ids, 2, 3)].sort();
  const b = [...rotationFrontRiderIds(ids, 2, 3)].sort();
  assert.deepEqual(a, b);
});

// ── simulateTeamTimeTrialStage: kontrakt-tests ─────────────────────────────────

test("simulateTeamTimeTrialStage: alle ryttere paa et hold faar PRAECIS holdets tid (rent gruppe-princip)", () => {
  const r = route();
  const teams: TeamRoster[] = [roster("team-a", ["a1", "a2", "a3", "a4", "a5", "a6"])];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-ttt-1", RACE_V4_TUNING);

  const times = new Set(out.results.map((res) => res.time_seconds));
  assert.equal(times.size, 1, "ét ensartet hold uden drop skal give ÉN faelles tid");
  assert.equal(out.results.length, 6);
  for (const res of out.results) {
    assert.equal(res.group_id, "ttt-team-a");
    assert.equal(res.status, "finished");
  }
});

test("simulateTeamTimeTrialStage: rank er 1..N sekventielt, sorteret paa tid", () => {
  const r = route();
  const teams: TeamRoster[] = [
    roster("strong", ["s1", "s2", "s3", "s4", "s5"], { time_trial: 90, tempo: 85, endurance: 85 }),
    roster("weak", ["w1", "w2", "w3", "w4", "w5"], { time_trial: 30, tempo: 30, endurance: 30 }),
  ];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-ttt-2", RACE_V4_TUNING);
  const ranks = out.results.map((res) => res.rank);
  assert.deepEqual(ranks, Array.from({ length: ranks.length }, (_, i) => i + 1));
  // Det staerke hold skal vinde (lavere tid) end det svage.
  const strongTime = out.teams.find((t) => t.team_id === "strong")?.time_seconds ?? Infinity;
  const weakTime = out.teams.find((t) => t.team_id === "weak")?.time_seconds ?? -Infinity;
  assert.ok(strongTime < weakTime, `staerkt hold (${strongTime}s) skal slaa svagt hold (${weakTime}s)`);
});

test("simulateTeamTimeTrialStage: determinisme — samme input giver byte-identisk output", () => {
  const r = route();
  const teams: TeamRoster[] = [roster("team-a", ["a1", "a2", "a3", "a4", "a5"])];
  const out1 = simulateTeamTimeTrialStage(r, teams, "seed-determinism", RACE_V4_TUNING);
  const out2 = simulateTeamTimeTrialStage(r, teams, "seed-determinism", RACE_V4_TUNING);
  assert.deepEqual(out1, out2);
});

test("simulateTeamTimeTrialStage: hold-sammensaetning betyder noget — et bredere hold (flere ryttere) er ikke daarligere end et tyndt, alt-andet-lige (#3463: 'ikke bare en ITT med en anden etiket')", () => {
  // Lang, kraevende etape saa work-rotation/udmattelse rent faktisk gør sig
  // gaeldende (kort flad etape udjaevner forskellen for meget til at maale).
  const longRoute = route(20, 5); // 100 km
  const deepTeam = roster("deep", ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"], { time_trial: 60, tempo: 60, endurance: 60, recovery: 60 });
  const thinTeam = roster("thin", ["t1", "t2", "t3"], { time_trial: 60, tempo: 60, endurance: 60, recovery: 60 });
  const out = simulateTeamTimeTrialStage(longRoute, [deepTeam, thinTeam], "seed-depth", RACE_V4_TUNING);

  const deepTime = out.teams.find((t) => t.team_id === "deep")?.time_seconds ?? Infinity;
  const thinTime = out.teams.find((t) => t.team_id === "thin")?.time_seconds ?? Infinity;
  assert.ok(deepTime <= thinTime, `bredere hold (${deepTime}s) skal ikke vaere langsommere end tyndt hold (${thinTime}s) ved samme individuelle evne`);
});

test("simulateTeamTimeTrialStage: countback-K clampes til holdets startantal (lille hold)", () => {
  const r = route();
  assert.ok(TTT_EXTRA_TUNING.countbackRiderRank > 2, "test forudsaetter default-K > holdets stoerrelse her");
  const teams: TeamRoster[] = [roster("small", ["p1", "p2"])];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-small-team", RACE_V4_TUNING);
  const team = out.teams.find((t) => t.team_id === "small");
  assert.ok(team);
  assert.equal(team?.arrived_rider_ids.length, 2);
  assert.ok(team && team.arrived_rider_ids.includes(team.counted_rider_id));
});

test("simulateTeamTimeTrialStage: loads baerer reelt fysiologisk forbrug pr. rytter (#3459-loebsdagskontrakten)", () => {
  const r = route();
  const teams: TeamRoster[] = [roster("team-a", ["a1", "a2", "a3", "a4", "a5"])];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-loads", RACE_V4_TUNING);
  assert.equal(out.loads.length, 5);
  for (const load of out.loads) {
    assert.ok(load.work_norm >= 0);
    assert.ok(load.wprime_depleted_j_norm >= 0);
    assert.ok(load.seconds_over_cp >= 0);
  }
});

test("simulateTeamTimeTrialStage: timeline er km-monotont ordnet, dækker [0, distance_km], og fog-gate-fri", () => {
  const r = route();
  const teams: TeamRoster[] = [
    roster("team-a", ["a1", "a2", "a3", "a4", "a5", "a6"], { time_trial: 20, recovery: 10 }), // lav ability -> sandsynligt drop, oever ttt_rider_dropped-eventet
    roster("team-b", ["b1", "b2", "b3", "b4", "b5"]),
  ];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-timeline", RACE_V4_TUNING);
  const events = out.timeline.events;

  const knownRiderIds = new Set(teams.flatMap((t) => t.riders.map((rd) => rd.rider_id)));
  const violations = validateTimelineEvents(events, { distanceKm: r.distance_km, knownRiderIds });
  assert.deepEqual(violations, []);

  assert.equal(events[0]?.type, "stage_start");
  assert.equal(events[events.length - 1]?.type, "finish");
  for (const e of events) {
    assert.ok(e.km >= 0 && e.km <= r.distance_km, `event ${e.type} km=${e.km} udenfor [0, ${r.distance_km}]`);
  }
});

test("simulateTeamTimeTrialStage: groupSnapshots dækker hvert segment, med gap_seconds >= 0", () => {
  const r = route(4, 5);
  const teams: TeamRoster[] = [roster("team-a", ["a1", "a2", "a3"]), roster("team-b", ["b1", "b2", "b3"], { time_trial: 30 })];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-snapshots", RACE_V4_TUNING);
  assert.equal(out.groupSnapshots.length, 4);
  for (const snap of out.groupSnapshots) {
    assert.equal(snap.groups.length, 2);
    for (const g of snap.groups) assert.ok(g.gap_seconds >= 0);
  }
});

test("simulateTeamTimeTrialStage: en helt udkoerst rytter (0-evne) kan droppes fra holdets front-rotation uden at braekke koerslen", () => {
  const r = route(20, 5);
  const teams: TeamRoster[] = [roster("team-a", ["strong1", "strong2", "strong3", "strong4", "weak"], { time_trial: 85, tempo: 85, endurance: 85, recovery: 80 })];
  // Overskriv kun "weak"s evner til bunden.
  teams[0].riders = teams[0].riders.map((e) =>
    e.rider_id === "weak" ? { ...e, abilities: abilities({ time_trial: 1, tempo: 1, endurance: 1, recovery: 1 }) } : e,
  );
  const out = simulateTeamTimeTrialStage(r, teams, "seed-drop", RACE_V4_TUNING);
  const team = out.teams[0];
  assert.ok(team);
  assert.equal(team.arrived_rider_ids.length, 5);
  // "weak" skal enten vaere droppet eller (i det mindste) ikke crashe simulationen.
  assert.ok(out.results.every((res) => Number.isFinite(res.time_seconds) && res.time_seconds >= 0));
});

// ── Property-test (§7-moenster: min. 4 properties, 200 runs, seeded) ──────────

test("property: monotoni — et hold med UDELUKKENDE staerkere ability-profil faar aldrig en daarligere (hoejere) tid end et ellers identisk svagere hold", () => {
  // deltaBoost holdes >= 10 (ikke fra 0): pr.-rytter-dagsform (physiology.ts,
  // gaussian sd 0.018) er LEGITIM stoej naar to hold har IDENTISKE evner (0-
  // boost) — forskellige rider_id'er giver forskellige dagsform-hash, saa et
  // "lige" opgoer kan gyldigt gaa begge veje. Monotoni-garantien (§2 invariant
  // 3) gaelder en REEL evne-forskel, ikke stoej naar der ingen forskel er.
  // 10 ability-point (paa 0-99-skalaen) giver et cp-bidrag der solidt
  // dominerer dagsform-stoejens spredning (~0.008 efter kvadratmiddel over et
  // 5-mands hold) over 200 seedede koersler.
  fc.assert(
    fc.property(
      fc.integer({ min: 20, max: 80 }),
      fc.integer({ min: 10, max: 40 }),
      fc.string({ minLength: 3, maxLength: 10 }),
      (baseAbility, deltaBoost, seed) => {
        const r = route(8, 5);
        const weakAbilities = { time_trial: baseAbility, tempo: baseAbility, endurance: baseAbility, recovery: baseAbility };
        const strongAbilities = {
          time_trial: Math.min(99, baseAbility + deltaBoost),
          tempo: Math.min(99, baseAbility + deltaBoost),
          endurance: Math.min(99, baseAbility + deltaBoost),
          recovery: Math.min(99, baseAbility + deltaBoost),
        };
        const teams: TeamRoster[] = [
          roster("weak", ["w1", "w2", "w3", "w4", "w5"], weakAbilities),
          roster("strong", ["s1", "s2", "s3", "s4", "s5"], strongAbilities),
        ];
        // Uheld slaaet fra (#4915): monotoni-invarianten gaelder mekanikker der
        // SAMMENLIGNER evner, ikke uheld (incidents.ts's MONOTONI-BEMAERKNING).
        // Et uheld maa gerne koste det staerke hold etapen.
        const out = simulateTeamTimeTrialStage(r, teams, `prop-${seed}`, RACE_V4_TUNING, { incidentsTuning: NO_INCIDENTS });
        const weakTime = out.teams.find((t) => t.team_id === "weak")?.time_seconds ?? -1;
        const strongTime = out.teams.find((t) => t.team_id === "strong")?.time_seconds ?? -1;
        return strongTime <= weakTime;
      },
    ),
    { numRuns: 200, seed: 4030 },
  );
});

test("property: determinisme — simulateTeamTimeTrialStage(x) deep-equal ved gentagne kald", () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 2, max: 9 }), (seed, riderCount) => {
      const r = route(6, 5);
      const teams: TeamRoster[] = [roster("t", Array.from({ length: riderCount }, (_, i) => `r${i}`))];
      const a = simulateTeamTimeTrialStage(r, teams, seed, RACE_V4_TUNING);
      const b = simulateTeamTimeTrialStage(r, teams, seed, RACE_V4_TUNING);
      assert.deepEqual(a, b);
      return true;
    }),
    { numRuns: 200, seed: 4030 },
  );
});

test("property: gruppe-tid — alle STARTENDE ryttere paa et hold har PRAECIS samme StageResult.time_seconds", () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 9 }), (seed, riderCount) => {
      const r = route(6, 5);
      const teams: TeamRoster[] = [roster("t", Array.from({ length: riderCount }, (_, i) => `r${i}`))];
      const out = simulateTeamTimeTrialStage(r, teams, seed, RACE_V4_TUNING);
      const times = new Set(out.results.map((res) => res.time_seconds));
      return times.size === 1;
    }),
    { numRuns: 200, seed: 4030 },
  );
});

test("property: km-daekning — timeline-events ligger altid i [0, distance_km], monotont ikke-faldende", () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 3 }), (seed, teamCount) => {
      const r = route(5, 6);
      const teams: TeamRoster[] = Array.from({ length: teamCount }, (_, i) => roster(`t${i}`, ["r1", "r2", "r3"]));
      const out = simulateTeamTimeTrialStage(r, teams, seed, RACE_V4_TUNING);
      const events = out.timeline.events;
      for (let i = 0; i < events.length; i++) {
        if (events[i].km < 0 || events[i].km > r.distance_km + 1e-9) return false;
        if (i > 0 && events[i].km < events[i - 1].km) return false;
      }
      return true;
    }),
    { numRuns: 200, seed: 4030 },
  );
});

// ── #4915 M10: uheld i holdtidskoerslen ──────────────────────────────────────

test("#4915 M10: et mekanisk uheld hos en rytter der er med holdet koster HOLDETS tid (holdet er ankomstgruppen)", () => {
  const r = route();
  const team = victimTeam("a0", ["a1", "a2", "a3", "a4", "a5"]);
  const base = simulateTeamTimeTrialStage(r, [team], "seed-m10", RACE_V4_TUNING, { incidentsTuning: NO_INCIDENTS });
  const hit = simulateTeamTimeTrialStage(r, [team], "seed-m10", RACE_V4_TUNING, { incidentsTuning: oneIncidentTuning(ALWAYS_MECHANICAL) });

  assert.deepEqual(base.incidents, []);
  assert.equal(hit.incidents?.length, 1);
  const incident = hit.incidents![0];
  assert.equal(incident.rider_id, "a0");
  assert.equal(incident.kind, "mechanical");
  assert.equal(incident.outcome, "time_loss");
  assert.equal(incident.injury_days, null, "et mekanisk uheld skader aldrig (#4520)");
  assert.equal(incident.helper_assist, true, "holdkammeraterne koerer i samme gruppe");
  const loss = incident.time_loss_seconds ?? 0;
  assert.ok(loss > 0);

  // Uheldet flytter kun tiden: fysiologien er den samme, saa holdtiden er
  // basis-tiden plus tabet (afrundet til 2 decimaler).
  const baseTime = base.teams[0].time_seconds;
  const hitTime = hit.teams[0].time_seconds;
  assert.ok(Math.abs(hitTime - (baseTime + loss)) <= 0.011, `holdtid ${hitTime}s, forventet ${baseTime}s + ${loss}s`);
  assert.equal(new Set(hit.results.map((res) => res.time_seconds)).size, 1, "holdet har stadig ÉN tid");
  assert.ok(hit.results.every((res) => res.status === "finished"));
  assert.deepEqual(hit.loads, base.loads, "ventetid er ikke arbejde — belastningen er uaendret");
  assert.ok(hit.timeline.events.some((e) => e.type === "incident" && e.params.rider_id === "a0"));
});

test("#4915 M10: et uheld hos en DROPPET rytter rammer kun ham — han er sin egen ankomstgruppe", () => {
  // 20-km-segmenter: den svage rytter koerer sig ud allerede paa segment 0, saa
  // uheldet (rullet efter segmentets tik) finder ham droppet og alene.
  const r = route(3, 20);
  const strong = { time_trial: 85, tempo: 85, endurance: 85, recovery: 80 };
  const team: TeamRoster = {
    team_id: "team-a",
    riders: [
      entrant("a0", { time_trial: 1, tempo: 1, endurance: 1, recovery: 1, flat: 1, positioning: 0 }),
      ...["a1", "a2", "a3", "a4", "a5"].map((id) => entrant(id, { ...strong, positioning: 99 })),
    ],
  };
  const base = simulateTeamTimeTrialStage(r, [team], "seed-m10-dropped", RACE_V4_TUNING, { incidentsTuning: NO_INCIDENTS });
  const firstDrop = base.timeline.events.find((e) => e.type === "ttt_rider_dropped" && e.params.rider_id === "a0");
  assert.ok(firstDrop && firstDrop.km <= 20, "forudsaetning: a0 er droppet paa segment 0");

  const hit = simulateTeamTimeTrialStage(r, [team], "seed-m10-dropped", RACE_V4_TUNING, { incidentsTuning: oneIncidentTuning(ALWAYS_MECHANICAL) });
  assert.equal(hit.incidents?.length, 1);
  assert.equal(hit.incidents![0].rider_id, "a0");
  assert.equal(hit.incidents![0].helper_assist, false, "en droppet rytter har ingen holdkammerat ved siden af sig");
  assert.equal(hit.teams[0].time_seconds, base.teams[0].time_seconds, "holdets tid er uroert");
  assert.equal(hit.teams[0].counted_rider_id, base.teams[0].counted_rider_id);
});

test("#4915 M10: et alvorligt styrt tager rytteren ud — holdet koerer videre uden ham", () => {
  const r = route();
  const team = victimTeam("a0", ["a1", "a2", "a3", "a4", "a5"]);
  const out = simulateTeamTimeTrialStage(r, [team], "seed-m10-serious", RACE_V4_TUNING, { incidentsTuning: oneIncidentTuning(ALWAYS_SERIOUS_CRASH) });

  assert.equal(out.incidents?.length, 1);
  const incident = out.incidents![0];
  assert.equal(incident.kind, "crash");
  assert.equal(incident.severity, "serious");
  assert.equal(incident.outcome, "abandoned");
  assert.ok((incident.injury_days ?? 0) > 0, "et alvorligt styrt giver skadedage");

  const victim = out.results.find((res) => res.rider_id === "a0")!;
  assert.equal(victim.status, "abandoned");
  assert.equal(victim.rank, out.results.length, "en udgaaet rytter placeres altid bagest");
  assert.equal(victim.injury_days, incident.injury_days);
  assert.deepEqual(out.teams[0].abandoned_rider_ids, ["a0"]);
  assert.ok(!out.teams[0].arrived_rider_ids.includes("a0"), "en udgaaet rytter krydser aldrig stregen");
  const finishers = out.results.filter((res) => res.status === "finished");
  assert.equal(finishers.length, 5);
  assert.equal(new Set(finishers.map((res) => res.time_seconds)).size, 1);
  assert.equal(out.loads.length, 6, "belastningen dokumenteres ogsaa for den udgaaede");
  assert.ok(!out.passages?.some((p) => p.results.some((x) => x.rider_id === "a0")), "en udgaaet rytter tager ingen point");
});

test("#4915 M10: uheldene er deterministiske og bundet af samme etape-loft som vejetapen", () => {
  const r = route();
  const teams: TeamRoster[] = [roster("t1", ["a", "b", "c", "d"]), roster("t2", ["e", "f", "g", "h"])];
  // Alle ryttere har risiko 1 paa hvert segment; loftet (default-andelen af
  // feltet) er det eneste der stopper dem.
  const tuning = oneIncidentTuning({ positioningDampening: 0, maxIncidentsFieldShare: INCIDENTS_EXTRA_TUNING.maxIncidentsFieldShare });
  const a = simulateTeamTimeTrialStage(r, teams, "seed-m10-det", RACE_V4_TUNING, { incidentsTuning: tuning });
  const b = simulateTeamTimeTrialStage(r, teams, "seed-m10-det", RACE_V4_TUNING, { incidentsTuning: tuning });
  assert.deepEqual(a, b);
  const cap = Math.ceil(INCIDENTS_EXTRA_TUNING.maxIncidentsFieldShare * 8);
  assert.equal(a.incidents?.length, cap);
});

test("property #4915: med uheld slaaet til holder tidslinje, placering og hold-tid stadig", () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 3 }), (seed, teamCount) => {
      const r = route(5, 6);
      const teams: TeamRoster[] = Array.from({ length: teamCount }, (_, i) => roster(`t${i}`, [`t${i}a`, `t${i}b`, `t${i}c`, `t${i}d`]));
      // Alle kan ramme et uheld paa hvert segment, loftet er hele feltet: alle
      // trappens udfald (mekanisk, let, haardt, alvorligt) kommer i spil.
      const tuning = oneIncidentTuning({ positioningDampening: 0, maxIncidentsFieldShare: 1 });
      const out = simulateTeamTimeTrialStage(r, teams, seed, RACE_V4_TUNING, { incidentsTuning: tuning });

      const knownRiderIds = new Set(teams.flatMap((t) => t.riders.map((rd) => rd.rider_id)));
      if (validateTimelineEvents(out.timeline.events, { distanceKm: r.distance_km, knownRiderIds }).length > 0) return false;
      if (out.results.length !== knownRiderIds.size) return false;
      if (!out.results.every((res, i) => res.rank === i + 1)) return false;
      // Udgaaede bagest.
      const firstAbandoned = out.results.findIndex((res) => res.status === "abandoned");
      if (firstAbandoned >= 0 && out.results.slice(firstAbandoned).some((res) => res.status !== "abandoned")) return false;
      // Hold-tid: alle der kom i maal paa samme hold har samme tid.
      for (const t of out.teams) {
        const times = new Set(out.results.filter((res) => res.group_id === t.team_group_id && res.status !== "abandoned").map((res) => res.time_seconds));
        if (times.size > 1) return false;
      }
      return true;
    }),
    { numRuns: 200, seed: 4915 },
  );
});

// ── #4915 M15: tidsgraensen som hold-graense ─────────────────────────────────

function res(riderId: string, groupId: string, timeSeconds: number, status: StageResult["status"] = "finished"): StageResult {
  return { rider_id: riderId, rank: 0, time_seconds: timeSeconds, group_id: groupId, status };
}

test("#4915 M15: et hold over graensen er ude — alle dets ryttere, uden grupetto-redning", () => {
  const winnerTime = 3000;
  const limit = timeLimitSecondsFor(winnerTime, "ttt");
  const bigTeam = Array.from({ length: 30 }, (_, i) => `b${String(i).padStart(2, "0")}`);
  const results = [
    res("a1", "ttt-a", winnerTime), res("a2", "ttt-a", winnerTime),
    res("c1", "ttt-c", limit), // PAA graensen er ikke over den
    ...bigTeam.map((id) => res(id, "ttt-b", limit + 1)),
    res("b-out", "ttt-b", limit + 1, "abandoned"),
  ].map((r, i) => ({ ...r, rank: i + 1 }));

  const out = applyTeamTimeLimit({ results, profileType: "ttt", distanceKm: 40 });

  assert.equal(out.winnerTimeSeconds, winnerTime);
  assert.equal(out.limitSeconds, limit);
  assert.deepEqual(out.otlTeamGroupIds, ["ttt-b"]);
  for (const r of out.results) {
    if (r.rider_id === "b-out") assert.equal(r.status, "abandoned", "en udgaaet rytter beholder sin udfaldsklasse");
    else if (r.group_id === "ttt-b") assert.equal(r.status, "otl");
    else assert.equal(r.status, "finished");
  }
  // Rank, tid og raekkefoelge er uroerte.
  assert.deepEqual(out.results.map((r) => [r.rider_id, r.rank, r.time_seconds]), results.map((r) => [r.rider_id, r.rank, r.time_seconds]));
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].type, "outside_time_limit");
  assert.deepEqual(out.events[0].params.rider_ids, bigTeam);
  assert.equal(out.events[0].params.rider_count, bigTeam.length);
  assert.ok(!out.events.some((e) => e.type === "grupetto_saved"), "et helt hold reddes aldrig som grupetto");
});

test("#4915 M15: ingen hold over graensen => uaendret resultat og ingen events", () => {
  const results = [res("a1", "ttt-a", 3000), res("b1", "ttt-b", 3010)].map((r, i) => ({ ...r, rank: i + 1 }));
  const out = applyTeamTimeLimit({ results, profileType: "ttt", distanceKm: 40 });
  assert.deepEqual(out.results, results);
  assert.deepEqual(out.events, []);
  assert.deepEqual(out.otlTeamGroupIds, []);
});

test("#4915 M15: wiret i etapen — et hold over graensen staar som OTL, og eventet ligger efter maal-eventet", () => {
  const r = route();
  // Graensen strammet til nul (kun vinderholdets tid er inden for), saa testen
  // ikke afhaenger af den kalibrerede faktor.
  const strict: TimeLimitTuning = {
    ...TIME_LIMIT_TUNING,
    factorByProfileType: { ...TIME_LIMIT_TUNING.factorByProfileType, ttt: 0 },
  };
  const teams: TeamRoster[] = [
    roster("strong", ["s1", "s2", "s3", "s4", "s5"], { time_trial: 90, tempo: 85, endurance: 85 }),
    roster("weak", ["w1", "w2", "w3", "w4", "w5"], { time_trial: 30, tempo: 30, endurance: 30 }),
  ];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-otl", RACE_V4_TUNING, { incidentsTuning: NO_INCIDENTS, timeLimitTuning: strict });

  assert.ok(out.results.filter((x) => x.rider_id.startsWith("w")).every((x) => x.status === "otl"));
  assert.ok(out.results.filter((x) => x.rider_id.startsWith("s")).every((x) => x.status === "finished"));
  assert.equal(out.teams.find((t) => t.team_id === "weak")?.outside_time_limit, true);
  assert.equal(out.teams.find((t) => t.team_id === "strong")?.outside_time_limit, false);

  const events = out.timeline.events;
  const finishIndex = events.findIndex((e) => e.type === "finish");
  const otlIndex = events.findIndex((e) => e.type === "outside_time_limit");
  assert.ok(finishIndex >= 0 && otlIndex > finishIndex, "tidsgraensen afgoeres foerst naar vinderen er i maal");
  const knownRiderIds = new Set(teams.flatMap((t) => t.riders.map((rd) => rd.rider_id)));
  assert.deepEqual(validateTimelineEvents(events, { distanceKm: r.distance_km, knownRiderIds }), []);
  // Et hold uden for graensen tager ingen maalpoint.
  assert.ok(!out.passages?.some((p) => p.results.some((x) => x.rider_id.startsWith("w"))));
});

test("#4915 M15: med den rigtige faktor koerer et normalt felt ikke uden for graensen", () => {
  const r = route();
  const teams: TeamRoster[] = [
    roster("strong", ["s1", "s2", "s3", "s4", "s5"], { time_trial: 90, tempo: 85, endurance: 85 }),
    roster("weak", ["w1", "w2", "w3", "w4", "w5"], { time_trial: 30, tempo: 30, endurance: 30 }),
  ];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-otl-real", RACE_V4_TUNING, { incidentsTuning: NO_INCIDENTS });
  assert.ok(out.results.every((x) => x.status === "finished"));
  assert.ok(!out.timeline.events.some((e) => e.type === "outside_time_limit"));
});

// ── #4915 M9: maalpassagen og point ──────────────────────────────────────────

test("#4915 M9: TTT giver maalpoint efter ttt-skalaen i placeringsraekkefoelgen og ingen bonussekunder", () => {
  const r = route();
  const teams: TeamRoster[] = [
    roster("strong", ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"], { time_trial: 80, tempo: 75, endurance: 75 }),
    roster("weak", ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"], { time_trial: 40, tempo: 40, endurance: 40 }),
  ];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-points", RACE_V4_TUNING, { incidentsTuning: NO_INCIDENTS });
  const scale = finishPointScale("ttt");
  assert.ok(scale.length > 0);

  const finish = out.passages?.find((p) => p.kind === "finish");
  assert.ok(finish, "TTT'en har en maalpassage");
  const expectedOrder = [...out.results]
    .filter((x) => x.status === "finished")
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.rider_id)
    .slice(0, scale.length);
  assert.deepEqual(finish.results.map((x) => x.rider_id), expectedOrder);
  assert.deepEqual(finish.results.map((x) => x.points), scale.slice(0, expectedOrder.length));
  assert.ok(finish.results.every((x) => x.bonus_seconds === 0), "tidskoersler giver ingen maal-bonussekunder");

  const totals = out.passage_totals ?? [];
  const sprintSum = totals.reduce((sum, t) => sum + t.sprint_points, 0);
  assert.equal(sprintSum, scale.slice(0, expectedOrder.length).reduce((a, b) => a + b, 0));
  assert.ok(totals.every((t) => t.kom_points === 0 && t.bonus_seconds === 0));
  // Vinderholdets ryttere tager de foerste point.
  assert.ok(finish.results.slice(0, 8).every((x) => x.rider_id.startsWith("s")));
});

test("#4915 M9: en summit-finish-top paa en TTT afgoeres af maalordenen med dobbelt point", () => {
  const base = route();
  const r: RouteV2 = {
    ...base,
    waypoints: [
      { kind: "kom", index: 0, name: "Top", km: base.distance_km, category: "1", summit_finish: true },
      { kind: "finish", index: 0, name: "Finish", km: base.distance_km },
    ],
  };
  const teams: TeamRoster[] = [roster("t1", ["a", "b", "c", "d", "e"]), roster("t2", ["f", "g", "h", "i", "j"], { time_trial: 30 })];
  const out = simulateTeamTimeTrialStage(r, teams, "seed-summit", RACE_V4_TUNING, { incidentsTuning: NO_INCIDENTS });
  const kom = out.passages?.find((p) => p.kind === "kom");
  assert.ok(kom);
  assert.deepEqual(kom.results.map((x) => x.rider_id), out.results.slice(0, kom.results.length).map((x) => x.rider_id));
  assert.ok((out.passage_totals ?? []).some((t) => t.kom_points > 0));
  assert.ok(out.timeline.events.some((e) => e.type === "kom_passage"));
});

test("#4915 M9: inden for holdet staar en droppet rytter bag holdkammeraterne der holdt hjulet", () => {
  const r = route(20, 5);
  const teams: TeamRoster[] = [roster("team-a", ["strong1", "strong2", "strong3", "strong4", "zz-weak"], { time_trial: 85, tempo: 85, endurance: 85, recovery: 80 })];
  // "zz-" goer at rider_id-orden alene ville placere ham bagest; "a-weak" tester
  // at det er ANKOMSTEN der afgoer det, ikke navnet.
  teams[0].riders = teams[0].riders.map((e) =>
    e.rider_id === "zz-weak" ? { ...e, rider_id: "a-weak", abilities: abilities({ time_trial: 1, tempo: 1, endurance: 1, recovery: 1 }) } : e,
  );
  const out = simulateTeamTimeTrialStage(r, teams, "seed-drop-order", RACE_V4_TUNING, { incidentsTuning: NO_INCIDENTS });
  assert.ok(out.teams[0].dropped_rider_ids.includes("a-weak"), "forudsaetning: den svage rytter er droppet");
  const weak = out.results.find((x) => x.rider_id === "a-weak")!;
  assert.equal(weak.rank, out.results.length, "den droppede rytter kom sidst i maal og placeres sidst");
  assert.equal(weak.time_seconds, out.teams[0].time_seconds, "men han faar stadig holdets tid (v1)");
});
