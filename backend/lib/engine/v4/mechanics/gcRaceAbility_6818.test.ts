// backend/lib/engine/v4/mechanics/gcRaceAbility_6818.test.ts
// #6818 (ejer 21/10, "Ja, med A"; KUN s5_profiles_v2): klassementsfavoritten afhaenger af
// loebet. Evnen vaegtes efter loebets egne etaper (etapens krav x hvor meget etapetypen
// flytter klassementet), over RESTEN af loebet fra dagens etape. Strukturelle invarianter
// med ejer-godkendte vaegte (designkort 21/10); ingen maalte tal (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import { raceGcAbilityModel, s5MorningGcExcludedRiders, S5_GC_STAGE_IMPACT } from "./gcThreat.ts";
import type { AbilityKey, Entrant, GcContext, GcStageDemand } from "../types.ts";

const KEYS: AbilityKey[] = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics",
];
function rider(id: string, over: Partial<Record<AbilityKey, number>>): Entrant {
  return { rider_id: id, abilities: { ...Object.fromEntries(KEYS.map((k) => [k, 40])), ...over } as Record<AbilityKey, number>, role: "helper", effort: "normal", condition: 1, team_id: id } as Entrant;
}
// Etapernes krav (samme form som race_stage_profiles.demand_vector).
const D: Record<string, Partial<Record<AbilityKey, number>>> = {
  flat: { sprint: 0.6, acceleration: 0.15, flat: 0.1, positioning: 0.1 },
  rolling: { sprint: 0.3, punch: 0.2, flat: 0.2, endurance: 0.1 },
  hilly: { punch: 0.45, tempo: 0.15, acceleration: 0.1, climbing: 0.1 },
  cobbles: { cobblestone: 0.5, flat: 0.15, positioning: 0.15, endurance: 0.1 },
  mountain: { climbing: 0.7, endurance: 0.15, tempo: 0.1 },
  high_mountain: { climbing: 0.75, endurance: 0.15, recovery: 0.05 },
  itt: { time_trial: 0.8, tempo: 0.15 },
};
const race = (profiles: string[]): GcStageDemand[] => profiles.map((p, i) => ({ stage_number: i + 1, profile_type: p, demand: D[p] }));
function gc(stages: GcStageDemand[], stageNumber = 1): GcContext {
  return { status: "standings", stage_number: stageNumber, leader_id: null, standings: [{ rider_id: "x", rank: 1, gap_seconds: 0 }], race_gc_stages: stages } as GcContext;
}
const FIELD = {
  cobbler: rider("cobbler", { cobblestone: 85, flat: 70, climbing: 30, time_trial: 50, punch: 55 }),
  climber: rider("climber", { climbing: 88, time_trial: 55, tempo: 70, cobblestone: 25, punch: 50 }),
  tt: rider("tt", { time_trial: 88, tempo: 82, climbing: 65, cobblestone: 40, punch: 45 }),
  puncher: rider("puncher", { punch: 86, acceleration: 75, tempo: 68, climbing: 55, cobblestone: 35 }),
  sprinter: rider("sprinter", { sprint: 90, acceleration: 85, flat: 75, climbing: 25, punch: 50 }),
};
const favourite = (model: (e: Entrant | undefined) => number) => Object.values(FIELD).sort((a, b) => model(b) - model(a))[0].rider_id;

test("#6818: brostensloeb (flad, 2 boelget, kuperet, brosten) -> brostensrytteren er favorit", () => {
  assert.equal(favourite(raceGcAbilityModel(gc(race(["flat", "rolling", "rolling", "hilly", "cobbles"])))!), "cobbler");
});

test("#6818: Grand Tour (bjerg + enkeltstart) -> klatreren er favorit, ikke brostens- eller spurtrytteren", () => {
  const gt = race(["flat", "itt", "mountain", "flat", "high_mountain", "hilly", "mountain", "itt", "high_mountain", "flat", "mountain"]);
  const model = raceGcAbilityModel(gc(gt))!;
  assert.equal(favourite(model), "climber");
  assert.ok(model(FIELD.tt) > model(FIELD.cobbler) && model(FIELD.tt) > model(FIELD.sprinter), "enkeltstart tæller i en GT");
});

test("#6818: kuperet ugeloeb (5 kuperet, 2 boelget) -> puncheren er favorit", () => {
  assert.equal(favourite(raceGcAbilityModel(gc(race(["hilly", "rolling", "hilly", "hilly", "rolling", "hilly", "hilly"])))!), "puncher");
});

test("#6818: rene enkeltstartsetaper vaegter fuldt; flade etaper naesten intet", () => {
  assert.equal(S5_GC_STAGE_IMPACT.itt, 1);
  assert.ok(S5_GC_STAGE_IMPACT.flat < S5_GC_STAGE_IMPACT.rolling && S5_GC_STAGE_IMPACT.rolling < S5_GC_STAGE_IMPACT.hilly);
  // Et loeb af flade etaper + én enkeltstart: enkeltstartsrytteren, ikke sprinteren.
  assert.equal(favourite(raceGcAbilityModel(gc(race(["flat", "flat", "flat", "itt"])))!), "tt");
});

test("#6818: resten af loebet fra i dag -> efter brostensetapen er brostensrytteren ikke favorit", () => {
  const stages = race(["cobbles", "cobbles", "mountain"]);
  assert.equal(favourite(raceGcAbilityModel(gc(stages, 1))!), "cobbler", "foer brostenene vejer de ind");
  assert.equal(favourite(raceGcAbilityModel(gc(stages, 3))!), "climber", "efter brostenene afgoer bjerget");
});

test("#6818: er kun flade etaper tilbage, bruges hele loebet (ingen sprinter-favorit paa sidste dag)", () => {
  const stages = race(["mountain", "itt", "mountain", "flat", "flat"]);
  assert.notEqual(favourite(raceGcAbilityModel(gc(stages, 4))!), "sprinter");
  assert.equal(favourite(raceGcAbilityModel(gc(stages, 4))!), favourite(raceGcAbilityModel(gc(stages, 1))!));
});

test("#6818: uden loebets etaper er der ingen model (den faste evne, bit-identisk med foer)", () => {
  assert.equal(raceGcAbilityModel({ status: "standings", stage_number: 2, leader_id: null, standings: [] } as unknown as GcContext), null);
  assert.equal(raceGcAbilityModel({ status: "one_day" }), null);
  assert.equal(raceGcAbilityModel(null), null);
});

test("#6818: blokeringen i morgenudbruddet bruger loebets favoritter (brostensrytter i brostensloeb, klatrer i GT)", () => {
  const entrants = { ...FIELD } as Record<string, Entrant>;
  for (let i = 0; i < 20; i++) entrants[`h${i}`] = rider(`h${i}`, {});
  const racing = new Set(Object.keys(entrants));
  const first = (stages: GcStageDemand[]) => ({ ...gc(stages), threat_model: "s5", first_stage: true, standings: [...racing].map((id) => ({ rider_id: id, rank: 1, gap_seconds: 0 })) } as unknown as GcContext);
  const cobbleRace = s5MorningGcExcludedRiders(first(race(["flat", "rolling", "hilly", "cobbles"])), entrants, 1, racing);
  assert.deepEqual([...cobbleRace], ["cobbler"]);
  const gtRace = s5MorningGcExcludedRiders(first(race(["itt", "mountain", "high_mountain", "mountain"])), entrants, 1, racing);
  assert.deepEqual([...gtRace], ["climber"]);
});
