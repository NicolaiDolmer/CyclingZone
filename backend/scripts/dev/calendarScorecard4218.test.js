// backend/scripts/dev/calendarScorecard4218.test.js
// #4573: parser + begge tilstande skal testes, ikke kun køres i hånden.
//
// resolveMode() er en REN funktion — en fejlparset "hvilken tilstand/sæson måler jeg?"
// er en STILLE fejlmålt regel, ikke en synlig krascj, så den testes isoleret.
// loadDbTierData() testes med en in-memory supabase-mock (samme mønster som
// raceRouteRealismScorecard.test.js), så testene kører uden credentials/DB.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveMode, computeTierReport, loadDbTierData } from "./calendarScorecard4218.mjs";

// ---------------------------------------------------------------------------
// resolveMode — parseren
// ---------------------------------------------------------------------------
test("resolveMode: ingen flag = fixture-tilstand (uændret default siden #4218)", () => {
  const r = resolveMode([]);
  assert.equal(r.mode, "fixture");
  assert.equal(r.season, null);
});

test("resolveMode: --from-fixture er eksplicit synonym for default", () => {
  const r = resolveMode(["--from-fixture"]);
  assert.equal(r.mode, "fixture");
});

test("resolveMode: --from-db uden --season = db-tilstand, season null (auto: aktiv sæson)", () => {
  const r = resolveMode(["--from-db"]);
  assert.equal(r.mode, "db");
  assert.equal(r.season, null);
});

test("resolveMode: --from-db --season 3 = db-tilstand, season 3", () => {
  const r = resolveMode(["--from-db", "--season", "3"]);
  assert.equal(r.mode, "db");
  assert.equal(r.season, 3);
});

test("resolveMode: --from-db --season=3 (lighedstegn-syntaks)", () => {
  const r = resolveMode(["--from-db", "--season=3"]);
  assert.equal(r.season, 3);
});

test("resolveMode: --from-fixture og --from-db udelukker hinanden", () => {
  assert.throws(() => resolveMode(["--from-fixture", "--from-db"]), /udelukker hinanden/);
});

test("resolveMode: --season uden --from-db er en fejl (giver ingen mening for fixture)", () => {
  assert.throws(() => resolveMode(["--season", "3"]), /kun mening sammen med --from-db/);
});

test("resolveMode: --season skal være et positivt heltal", () => {
  assert.throws(() => resolveMode(["--from-db", "--season", "abc"]), /positivt heltal/);
  assert.throws(() => resolveMode(["--from-db", "--season", "0"]), /positivt heltal/);
  assert.throws(() => resolveMode(["--from-db", "--season", "-1"]), /positivt heltal/);
});

test("resolveMode: --json videreføres uafhængigt af tilstand", () => {
  assert.equal(resolveMode(["--json"]).asJson, true);
  assert.equal(resolveMode(["--from-db", "--season", "3", "--json"]).asJson, true);
  assert.equal(resolveMode([]).asJson, false);
});

// ---------------------------------------------------------------------------
// computeTierReport — den fælles dømmende krop, DB-fri
// ---------------------------------------------------------------------------
test("computeTierReport: tom tier krascher ikke (0 løb udløser MANGLENDE dækning, ikke en exception)", () => {
  const t = computeTierReport({ tier: 1, raceRows: [], stageRows: [], profilesByPoolRaceId: new Map() });
  assert.equal(t.løb, 0);
  assert.equal(t.etaper, 0);
  // Tier 1 har rigtige gulve (#3327) — 0 løb er korrekt et BRUD, ikke et grønt scorecard
  // på tomt grundlag (#2854-princippet). Formen skal bare være en Array, uden throw.
  assert.ok(Array.isArray(t.coverageViol) && t.coverageViol.length > 0);
  assert.ok(Array.isArray(t.compositionViol) && t.compositionViol.length > 0);
});

test("computeTierReport: planViolations/maxOverlap videreføres uændret fra input (fixture-formen)", () => {
  const t = computeTierReport({
    tier: 2, raceRows: [], stageRows: [], profilesByPoolRaceId: new Map(),
    planViolations: ["noget brød"], maxOverlap: 5, overlapCap: 3,
  });
  assert.deepEqual(t.planViolations, ["noget brød"]);
  assert.equal(t.maxOverlap, 5);
  assert.equal(t.overlapCap, 3);
});

test("computeTierReport: et endagsløb med én flad etape tælles i komposition + finale", () => {
  const raceRows = [{ pool_race_id: "p1", name: "Test Classic", race_type: "single" }];
  const profilesByPoolRaceId = new Map([
    ["p1", [{ profile_type: "flat", finale_type: "bunch_sprint" }]],
  ]);
  const t = computeTierReport({ tier: 1, raceRows, stageRows: [], profilesByPoolRaceId });
  assert.equal(t.etaper, 1);
  assert.equal(t.coverage.oneDayRaces, 1);
  assert.equal(t.composition.counts.flat, 1);
});

// ---------------------------------------------------------------------------
// loadDbTierData — DB-mode med in-memory supabase-mock, ingen credentials
// ---------------------------------------------------------------------------
function makeSupabase(state) {
  function from(table) {
    const filters = [];
    const rows = () => state[table] || [];
    const matching = () => rows().filter((r) => filters.every(([c, v]) => r[c] === v));
    const api = {
      select() { return api; },
      eq(c, v) { filters.push([c, v]); return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return Promise.resolve({ data: matching()[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: matching()[0] ?? null, error: null }); },
      range(from_) { return Promise.resolve({ data: from_ === 0 ? matching() : [], error: null }); },
      then(res, rej) { return Promise.resolve({ data: matching(), error: null }).then(res, rej); },
    };
    return api;
  }
  return { from };
}

const stage = (raceId, n, over = {}) => ({
  race_id: raceId, stage_number: n, profile_type: "flat", finale_type: "bunch_sprint",
  distance_km: 180, elevation_gain_m: 900, climbs: [], sprints: [], ...over,
});

function baseState() {
  return {
    seasons: [{ id: "s3", number: 3, start_date: "2026-08-28", end_date: "2026-09-27" }],
    // To puljer i tier 1 (division 1 og 2) — kun laveste id (1) er stikprøven.
    league_divisions: [{ id: 1, tier: 1 }, { id: 2, tier: 1 }, { id: 3, tier: 2 }],
    races: [
      { id: "r-flat", season_id: "s3", name: "Flat Classic", race_type: "single", race_class: "Class1", stages: 1, pool_race_id: "p-flat", league_division_id: 1 },
      { id: "r-noprofile", season_id: "s3", name: "Uden profiler", race_type: "single", race_class: "Class1", stages: 1, pool_race_id: "p-np", league_division_id: 1 },
      { id: "r-dup", season_id: "s3", name: "Skal ikke tælles (pulje 2)", race_type: "single", race_class: "Class1", stages: 1, pool_race_id: "p-flat", league_division_id: 2 },
      { id: "r-t2", season_id: "s3", name: "Anden tier", race_type: "single", race_class: "Class1", stages: 1, pool_race_id: "p-t2", league_division_id: 3 },
    ],
    race_stage_profiles: [
      stage("r-flat", 1, { profile_type: "flat", finale_type: "bunch_sprint" }),
      stage("r-dup", 1, { profile_type: "flat", finale_type: "bunch_sprint" }),
      stage("r-t2", 1, { profile_type: "mountain", finale_type: "uphill" }),
    ],
    race_stage_schedule: [
      { race_id: "r-flat", stage_number: 1, scheduled_at: "2026-08-28", game_day: 1 },
      { race_id: "r-t2", stage_number: 1, scheduled_at: "2026-08-29", game_day: 2 },
    ],
  };
}

test("loadDbTierData: grupperer pr. tier, tæller kun stikprøve-divisionen (dobbelttælling undgået)", async () => {
  const supabase = makeSupabase(baseState());
  const { tierData, seasonNumber } = await loadDbTierData({ supabase, seasonNumber: 3 });
  assert.equal(seasonNumber, 3);
  const tier1 = tierData.find((t) => t.tier === 1);
  // r-flat tælles, r-dup (samme pool_race_id, pulje 2) tælles IKKE — ellers dobbelttælling.
  assert.equal(tier1.raceRows.length, 1);
  assert.equal(tier1.raceRows[0].id, "r-flat");
});

test("loadDbTierData: løb uden race_stage_profiles-rækker bogføres som 'kunne ikke vurderes', ikke som 0 etaper", async () => {
  const supabase = makeSupabase(baseState());
  const { unassessed } = await loadDbTierData({ supabase, seasonNumber: 3 });
  assert.equal(unassessed.length, 1);
  assert.match(unassessed[0], /Uden profiler/);
});

test("loadDbTierData: plan-interne felter er ALDRIG udfyldt i db-tilstand (måles ikke to gange, se §9c)", async () => {
  const supabase = makeSupabase(baseState());
  const { tierData } = await loadDbTierData({ supabase, seasonNumber: 3 });
  for (const t of tierData) {
    assert.deepEqual(t.planViolations, []);
    assert.equal(t.maxOverlap, null);
    assert.equal(t.overlapCap, null);
  }
});

test("loadDbTierData: ukendt sæsonnummer kaster (læses som 'kunne ikke vurderes', exit 2, ikke exit 1)", async () => {
  const supabase = makeSupabase(baseState());
  await assert.rejects(() => loadDbTierData({ supabase, seasonNumber: 999 }), /ikke fundet/);
});
