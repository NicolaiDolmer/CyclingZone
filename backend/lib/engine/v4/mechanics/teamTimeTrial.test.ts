// backend/lib/engine/v4/mechanics/teamTimeTrial.test.ts
// Kontrakt- + property-tests for M13 (TTT/holdtidskoersel), #4030.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §8b beslutning 21. Design-skitse: gh issue #2412. Verifikations-baggrund: #3463.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  rotationFrontRiderIds,
  simulateTeamTimeTrialStage,
  type TeamRoster,
} from "./teamTimeTrial.ts";
import { RACE_V4_TUNING, TTT_EXTRA_TUNING } from "../tuning.ts";
import { validateTimelineEvents } from "../timeline.ts";
import type { AbilityKey, Entrant, FlatSegment, RouteV2 } from "../types.ts";

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
        const out = simulateTeamTimeTrialStage(r, teams, `prop-${seed}`, RACE_V4_TUNING);
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
