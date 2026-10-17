// backend/test/engine/ittTopSpread6645.test.ts
// #6645 (+ #6595): enkeltstartens top-10 var for taet under S5-benchmarken.
//
// Rod-aarsagen: enkeltstartens evne var finale-tuningens `solo_tt`-blanding,
// hvor tempo og udholdenhed fylder meget. Dem har klatrere og klassements-
// ryttere i top, saa en klatrer med middel tidskoersels-evne kom for taet paa
// specialisten. Rettelsen (KUN s5_profiles_v1): enkeltstartens evne er
// tidskoersels-evnen alene; haeldning, terraen-vaegt og stoej er uaendrede.
//
// Testene gater kun RETNINGEN og revisions-graensen. Hvor meget (gap10 pr.
// distance, GC-effekt) maales af backend/scripts/dev/s5MotorBench.mjs, og
// dommen staar i lib/__fixtures__/s5MotorBench.json (s5MotorBench.test.ts
// genkoerer benchen); tallene ligger kun i balance-internals/6645/ (hard rule 17).

import { test } from "node:test";
import assert from "node:assert/strict";

import { simulateStageV4 } from "../../lib/engine/v4/index.ts";
import { RACE_V4_TUNING } from "../../lib/engine/v4/tuning.ts";
import type { AbilityKey, Entrant, RouteV2, Segment, StageInput } from "../../lib/engine/v4/types.ts";
import {
  S5_ITT_ABILITY_VECTOR,
  ittAbilityScore,
  ittAbilityTuning,
} from "../../lib/engine/v4/mechanics/individualTimeTrial.ts";

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

function rider(riderId: string, base: number, overrides: Partial<Record<AbilityKey, number>>, teamId: string): Entrant {
  return { rider_id: riderId, team_id: teamId, abilities: abilities(base, overrides), role: "free_role", effort: "normal", condition: 1 };
}

const FLAT_SEGMENTS: Segment[] = [{ kind: "flat", from_km: 0, to_km: 32 }];

function route(segments: Segment[] = FLAT_SEGMENTS): RouteV2 {
  const distance = segments[segments.length - 1].to_km;
  return {
    distance_km: distance,
    profile_type: "itt",
    finale_type: "solo_tt",
    segments,
    weather: { kind: "sun", wind_exposure: 0.2 },
    waypoints: [{ kind: "finish", index: 0, name: "Maal", km: distance }],
  };
}

/**
 * TT-specialisten (hoej tidskoersels-evne, middel tempo/udholdenhed) og
 * klassementsklatreren (middel tidskoersels-evne, top tempo/udholdenhed) i et
 * felt af jaevne ryttere. Det er netop parret fra #6595.
 */
function field(): Entrant[] {
  const peers = Array.from({ length: 28 }, (_, i) =>
    rider(`p${String(i).padStart(2, "0")}`, 50, { time_trial: 45 + (i % 10), tempo: 50 + (i % 7) }, `team-${Math.floor(i / 4)}`),
  );
  return [
    ...peers,
    rider("tt-spec", 50, { time_trial: 80, tempo: 50, endurance: 50, climbing: 40 }, "team-a"),
    rider("gc-climber", 50, { time_trial: 62, tempo: 85, endurance: 85, climbing: 85 }, "team-b"),
  ];
}

const SEEDS = Array.from({ length: 12 }, (_, i) => `itt-6645-${i}`);

/** Specialistens forspring paa klatreren (s) pr. seed under en revision. */
function margins(rulesRevision: StageInput["rules_revision"]): number[] {
  return SEEDS.map((seed) => {
    const out = simulateStageV4({ route: route(), startlist: field(), orders: [], seed, tuning: RACE_V4_TUNING, rules_revision: rulesRevision });
    const time = new Map(out.results.map((r) => [r.rider_id, r.time_seconds]));
    return (time.get("gc-climber") ?? NaN) - (time.get("tt-spec") ?? NaN);
  });
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

test("#6645: S4 og aeldre revisioner regner med praecis samme tuning-objekt (byte-identisk)", () => {
  for (const rev of [undefined, null, "legacy", "orders_gc_v3", "official_times_v2", "official_times_v3", "official_times_v4"]) {
    assert.equal(ittAbilityTuning(RACE_V4_TUNING, rev), RACE_V4_TUNING, `revision ${String(rev)}`);
  }
});

test("#6645: under s5_profiles_v1 er kun enkeltstartens evne-vektor skiftet", () => {
  const s5 = ittAbilityTuning(RACE_V4_TUNING, "s5_profiles_v1");
  assert.notEqual(s5, RACE_V4_TUNING);
  assert.equal(s5.finale.demandVectorByFinaleType.solo_tt, S5_ITT_ABILITY_VECTOR);
  for (const [finale, vector] of Object.entries(RACE_V4_TUNING.finale.demandVectorByFinaleType)) {
    if (finale !== "solo_tt") assert.equal(s5.finale.demandVectorByFinaleType[finale as keyof typeof vector], vector, finale);
  }
  assert.equal(s5.terrain, RACE_V4_TUNING.terrain);
  assert.equal(s5.dayform, RACE_V4_TUNING.dayform);
  // Selve vektoren er ikke foranderlig (deles af alle S5-etaper).
  assert.ok(Object.isFrozen(S5_ITT_ABILITY_VECTOR));
});

test("#6645: S5-evnen er stigende i tidskoersels-evnen og ikke-faldende i alt andet (styrke straffes aldrig)", () => {
  const s5 = ittAbilityTuning(RACE_V4_TUNING, "s5_profiles_v1");
  const base = abilities(60);
  for (const share of [0, 0.2, 0.5, 1]) {
    for (const kind of ["flat", "rolling", "climb", "descent", "cobbles"] as const) {
      const ref = ittAbilityScore(base, kind, s5, share);
      for (const key of ABILITY_KEYS) assert.ok(ittAbilityScore({ ...base, [key]: 75 }, kind, s5, share) >= ref, `${key} paa ${kind}, andel ${share}`);
      if (share < 1) assert.ok(ittAbilityScore({ ...base, time_trial: 75 }, kind, s5, share) > ref, `time_trial paa ${kind}, andel ${share}`);
    }
  }
  // Paa en flad enkeltstart flytter tempo/udholdenhed ikke laengere evnen.
  assert.equal(ittAbilityScore({ ...base, tempo: 90, endurance: 90 }, "flat", s5, 0), ittAbilityScore(base, "flat", s5, 0));
});

test("#6645/#6595: TT-specialisten slaar klassementsklatreren paa en flad enkeltstart, med stoerre forspring end under S4", () => {
  const s4 = margins("official_times_v4");
  const s5 = margins("s5_profiles_v1");
  assert.ok(s5.every((m) => m > 0), `specialisten foran i ${s5.filter((m) => m > 0).length} af ${s5.length} seeds under S5`);
  assert.ok(mean(s5) > mean(s4), "forspringet skal vokse under S5");
});
