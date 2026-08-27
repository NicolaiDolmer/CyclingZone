// backend/scripts/raceRouteRealismScorecard.test.js
// #4219: prod-tilstanden (collectSeasonTierRacesFromDb) skal score DEN KALENDER DER
// STÅR SKREVET, ikke en plan scorecardet selv har genereret.
//
// Baggrunden er et konkret fejlpar fra 25/8: gaten meldte NO-GO med 5 båndbrud mens
// den skrevne kalender opfyldte alle fire bånd — falsk rødt, tre unødvendige
// wipe/regen-runder. Den modsatte fejl er værre: et reparations-script kan ændre den
// LIVE kalender uden at plan-tilstanden opdager noget (#4155-klassen).
//
// Testene bruger en in-memory supabase-mock (samme mønster som
// audit-league-size-invariant.test.js), så de kører uden credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { collectSeasonTierRacesFromDb } from "./raceRouteRealismScorecard.js";
import { scoreSeason } from "../lib/raceRouteRealismMetrics.js";

// Minimal thenable builder: select/eq/order/range/single mod et {tabel: rækker}-state.
function makeSupabase(state) {
  function from(table) {
    const filters = [];
    const rows = () => state[table] || [];
    const matching = () => rows().filter((r) => filters.every(([c, v]) => r[c] === v));
    const api = {
      select() { return api; },
      eq(c, v) { filters.push([c, v]); return api; },
      order() { return api; },
      single() { return Promise.resolve({ data: matching()[0] ?? null, error: null }); },
      // fetchAllRows sideinddeler via .range(from, to); alt rummes på side 0 her.
      range(from_) { return Promise.resolve({ data: from_ === 0 ? matching() : [], error: null }); },
      then(res, rej) { return Promise.resolve({ data: matching(), error: null }).then(res, rej); },
    };
    return api;
  }
  return { from };
}

const stage = (raceId, n, over = {}) => ({
  race_id: raceId, stage_number: n,
  profile_type: "flat", finale_type: "bunch_sprint",
  distance_km: 180, elevation_gain_m: 900, climbs: [], sprints: [],
  ...over,
});

// To puljer i tier 1 (id 1 og 2) — kun den laveste id'et er stikprøven. Løbene i
// pulje 2 må ALDRIG tælles med, ellers dobbelttælles hele tieren.
function baseState() {
  return {
    seasons: [{ id: "s3", number: 3 }],
    league_divisions: [{ id: 1, tier: 1 }, { id: 2, tier: 1 }, { id: 3, tier: 2 }],
    race_pool: [
      { id: "p-itt", external_id: "chrono", terrain_archetype: "time_trial" },
      { id: "p-cob", external_id: "dkrundt", terrain_archetype: "cobbles_tour" },
    ],
    races: [
      { id: "r-itt", season_id: "s3", name: "Chrono de la Loire", race_type: "single", race_class: "Class1", stages: 1, pool_race_id: "p-itt", league_division_id: 1 },
      { id: "r-cob", season_id: "s3", name: "Danmark Rundt", race_type: "stage_race", race_class: "Class1", stages: 3, pool_race_id: "p-cob", league_division_id: 1 },
      { id: "r-dup", season_id: "s3", name: "Chrono de la Loire", race_type: "single", race_class: "Class1", stages: 1, pool_race_id: "p-itt", league_division_id: 2 },
    ],
    race_stage_profiles: [
      stage("r-itt", 1, { profile_type: "itt", finale_type: "solo_tt", distance_km: 40 }),
      stage("r-cob", 1),
      stage("r-cob", 2, { profile_type: "cobbles" }),
      stage("r-cob", 3, { profile_type: "mountain", finale_type: "summit" }),
      stage("r-dup", 1, { profile_type: "itt", finale_type: "solo_tt", distance_km: 40 }),
    ],
  };
}

test("#4219 prod-tilstand: scorer de SKREVNE race_stage_profiles, ikke en genereret plan", async () => {
  const supabase = makeSupabase(baseState());
  const entries = await collectSeasonTierRacesFromDb({ supabase, seasonNumber: 3 });

  const tier1 = entries.find((e) => e.tier === 1);
  assert.ok(tier1, "tier 1 er med");
  assert.deepEqual(tier1.races.map((r) => r.id).sort(), ["r-cob", "r-itt"]);
  assert.deepEqual(tier1.errors, [], "ingen løb mangler profiler");

  // Etaperne kommer fra tabellen og er sorteret på stage_number.
  const cob = tier1.races.find((r) => r.id === "r-cob");
  assert.deepEqual(cob.stages.map((s) => s.stage_number), [1, 2, 3]);
  assert.deepEqual(cob.stages.map((s) => s.profile_type), ["flat", "cobbles", "mountain"]);

  // Præcis det #4219 handlede om: fritstående ITT og brosten-i-etapeløb er til stede
  // i den skrevne kalender og SKAL tælles. Plan-tilstanden meldte 0 på begge.
  const score = scoreSeason(entries).tiers.find((t) => t.tier === 1).score;
  assert.equal(score.standalone_itt, 1, "Chrono de la Loire er et fritstående ITT");
  assert.equal(score.cobbles_in_stagerace, 1, "Danmark Rundt har en brostens-etape");
});

test("#4219 prod-tilstand: kun én pulje pr. tier tælles (samme stikprøve som plan-tilstanden)", async () => {
  const supabase = makeSupabase(baseState());
  const entries = await collectSeasonTierRacesFromDb({ supabase, seasonNumber: 3 });
  const tier1 = entries.find((e) => e.tier === 1);
  assert.ok(!tier1.races.some((r) => r.id === "r-dup"), "løbet i pulje 2 er ikke stikprøven");
  assert.equal(scoreSeason(entries).tiers.find((t) => t.tier === 1).score.standalone_itt, 1,
    "tieren dobbelttælles ikke");
});

test("#4219 prod-tilstand: et løb UDEN profil-rækker er 'kunne ikke vurderes', ikke nul etaper", async () => {
  // Fravær af evidens må aldrig kollapse til et bånd der bestod (#2854). Et løb med
  // 0 profiler er præcis den tilstand et halvfærdigt reparations-script efterlader.
  const state = baseState();
  state.race_stage_profiles = state.race_stage_profiles.filter((s) => s.race_id !== "r-cob");
  const supabase = makeSupabase(state);
  const entries = await collectSeasonTierRacesFromDb({ supabase, seasonNumber: 3 });

  const tier1 = entries.find((e) => e.tier === 1);
  assert.equal(tier1.races.length, 1, "kun løbet med profiler scores");
  assert.equal(tier1.errors.length, 1);
  assert.match(tier1.errors[0], /Danmark Rundt/);
  assert.match(tier1.errors[0], /ingen race_stage_profiles/);

  const summary = scoreSeason(entries);
  assert.ok(summary.unassessed.some((u) => /Danmark Rundt/.test(u)),
    "fejlen bæres videre til summary.unassessed");
  assert.notEqual(summary.exitCode, 0, "gaten må ikke sige GO på et løb den ikke kunne måle");
});

test("#4219 prod-tilstand: ukendt sæson kaster i stedet for at score tomt", async () => {
  const supabase = makeSupabase(baseState());
  await assert.rejects(
    () => collectSeasonTierRacesFromDb({ supabase, seasonNumber: 99 }),
    /Sæson 99 ikke fundet/,
  );
});
