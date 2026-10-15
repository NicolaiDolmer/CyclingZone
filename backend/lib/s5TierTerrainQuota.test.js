// backend/lib/s5TierTerrainQuota.test.js
// #6367: S5-modellens filler-terræn fordelt efter kvote pr. division. Rene funktioner.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  generateRaceStageProfiles, s5StageRaceFillerSlots, ARCHETYPE_PROFILES, isTimeTrial, timeTrialCap, isOrderArchetypeFeasible,
} from "./raceStageProfileGenerator.js";
import { deriveTerrainType } from "./raceRouteGenerator.js";
import { TERRAIN_TYPES } from "./stageProfileTypes.js";
import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";
import { allocateS5TierFillers, makeS5TierProfileGenerator, tierTerrainLoss } from "./s5TierTerrainQuota.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "__fixtures__", "racePoolCatalog.prod.json");

const stageRace = (archetype, stages, s = 0) => ({
  id: `q-${archetype}-${stages}-${s}`, external_id: `q-${archetype}-${stages}-${s}`, name: "Ronde test",
  terrain_archetype: archetype, race_type: "stage_race", stages, season_id: `season-${s}`, season_variant: 0,
});
const multiset = (types) => [...types].sort().join(",");

// ── generatoren: fillerTypes og s5StageRaceFillerSlots ──────────────────────────

test("#6367 s5StageRaceFillerSlots: null for endagsløb, Grand Tours og ukendt arketype", () => {
  assert.equal(s5StageRaceFillerSlots({ id: "x", race_type: "single", terrain_archetype: "puncheur", stages: 1 }), null);
  assert.equal(s5StageRaceFillerSlots(stageRace("grand_tour", 21)), null);
  assert.equal(s5StageRaceFillerSlots(stageRace(null, 6)), null);
});

test("#6367 s5StageRaceFillerSlots: garantier + naturligt træk = løbets type-multisæt (alle arketyper × seeds)", () => {
  let checked = 0;
  for (const [archetype, cfg] of Object.entries(ARCHETYPE_PROFILES)) {
    if (cfg.kind !== "stage" || cfg.grandTourOrder) continue;
    for (const stages of [3, 5, 7, 9]) {
      for (let s = 0; s < 8; s++) {
        const race = stageRace(archetype, stages, s);
        const slots = s5StageRaceFillerSlots(race);
        const generated = generateRaceStageProfiles(race, { profileModel: "s5" }).map((p) => p.profile_type);
        assert.equal(multiset([...slots.guaranteed, ...slots.natural]), multiset(generated), `${archetype}/${stages} s${s}`);
        assert.equal(slots.ttCap, timeTrialCap(slots.guaranteed, stages));
        for (const t of slots.natural) assert.ok(slots.options.includes(t), `${t} er ikke en filler-type for ${archetype}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 100);
});

test("#6367 fillerTypes = det naturlige træk giver præcis samme løb (bit-identisk)", () => {
  for (const archetype of ["mountain_tour", "balanced_week", "sprinters_week", "summit_tour", "hilly_tour", "cobbled_tour"]) {
    for (let s = 0; s < 5; s++) {
      const race = stageRace(archetype, 7, s);
      const { natural } = s5StageRaceFillerSlots(race);
      assert.deepEqual(
        generateRaceStageProfiles(race, { profileModel: "s5", fillerTypes: natural }),
        generateRaceStageProfiles(race, { profileModel: "s5" }),
        `${archetype} s${s}`,
      );
    }
  }
});

test("#6367 fillerTypes styrer filler-pladserne, og typen følger stadig ruten (B+)", () => {
  let checked = 0;
  for (let s = 0; s < 30; s++) {
    const race = stageRace("mountain_tour", 8, s);
    const { guaranteed, natural, orderArchetype } = s5StageRaceFillerSlots(race);
    const forced = natural.map(() => "rolling");
    if (!isOrderArchetypeFeasible(orderArchetype, [...guaranteed, ...forced])) {
      assert.throws(() => generateRaceStageProfiles(race, { profileModel: "s5", fillerTypes: forced }), /order archetype/);
      continue;
    }
    const stages = generateRaceStageProfiles(race, { profileModel: "s5", fillerTypes: forced });
    assert.equal(multiset(stages.map((p) => p.profile_type)), multiset([...guaranteed, ...forced]), `s${s}`);
    for (const p of stages) {
      if (TERRAIN_TYPES.includes(p.profile_type)) assert.equal(p.profile_type, deriveTerrainType(p.climbs));
    }
    checked += 1;
  }
  assert.ok(checked > 5, `for få løb med en mulig ordnings-arketype (${checked})`);
});

test("#6367 fillerTypes afvises for v5, forkert længde, TT-loftet og Grand Tours", () => {
  const race = stageRace("balanced_week", 7, 1);
  const { natural } = s5StageRaceFillerSlots(race);
  assert.throws(() => generateRaceStageProfiles(race, { fillerTypes: natural }), /profileModel/);
  assert.throws(() => generateRaceStageProfiles(race, { profileModel: "s5", fillerTypes: natural.slice(1) }), /filler slots/);
  assert.throws(() => generateRaceStageProfiles(race, { profileModel: "s5", fillerTypes: natural.map(() => "itt") }), /time-trial cap/);
  assert.throws(() => generateRaceStageProfiles(stageRace("grand_tour", 21), { profileModel: "s5", fillerTypes: ["flat"] }), /Grand Tours/);
});

// ── fordelingen ────────────────────────────────────────────────────────────────

const slot = (id, guaranteed, natural, options, ttCap = 2) => ({ id, guaranteed, natural, options, ttCap });

test("#6367 allocateS5TierFillers: løfter en for lav §6b-andel og sænker tabet", () => {
  // 100 etaper, ingen højbjerg: §6b-målet (12 %) er langt væk.
  const counts = { flat: 30, hilly: 26, rolling: 8, mountain: 20, itt: 10, cobbles: 6 };
  const slots = Array.from({ length: 8 }, (_, i) => slot(`r${i}`, ["flat", "mountain"], ["mountain", "mountain"], ["flat", "hilly", "mountain", "high_mountain", "itt"]));
  const { fillerById, lossBefore, lossAfter, changes } = allocateS5TierFillers({ tier: 3, counts, slots });
  assert.ok(lossAfter < lossBefore, `${lossAfter} < ${lossBefore}`);
  assert.ok(changes > 0);
  const hm = [...fillerById.values()].flat().filter((t) => t === "high_mountain").length;
  assert.ok(hm >= 9, `højbjerg ${hm}`);
});

test("#6367 allocateS5TierFillers: kun arketypens filler-typer, TT-loftet og bjergfrie løb holdes", () => {
  const counts = { flat: 60, hilly: 20, itt: 0, mountain: 10, cobbles: 5, rolling: 5 };
  const slots = [
    slot("cap", ["itt"], ["flat", "flat"], ["flat", "itt", "hilly"], 2), // højst én ekstra TT
    slot("free", ["flat", "hilly"], ["flat", "flat"], ["flat", "hilly", "mountain", "high_mountain"]), // bjergfrit
    slot("narrow", ["flat"], ["flat", "flat"], ["flat", "rolling"]),
  ];
  const { fillerById } = allocateS5TierFillers({ tier: 2, counts, slots });
  const tts = [...slots[0].guaranteed, ...fillerById.get("cap")].filter(isTimeTrial).length;
  assert.ok(tts <= 2, `TT-loftet: ${tts}`);
  for (const t of fillerById.get("free")) assert.ok(!["mountain", "high_mountain"].includes(t), `bjergfrit løb fik ${t}`);
  for (const t of fillerById.get("narrow")) assert.ok(["flat", "rolling"].includes(t));
});

test("#6367 allocateS5TierFillers: deterministisk, og uden lovlige forbedringer røres trækket ikke", () => {
  const counts = { flat: 30, hilly: 30, mountain: 25, itt: 10, cobbles: 5 };
  const slots = [slot("a", ["flat"], ["hilly", "flat"], ["hilly", "flat", "mountain"]), slot("b", ["mountain"], ["flat"], ["flat"])];
  const one = allocateS5TierFillers({ tier: 4, counts, slots });
  const two = allocateS5TierFillers({ tier: 4, counts, slots });
  assert.deepEqual([...one.fillerById], [...two.fillerById]);
  const fixed = allocateS5TierFillers({ tier: 4, counts, slots: [slot("b", ["mountain"], ["flat"], ["flat"])] });
  assert.deepEqual(fixed.fillerById.get("b"), ["flat"]);
  assert.equal(fixed.changes, 0);
});

test("#6367 tierTerrainLoss: 0 kun når alle mål er ramt, og stiger uden for et §5-bånd", () => {
  assert.equal(tierTerrainLoss({}, 1), 0);
  const base = { flat: 24, hilly: 21, rolling: 12, mountain: 16, high_mountain: 12, itt: 10, cobbles: 5 };
  const inside = tierTerrainLoss(base, 2);
  const belowRollingFloor = tierTerrainLoss({ ...base, rolling: 2, hilly: 31 }, 2);
  assert.ok(belowRollingFloor > inside);
});

// ── divisions-generatoren mod det rigtige katalog (fixturen) ─────────────────────

function fixtureTierSeedRaces() {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = new Date("2026-10-27T00:00:00Z");
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from, realDays: 32, baseSeed: 1 });
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return tierPlans.map((t) => ({
    tier: t.tier,
    seedRaces: (t.pools?.[0]?.raceRows ?? []).map((r) => ({
      id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages, race_class: r.race_class ?? null,
      external_id: byId.get(r.pool_race_id)?.external_id ?? null, terrain_archetype: byId.get(r.pool_race_id)?.terrain_archetype ?? null,
      season_id: "quota-test", season_variant: 0,
    })),
  }));
}

test("#6367 makeS5TierProfileGenerator: Grand Tours og endagsløb er uændrede, alle etaper følger B+, og divisionen kommer tættere på målene", () => {
  for (const { tier, seedRaces } of fixtureTierSeedRaces()) {
    let info = null;
    const generate = makeS5TierProfileGenerator({ tier, seedRaces, onAllocate: (a) => { info = a; } });
    const counts = {};
    for (const race of seedRaces) {
      const stages = generate(race);
      const natural = generateRaceStageProfiles(race, { profileModel: "s5" });
      if (race.race_type !== "stage_race" || race.terrain_archetype === "grand_tour") {
        assert.deepEqual(stages, natural, `D${tier} ${race.name}: kun etapeløbenes filler må ændres`);
      }
      for (const p of stages) {
        counts[p.profile_type] = (counts[p.profile_type] ?? 0) + 1;
        if (TERRAIN_TYPES.includes(p.profile_type)) assert.equal(p.profile_type, deriveTerrainType(p.climbs), `D${tier} ${race.name} etape ${p.stage_number}`);
      }
    }
    assert.ok(info, `D${tier}: fordelingen blev aldrig beregnet`);
    assert.ok(info.lossAfter <= info.lossBefore + 1e-9, `D${tier}: ${info.lossAfter} > ${info.lossBefore}`);
    assert.ok(Math.abs(tierTerrainLoss(counts, tier) - info.lossAfter) < 1e-9, `D${tier}: de genererede etaper er ikke dem fordelingen regnede med`);
  }
});

test("#6367 review: grus taeller mod brosten-aksen, saa kvoten ikke tilfoejer ekstra brosten", () => {
  // 100 etaper med 5 grus og 0 brosten: §6b-maalet for brosten er allerede ramt, fordi gaten
  // (computeUniformTierStats) taeller cobbles + gravel. Kvoten maa derfor ikke tilfoeje brosten.
  const counts = { flat: 30, hilly: 25, rolling: 8, mountain: 10, high_mountain: 12, itt: 10, gravel: 5 };
  const slots = Array.from({ length: 6 }, (_, i) => slot(`g${i}`, ["flat"], ["flat", "hilly"], ["flat", "hilly", "cobbles"]));
  const { fillerById } = allocateS5TierFillers({ tier: 2, counts, slots });
  const cobbles = [...fillerById.values()].flat().filter((t) => t === "cobbles").length;
  // Foer rettelsen tilfoejede kvoten 4 (grus talte som 0); nu hoejst 1 (det bloede K-B-maal).
  assert.ok(cobbles <= 1, `kvoten tilfoejede ${cobbles} brosten selvom grus allerede daekker aksen`);
});
