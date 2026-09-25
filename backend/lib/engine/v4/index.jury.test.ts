// backend/lib/engine/v4/index.jury.test.ts
// #5582 (ejer-beslutning 23/9): JURYEN og POINTSTRAFFEN er koblet ind i
// simulateStageV4.
//
// mechanics/timeLimit.test.ts daekker selve reglerne (hvem der genindsaettes,
// raekkefoelgen efter grupetto-kaedningen, pointstraffens form).
// mechanics/incidents.test.ts daekker jagten tilbage bag foelgebilerne. DENNE
// fil daekker koblingen ende til ende: motorens egne uheld naar juryen, en
// genindsat rytter bliver i loebet med status finished, og han mister sine
// point i etapens passage_totals (UCI 2.6.032).
//
// Scenariet er et bjergfelt med en svag hale, lav positioning (saa uheldene
// faktisk sker) og en tuning med stor fart-spredning (samme greb som M15's
// e2e-test), saa tidsgraensen bider. Seeds loebes igennem, indtil juryen har
// haft noget at goere; testen fejler, hvis den aldrig faar det (ingen tom
// groen test).

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageV4 } from "./index.ts";
import { passageTotals } from "./mechanics/bonusSeconds.ts";
import {
  applyReinstatementPointPenalty,
  JURY_REINSTATED_EVENT,
  reinstatedRiderIdsOf,
} from "./mechanics/timeLimit.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import { validateTimelineEvents } from "./timeline.ts";
import type { AbilityKey, Entrant, RouteV2, StageInput, StageOutput } from "./types.ts";

const ABILITY_KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

function abilities(level: number): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS) out[key] = level;
  // Lav positioning: uheldsrisikoen daempes af evnen, og scenariet skal have uheld.
  out.positioning = 0;
  return out;
}

const STARTLIST: Entrant[] = Array.from({ length: 120 }, (_, i) => ({
  rider_id: `r${String(i).padStart(3, "0")}`,
  abilities: abilities(i < 90 ? 80 : 45 + (i - 90) * 0.7),
  role: "free_role",
  effort: "normal",
  condition: 1,
  team_id: `team-${Math.floor(i / 8)}`,
}));

const ROUTE: RouteV2 = {
  distance_km: 180,
  profile_type: "mountain",
  finale_type: "long_climb",
  segments: [
    { kind: "flat", from_km: 0, to_km: 60 },
    { kind: "climb", from_km: 60, to_km: 90, category: "1", avg_gradient: 7, top_elevation_m: 1800 },
    { kind: "descent", from_km: 90, to_km: 110, technicality: 2 },
    { kind: "flat", from_km: 110, to_km: 150 },
    { kind: "climb", from_km: 150, to_km: 180, category: "HC", avg_gradient: 8, top_elevation_m: 2200 },
  ],
  weather: { kind: "rain", wind_exposure: 0.5 },
  waypoints: [
    { kind: "kom", index: 0, name: "Col A", km: 90, category: "1" },
    { kind: "sprint", index: 0, name: "Sprint", km: 130 },
  ],
};

const TUNING: StageInput["tuning"] = {
  ...RACE_V4_TUNING,
  terrain: { ...RACE_V4_TUNING.terrain, strengthSpeedGain: 0.5, speedMultiplierBounds: [0.35, 1.3] as const },
};

const TEAM_BY_RIDER = new Map(STARTLIST.map((e) => [e.rider_id, e.team_id]));

function run(seedIndex: number): StageOutput {
  return simulateStageV4({ route: ROUTE, startlist: STARTLIST, orders: [], seed: `jury-${seedIndex}`, tuning: TUNING });
}

function juryCases(maxSeeds: number): Array<{ seed: number; output: StageOutput }> {
  const out: Array<{ seed: number; output: StageOutput }> = [];
  for (let s = 0; s < maxSeeds && out.length < 3; s++) {
    const output = run(s);
    if (output.results.some((r) => r.reinstated_by === "jury")) out.push({ seed: s, output });
  }
  return out;
}

test("#5582 e2e: juryen genindsaetter kun uheldsramte (og en holdkammerat i samme maalgruppe)", () => {
  const cases = juryCases(120);
  assert.ok(cases.length > 0, "scenariet skal give juryen noget at goere, ellers tester filen ingenting");
  for (const { output } of cases) {
    const victims = new Set(
      (output.incidents ?? []).filter((i) => i.outcome === "time_loss").map((i) => i.rider_id),
    );
    const byId = new Map(output.results.map((r) => [r.rider_id, r]));
    for (const r of output.results.filter((x) => x.reinstated_by === "jury")) {
      assert.equal(r.status, "finished", "en genindsat rytter er i loebet");
      if (victims.has(r.rider_id)) continue;
      const helpsVictim = [...victims].some((v) => {
        const victim = byId.get(v);
        return victim?.reinstated_by === "jury" && victim.group_id === r.group_id && TEAM_BY_RIDER.get(v) === TEAM_BY_RIDER.get(r.rider_id);
      });
      assert.ok(helpsVictim, `${r.rider_id} blev genindsat uden et uheld og uden at koere med et offer`);
    }
    const event = output.timeline.events.find((e) => e.type === JURY_REINSTATED_EVENT);
    assert.ok(event, "juryens event er paa tidslinjen");
    assert.deepEqual(
      [...(event!.params.rider_ids as string[])].sort(),
      output.results.filter((r) => r.reinstated_by === "jury").map((r) => r.rider_id).sort(),
    );
    const violations = validateTimelineEvents(output.timeline.events, {
      distanceKm: ROUTE.distance_km,
      knownRiderIds: new Set(STARTLIST.map((e) => e.rider_id)),
    });
    assert.deepEqual(violations, [], `tidslinje-brud: ${JSON.stringify(violations)}`);
  }
});

test("#5582 e2e: passage_totals er etapens point MED pointstraffen for alle genindsatte (jury og grupetto)", () => {
  // Pointstraffens form (nul point, bonussekunder uroerte) laases i
  // mechanics/timeLimit.test.ts. Her laases KOBLINGEN: index.ts kalder den med
  // praecis de genindsatte, og alle andre beholder deres point uaendret.
  let reinstatedSeen = 0;
  let pointsKeptSeen = false;
  for (let s = 0; s < 40; s++) {
    const output = run(s);
    const reinstated = reinstatedRiderIdsOf(output);
    reinstatedSeen += reinstated.size;
    const unpenalized = passageTotals(output.passages ?? []);
    assert.deepEqual(output.passage_totals, applyReinstatementPointPenalty(unpenalized, reinstated));
    for (const t of output.passage_totals ?? []) {
      if (reinstated.has(t.rider_id)) {
        assert.equal(t.sprint_points + t.kom_points, 0, `${t.rider_id} er genindsat og maa ingen point have`);
      } else if (t.sprint_points > 0 || t.kom_points > 0) {
        pointsKeptSeen = true;
      }
    }
  }
  assert.ok(reinstatedSeen > 0, "scenariet skal have genindsatte ryttere");
  assert.ok(pointsKeptSeen, "ryttere uden genindsaettelse beholder deres point");
});

test("#5582 e2e: samme seed giver byte-identisk jury-udfald (ingen rng i juryen)", () => {
  const cases = juryCases(120);
  assert.ok(cases.length > 0);
  // Kun seeds hvor juryen faktisk traadte til, sammenlignet med det fangede output.
  for (const { seed, output } of cases) assert.deepEqual(run(seed), output);
});
