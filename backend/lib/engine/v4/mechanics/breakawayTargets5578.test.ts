// backend/lib/engine/v4/mechanics/breakawayTargets5578.test.ts
// #5578 (KUN official_times_v2): udbruddet holder hjem efter ejer-maalene.
// Testene laaser strukturen (hvilke knapper der kun laeses under
// official_times_v2, hvem der er en rival, at klassementets forreste aldrig
// slippes), ikke de kalibrerede tal (de staar privat i balance-internals/).
import { test } from "node:test";
import assert from "node:assert/strict";

import { assessGcThreat, V3_DANGER_TUNING, type DangerModel } from "./gcThreat.ts";
import { isLetGoChaseGroup, letGoMaxGapSeconds } from "./breakaway.ts";
import { SHARED_TIME_MODEL_V2_TUNING, TIME_MODEL_V3_TUNING, timeModelTuningFor } from "./timeModel.ts";
import { BREAKAWAY_EXTRA_TUNING } from "../tuning.ts";
import type { AbilityKey, Entrant, GcContext, RaceGroup, RouteV2 } from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
const abilities = (level: number) => Object.fromEntries(KEYS.map((k) => [k, level])) as Record<AbilityKey, number>;
const entrant = (id: string, team: string, level: number, role: Entrant["role"] = "helper"): Entrant =>
  ({ rider_id: id, abilities: abilities(level), role, effort: "normal", condition: 1, team_id: team });

const FLAT: RouteV2 = {
  distance_km: 150, profile_type: "flat", finale_type: "bunch_sprint",
  segments: [{ kind: "flat", from_km: 0, to_km: 150 }],
  weather: { kind: "sun", wind_exposure: 0 }, waypoints: [],
};

// Klassementet: tolv ryttere taet samlet (som efter en kort enkeltstart).
const IDS = Array.from({ length: 12 }, (_, i) => `r${i + 1}`);
const ENTRANTS: Record<string, Entrant> = Object.fromEntries(IDS.map((id, i) => [id, entrant(id, `T${i + 1}`, i === 0 ? 80 : 70 - i)]));
const GC: GcContext = {
  status: "standings", stage_number: 3, leader_id: "r1", stages_remaining: 15,
  standings: IDS.map((rider_id, i) => ({ rider_id, rank: i + 1, gap_seconds: i * 10 })),
};
const groups = (breakaway: string[], lead: number): RaceGroup[] => [
  { id: "breakaway-0", kind: "breakaway", rider_ids: breakaway, gap_seconds: 0, cohesion: 1 },
  { id: "peloton-0", kind: "peloton", rider_ids: IDS.filter((id) => !breakaway.includes(id)), gap_seconds: lead, cohesion: 1 },
];
const official: DangerModel = { stagesRemaining: 15, tuning: SHARED_TIME_MODEL_V2_TUNING.gcDanger! };
const v3: DangerModel = { stagesRemaining: 15 };
const assess = (protectedRiderId: string, breakaway: string[], lead: number, dangerModel: DangerModel) =>
  assessGcThreat({ gcContext: GC, groups: groups(breakaway, lead), entrants: ENTRANTS, route: FLAT, protectedRiderId, km: 20, ownTeamId: ENTRANTS[protectedRiderId].team_id as string, dangerModel });

test("#5578: knapperne er neutrale uden official_times_v2 (orders_gc_v3 og aeldre er uroerte)", () => {
  assert.equal(TIME_MODEL_V3_TUNING.gcDanger, null);
  assert.deepEqual(TIME_MODEL_V3_TUNING.letGoMaxGapScaleByProfile, {});
  assert.deepEqual(TIME_MODEL_V3_TUNING.letGoFinaleFactorByFinale, {});
  assert.equal(TIME_MODEL_V3_TUNING.letGoMinChaseRiders, null);
  assert.equal(TIME_MODEL_V3_TUNING.letGoCapAtTolerated, false);
  assert.equal(timeModelTuningFor({ ordersGcV3: true }), TIME_MODEL_V3_TUNING, "orders_gc_v3 uden faelles gruppeklokke");
  assert.equal(timeModelTuningFor({ sharedGroupTime: true }), TIME_MODEL_V3_TUNING, "official_times_v1 (klokke uden v3)");
  const tuned = timeModelTuningFor({ ordersGcV3: true, sharedGroupTime: true, route: { profile_type: "hilly" } });
  assert.ok(tuned.gcDanger !== null && tuned.letGoCapAtTolerated === true && tuned.letGoMinChaseRiders !== null);
  assert.ok(tuned.letGoMaxGapScaleByProfile.mountain !== undefined, "profil-tuningen arver de nye knapper");
  // V3_DANGER_TUNING er praecis de vaerdier v3 brugte foer #5578.
  assert.equal(V3_DANGER_TUNING.rivalRankAlways, null);
  assert.equal(V3_DANGER_TUNING.rankedLeadCapSeconds, null);
});

test("#5578: felt-graensen for lad-gaa er en parameter; udeladt = den gamle graense", () => {
  const min = BREAKAWAY_EXTRA_TUNING.letGoMinChaseRiders;
  assert.equal(isLetGoChaseGroup(min), true);
  assert.equal(isLetGoChaseGroup(min - 1), false);
  assert.equal(isLetGoChaseGroup(min - 1, min - 1), true, "official_times_v2: favoritgruppen er stadig et felt");
  assert.equal(isLetGoChaseGroup(Number.NaN, 1), false);
});

test("#5578: finalens faktor kan erstattes; udeladt = tabellen (bit-identisk)", () => {
  const base = { breakawayRiderIds: ["r11"], fieldRiderIds: IDS, entrants: ENTRANTS, profileType: "mountain" as const, finaleType: "descent" as const };
  const table = BREAKAWAY_EXTRA_TUNING.maxGapFinaleFactor.descent as number;
  assert.equal(letGoMaxGapSeconds(base), letGoMaxGapSeconds({ ...base, finaleFactor: table }));
  assert.ok(letGoMaxGapSeconds({ ...base, finaleFactor: table * 2 }) > letGoMaxGapSeconds(base));
});

test("#5578: kun hold med noget at forsvare reagerer; en rytter langt nede reagerer ikke paa en harmloes udbryder", () => {
  // r12 (rang 12) beskytter; r11 (rang 11, svagere end r1, men staerkere end r12) er i udbrud.
  assert.notEqual(assess("r12", ["r11"], 30, v3).reason, "no_gc_interest", "orders_gc_v3: alle inden for forsvars-vinduet forsvarer");
  assert.equal(assess("r12", ["r11"], 30, official).reason, "no_gc_interest");
});

test("#5578: klassementets forreste er altid en rival og holder altid snoren, med et loft", () => {
  // r5 (rang 5) er svagere end foereren r1: under orders_gc_v3 ingen rival (kun forbigaaende).
  const before = assess("r1", ["r5"], 30, v3);
  assert.notEqual(before.leash_hold, true);
  const after = assess("r1", ["r5"], 30, official);
  assert.equal(after.leash_hold, true);
  assert.deepEqual(after.leash_rider_ids, ["r5"]);
  const cap = SHARED_TIME_MODEL_V2_TUNING.gcDanger!.rankedLeadCapSeconds as number;
  assert.ok((after.tolerated_lead_seconds ?? Infinity) <= cap, "snoren er hoejst loftet lang");
});

test("#5578: uden for de forreste er kun en mindst lige saa staerk rytter en rival", () => {
  // r10 (rang 10) beskytter; r12 er ikke blandt de forreste og er svagere end r10.
  const weaker = assess("r10", ["r12"], 30, official);
  assert.notEqual(weaker.leash_hold, true);
  assert.notEqual(weaker.severity, "serious");
});
