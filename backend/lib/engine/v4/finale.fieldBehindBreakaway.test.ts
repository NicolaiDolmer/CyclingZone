// backend/lib/engine/v4/finale.fieldBehindBreakaway.test.ts
// #6073: paa en etape med finale_type "breakaway" beskriver udbrudsdemand
// (aggression, tempo, udholdenhed, taktik) flugten. Foer blev HELE feltet bag
// udbruddet ordnet efter den, saa de oevrige placeringer paa kuperede og
// rullende etaper gik til baroudeurs i stedet for til puncheurs. Nu gaelder den
// kun udbruddet selv; resten afgoer placeringerne paa terraenets egen finale.
// Egen fil, saa den ikke kolliderer med andre spors aendringer i finale.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";

import { fieldFinaleTypeBehindBreakaway, finaleHook, isEscapeGroup } from "./finale.ts";
import { makeHookCtx } from "./testUtils/makeHookCtx.ts";
import { RACE_V4_TUNING } from "./tuning.ts";
import type { AbilityKey, Entrant, EngineState, FinaleType, ProfileType, RaceGroup, RiderState, RouteV2, Segment } from "./types.ts";

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

test("fieldFinaleTypeBehindBreakaway: kun udbrudsfinaler, terraenets egen finale for feltet", () => {
  const r = (profile_type: ProfileType, finale_type: FinaleType | null) => fieldFinaleTypeBehindBreakaway({ profile_type, finale_type });
  assert.equal(r("hilly", "breakaway"), "punch");
  assert.equal(r("rolling", "breakaway"), "punch");
  assert.equal(r("flat", "breakaway"), "bunch_sprint");
  assert.equal(r("mountain", "breakaway"), "long_climb");
  assert.equal(r("hilly", "punch"), null, "ikke en udbrudsfinale: uaendret");
  assert.equal(r("rolling", "reduced_sprint"), null);
  assert.equal(r("hilly", null), null);
  assert.equal(r("itt", "breakaway"), null, "ingen feltfinale paa enkeltstart");
});

test("isEscapeGroup: dagens udbrud (oprindelse breakaway, art breakaway/solo)", () => {
  assert.equal(isEscapeGroup({ kind: "breakaway", origin: "breakaway" } as RaceGroup), true);
  assert.equal(isEscapeGroup({ kind: "solo", origin: "breakaway" } as RaceGroup), true);
  assert.equal(isEscapeGroup({ kind: "peloton", origin: "breakaway" } as RaceGroup), false, "hentet og opslugt");
  assert.equal(isEscapeGroup({ kind: "solo" } as RaceGroup), false, "en solo fra en stigning er ikke udbruddet");
  assert.equal(isEscapeGroup({ kind: "peloton" } as RaceGroup), false);
});

function rider(id: string, group_id: string): RiderState {
  return {
    rider_id: id, group_id, cp: 0.5, wprimeMax: 1, wprime: 0.6, dayform: 0,
    seconds_over_cp: 0, work_norm: 0, incidents: 0, status: "racing", time_seconds: 0,
  } as RiderState;
}

function runFinale(profile_type: ProfileType, finale_type: FinaleType): string[] {
  const entrants: Record<string, Entrant> = {
    // Udbrudsrytteren: staerk i udbrudsevnerne, svag i punch.
    escape: { rider_id: "escape", abilities: abilities(10, { aggression: 90, tempo: 90, endurance: 90, tactics: 90 }), role: "free_role", effort: "normal", condition: 1 },
    // Puncheur i feltet: staerk i punch/acceleration, svag i udbrudsevnerne.
    puncheur: { rider_id: "puncheur", abilities: abilities(10, { punch: 90, acceleration: 90, climbing: 60 }), role: "free_role", effort: "normal", condition: 1 },
    // Baroudeur i feltet: staerk i udbrudsevnerne, svag i punch.
    baroudeur: { rider_id: "baroudeur", abilities: abilities(10, { aggression: 90, tempo: 90, endurance: 90, tactics: 90 }), role: "free_role", effort: "normal", condition: 1 },
  };
  const segment: Segment = { kind: "rolling", from_km: 140, to_km: 150 } as Segment;
  const route = {
    distance_km: 150, profile_type, finale_type, segments: [segment],
    weather: { kind: "sun", wind_exposure: 0.1 }, waypoints: [],
  } as RouteV2;
  const ctx = makeHookCtx({ segment, segmentIndex: 0, route, entrants, tuning: RACE_V4_TUNING, seed: "6073" });
  const state: EngineState = {
    km: 140,
    groups: [
      { id: "breakaway-0", kind: "breakaway", origin: "breakaway", rider_ids: ["escape"], gap_seconds: 0, cohesion: 1 },
      { id: "peloton-0", kind: "peloton", rider_ids: ["baroudeur", "puncheur"], gap_seconds: 0, cohesion: 1 },
    ] as RaceGroup[],
    riders: { escape: rider("escape", "breakaway-0"), puncheur: rider("puncheur", "peloton-0"), baroudeur: rider("baroudeur", "peloton-0") },
    virtual_gc: { escape: 0, puncheur: 0, baroudeur: 0 },
  };
  return finaleHook(state, ctx).state.finish_order ?? [];
}

test("#6073: paa en kuperet udbrudsfinale slaar puncheuren baroudeuren i feltet; udbruddet koerer paa udbrudsevnerne", () => {
  for (const profile of ["hilly", "rolling"] as const) {
    const order = runFinale(profile, "breakaway");
    assert.equal(order[0], "escape", `${profile}: udbrudsrytteren vinder stadig paa sine udbrudsevner`);
    assert.ok(order.indexOf("puncheur") < order.indexOf("baroudeur"), `${profile}: feltet afgoeres paa punch: ${order.join(",")}`);
  }
});

test("#6073: andre finaletyper er uroerte (puncheuren foran paa en punch-finale, ogsaa uden udbrudsgruppe-regel)", () => {
  const order = runFinale("hilly", "punch");
  assert.ok(order.indexOf("puncheur") < order.indexOf("baroudeur"));
  assert.ok(order.indexOf("puncheur") < order.indexOf("escape"), "paa en punch-finale koerer udbrudsrytteren ogsaa paa punch");
});
