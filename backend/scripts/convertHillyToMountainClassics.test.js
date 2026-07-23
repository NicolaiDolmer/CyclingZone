import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATES,
  CANDIDATE_RACE_IDS,
  planOne,
  buildConversionPlan,
} from "./convertHillyToMountainClassics.js";
import { GENERATOR_VERSION, generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";

const SEASON_ID = "season-2-uuid";

function makeRace(overrides = {}) {
  return {
    id: "race-1",
    name: "Test Klassieker",
    race_type: "single",
    season_id: SEASON_ID,
    pool_race_id: "pool-1",
    ...overrides,
  };
}

function makeProfileRow(overrides = {}) {
  return {
    race_id: "race-1",
    stage_number: 1,
    profile_type: "hilly",
    finale_type: "punch",
    distance_km: 190,
    elevation_gain_m: 1500,
    is_manual: false,
    ...overrides,
  };
}

test("planOne: manglende race -> error", () => {
  const p = planOne({ race: null, profileRow: makeProfileRow(), externalId: "ext-1", expectedSeasonId: SEASON_ID });
  assert.equal(p.status, "error");
  assert.match(p.reason, /ikke fundet/);
});

test("planOne: race_type != single -> error (rører ALDRIG etapeløb)", () => {
  const race = makeRace({ race_type: "stage_race" });
  const p = planOne({ race, profileRow: makeProfileRow(), externalId: "ext-1", expectedSeasonId: SEASON_ID });
  assert.equal(p.status, "error");
  assert.match(p.reason, /race_type/);
});

test("planOne: forkert season_id -> error (sikkerheds-guard)", () => {
  const race = makeRace({ season_id: "some-other-season" });
  const p = planOne({ race, profileRow: makeProfileRow(), externalId: "ext-1", expectedSeasonId: SEASON_ID });
  assert.equal(p.status, "error");
  assert.match(p.reason, /season_id/);
});

test("planOne: ingen race_stage_profiles-række -> error", () => {
  const race = makeRace();
  const p = planOne({ race, profileRow: undefined, externalId: "ext-1", expectedSeasonId: SEASON_ID });
  assert.equal(p.status, "error");
  assert.match(p.reason, /race_stage_profiles/);
});

test("planOne: allerede konverteret (is_manual + mountain-profil) -> skip, ingen update", () => {
  const race = makeRace();
  const profileRow = makeProfileRow({ profile_type: "high_mountain", is_manual: true });
  const p = planOne({ race, profileRow, externalId: "ext-1", expectedSeasonId: SEASON_ID });
  assert.equal(p.status, "skip_already_converted");
  assert.equal(p.update, undefined);
});

test("planOne: is_manual men IKKE et bjerg-profil (håndkurateret til noget andet) -> IKKE 'allerede konverteret', men blokeres nu af hilly-guarden", () => {
  // Et håndredigeret løb der (usandsynligt, men muligt) blev sat manuelt til fx 'flat'
  // skal IKKE regnes som "allerede konverteret" bare fordi is_manual=true — MEN skal
  // heller ikke stille konverteres til bjerg (hærdning #2837 pkt.2: kun hilly er en
  // gyldig kandidat). Adfærden ændrede sig fra v1 (som konverterede den) til v2
  // (som blokerer HELE kørslen) efter adversarielt review.
  const race = makeRace();
  const profileRow = makeProfileRow({ profile_type: "flat", is_manual: true });
  const p = planOne({ race, profileRow, externalId: "ext-1", expectedSeasonId: SEASON_ID });
  assert.equal(p.status, "error");
  assert.match(p.reason, /profile_type/);
});

test("planOne: hærdning (#2837 pkt.2) — profile_type != 'hilly' (og ikke allerede korrekt konverteret) -> error, blokerer ALT før første write", () => {
  // Beskytter mod en fremtidig fejlskrevet race_id i CANDIDATES der peger på et
  // flat/itt/etc.-løb: scriptet må ALDRIG stille konvertere noget der ikke var hilly.
  for (const badProfileType of ["flat", "itt", "cobbles", "rolling", "classic"]) {
    const race = makeRace();
    const profileRow = makeProfileRow({ profile_type: badProfileType, is_manual: false });
    const p = planOne({ race, profileRow, externalId: "ext-1", expectedSeasonId: SEASON_ID });
    assert.equal(p.status, "error", `profile_type=${badProfileType} skulle blokere, ikke konvertere`);
    assert.match(p.reason, /profile_type/);
    assert.equal(p.update, undefined);
  }
});

test("planOne: shadowRace inkluderer race.name (fix #2837 pkt.1) — Trofeo Ligure får italienske region-stigningsnavne, ikke default-fallback", () => {
  const race = makeRace({ name: "Trofeo Ligure" });
  const profileRow = makeProfileRow();
  const p = planOne({ race, profileRow, externalId: "ext-trofeo-ligure", expectedSeasonId: SEASON_ID });
  assert.equal(p.status, "convert");
  assert.ok(p.update.climbs.length > 0, "high_mountain/mountain skal have mindst 2 stigninger");
  const ITALIAN_PREFIX = /^(Passo di|Salita di|Cima)\s/;
  const DEFAULT_PREFIX = /^(Climb of|Ascent of|Hill of)\s/;
  for (const c of p.update.climbs) {
    assert.match(c.name, ITALIAN_PREFIX, `forventede italiensk region-navn for "Trofeo Ligure", fik "${c.name}"`);
    assert.doesNotMatch(c.name, DEFAULT_PREFIX, `"${c.name}" er default-fallback — race.name blev ikke videresendt korrekt`);
  }
});

test("regressionstest #2837 pkt.1: UDEN race.name i shadowRace falder climb-navne tilbage til default — bekræfter hvorfor fixet er nødvendigt", () => {
  // Direkte på generatoren (ikke planOne), for at isolere PRÆCIS effekten af name-feltet.
  const base = { id: "race-x", race_type: "single", external_id: "ext-trofeo-ligure-2", terrain_archetype: "mountain_classic", season_id: SEASON_ID };
  const [withName] = generateRaceStageProfiles({ ...base, name: "Trofeo Ligure" });
  const [withoutName] = generateRaceStageProfiles({ ...base, name: undefined });
  // Samme seed (external_id+season) -> profile_type/distance/elevation upåvirket af name.
  assert.equal(withName.profile_type, withoutName.profile_type);
  assert.equal(withName.distance_km, withoutName.distance_km);
  assert.equal(withName.elevation_gain_m, withoutName.elevation_gain_m);
  const ITALIAN_PREFIX = /^(Passo di|Salita di|Cima)\s/;
  const DEFAULT_PREFIX = /^(Climb of|Ascent of|Hill of)\s/;
  assert.ok(withName.climbs.every((c) => ITALIAN_PREFIX.test(c.name)), "MED name skal klatrenavne være italienske");
  assert.ok(withoutName.climbs.every((c) => DEFAULT_PREFIX.test(c.name)), "UDEN name falder klatrenavne tilbage til default — det var #2837-fundet");
});

test("planOne: normal hilly-endagsløb -> convert, profile_type er mountain/high_mountain, is_manual=true", () => {
  const race = makeRace();
  const profileRow = makeProfileRow();
  const p = planOne({ race, profileRow, externalId: "f1c33846c869ff29", expectedSeasonId: SEASON_ID });
  assert.equal(p.status, "convert");
  assert.ok(["mountain", "high_mountain"].includes(p.after.profile_type), `forventede bjerg-profil, fik ${p.after.profile_type}`);
  assert.equal(p.update.is_manual, true, "is_manual=true forhindrer fremtidig backfill i at rulle tilbage");
  assert.equal(p.update.race_id, "race-1");
  assert.equal(p.update.stage_number, 1);
  assert.equal(p.update.generator_version, GENERATOR_VERSION);
  assert.ok(p.update.demand_vector && typeof p.update.demand_vector === "object", "demand_vector skal komme fra generatoren, ikke håndskrevet");
  assert.ok(Array.isArray(p.update.climbs));
  assert.equal(p.before.profile_type, "hilly");
});

test("planOne: deterministisk — samme input (samme external_id+season) giver identisk output", () => {
  const race = makeRace();
  const profileRow = makeProfileRow();
  const a = planOne({ race, profileRow, externalId: "f1c33846c869ff29", expectedSeasonId: SEASON_ID });
  const b = planOne({ race, profileRow, externalId: "f1c33846c869ff29", expectedSeasonId: SEASON_ID });
  assert.deepEqual(a, b);
});

test("planOne: race_pool.terrain_archetype røres aldrig — kun race_stage_profiles-updatet indeholder felter", () => {
  const race = makeRace();
  const profileRow = makeProfileRow();
  const p = planOne({ race, profileRow, externalId: "ext-1", expectedSeasonId: SEASON_ID });
  const updateKeys = Object.keys(p.update);
  assert.ok(!updateKeys.includes("terrain_archetype"), "scriptet må aldrig forsøge at skrive terrain_archetype");
  assert.deepEqual(
    updateKeys.sort(),
    ["climbs", "demand_vector", "distance_km", "elevation_gain_m", "finale_type", "generator_version", "is_manual", "profile_type", "race_id", "sectors", "sprints", "stage_number"].sort(),
  );
});

test("CANDIDATES: præcis 14 rækker, ingen dubletter, matcher CANDIDATE_RACE_IDS", () => {
  assert.equal(CANDIDATES.length, 14);
  assert.equal(new Set(CANDIDATE_RACE_IDS).size, 14, "ingen dublet-race_id'er");
  assert.deepEqual(CANDIDATE_RACE_IDS, Object.freeze(CANDIDATES.map((c) => c.race_id)));
});

test("CANDIDATES: 2 rækker i tier 2 (1 rigtigt løb × 2 puljer — per-pulje-paritet), 12 i tier 3 (3 rigtige løb × 4 puljer)", () => {
  const byTier = { 2: 0, 3: 0 };
  for (const c of CANDIDATES) byTier[c.tier] = (byTier[c.tier] || 0) + 1;
  assert.equal(byTier[2], 2);
  assert.equal(byTier[3], 12);
});

test("CANDIDATES: D2 får præcis 1 bjergklassiker pr. pulje (paritet med D1's 1) — D3 beholder bevidst 3 pr. pulje", () => {
  const byTierPool = new Map();
  for (const c of CANDIDATES) {
    const key = `${c.tier}::${c.pool_index}`;
    byTierPool.set(key, (byTierPool.get(key) || 0) + 1);
  }
  const expectedPerPool = { 2: 1, 3: 3 };
  for (const [key, n] of byTierPool) {
    const tier = Number(key.split("::")[0]);
    assert.equal(n, expectedPerPool[tier], `${key} skal have ${expectedPerPool[tier]} bjergklassiker(e), fik ${n}`);
  }
});

test("CANDIDATES: hver rigtig løb (navn) optræder i ALLE puljer i sin tier — bevarer cross-pulje-konsistens", () => {
  const byTierName = new Map();
  for (const c of CANDIDATES) {
    const key = `${c.tier}::${c.name}`;
    if (!byTierName.has(key)) byTierName.set(key, new Set());
    byTierName.get(key).add(c.pool_index);
  }
  const expectedPools = { 2: [0, 1], 3: [0, 1, 2, 3] };
  for (const [key, pools] of byTierName) {
    const tier = Number(key.split("::")[0]);
    assert.deepEqual([...pools].sort(), expectedPools[tier], `${key} mangler en pulje-kopi`);
  }
});

test("buildConversionPlan: bygger convert-status for alle 14 kandidater når data findes", () => {
  const races = CANDIDATES.map((c) => makeRace({ id: c.race_id, name: c.name, pool_race_id: `pool-${c.race_id}` }));
  const profiles = CANDIDATES.map((c) => makeProfileRow({ race_id: c.race_id }));
  const catalogMeta = new Map(CANDIDATES.map((c) => [`pool-${c.race_id}`, { external_id: `ext-${c.race_id}` }]));
  const plan = buildConversionPlan({ candidates: CANDIDATES, races, profiles, catalogMeta, expectedSeasonId: SEASON_ID });
  assert.equal(plan.length, 14);
  assert.ok(plan.every((p) => p.status === "convert"), "alle 14 skal kunne konverteres med gyldig data");
});

test("buildConversionPlan: manglende race -> error-status uden at kaste", () => {
  const plan = buildConversionPlan({ candidates: CANDIDATES.slice(0, 1), races: [], profiles: [], catalogMeta: new Map(), expectedSeasonId: SEASON_ID });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].status, "error");
});
