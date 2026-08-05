import test from "node:test";
import assert from "node:assert/strict";

import { renewExpiringAiContracts } from "./aiContractAutoRenewal.js";

// #1150 · AI-hold auto-fornyer udløbende senior-kontrakter FØR contract_expiry_release
// rammer dem. fetchExpiringAiContractRiders injiceres (samme mønster som
// contractExpiryRelease.test.js) — disse tests beviser FORNYELSES-logikken (hvem
// fornys, hvilke felter opdateres, fejl-isolation), mens query-formen (team.is_ai=true,
// team.is_bank/is_frozen/is_test_account=false) er verificeret direkte mod prod og
// matcher defaultFetchExpiringAiContractRiders 1:1 (se PR-beskrivelsen).

function makeMockSupabase({ unrenewableRiderIds = [], erroringRiderIds = [] } = {}) {
  const riderUpdates = [];

  function builder(table) {
    const b = {
      __table: table,
      __filters: {},
      __op: null,
      select(c) { b.__select = c || ""; return b; },
      eq(col, val) { b.__filters[col] = val; return b; },
      not() { return b; },
      order() { return b; },
      update(patch) { b.__op = "update"; b.__patch = patch; return b; },
      then(resolve) { resolve(resolveQuery()); },
    };

    function resolveQuery() {
      if (table === "riders" && b.__op === "update") {
        const riderId = b.__filters.id;
        riderUpdates.push({ riderId, patch: { ...b.__patch } });
        if (erroringRiderIds.includes(riderId)) return { data: null, error: { message: "simulated transient DB error" } };
        if (unrenewableRiderIds.includes(riderId)) return { data: [], error: null };
        return { data: [{ id: riderId }], error: null };
      }
      return { data: [], error: null };
    }

    return b;
  }

  return { supabase: { from: builder }, riderUpdates };
}

test("fornyer PRÆCIS de kandidater fetchExpiringAiContractRiders returnerer — salary/length/end_season opdateret", async () => {
  const { supabase, riderUpdates } = makeMockSupabase();

  const candidates = [
    { id: "r1", firstname: "A", lastname: "A", team_id: "ai-team-1", contract_length: 1, contract_end_season: 2,
      current_production_value: 5000, team: { division: 4 } },
    { id: "r2", firstname: "B", lastname: "B", team_id: "ai-team-2", contract_length: 3, contract_end_season: 1,
      current_production_value: 1200, team: { division: 3 } },
  ];

  const stats = await renewExpiringAiContracts({
    supabase, seasonNumber: 2,
    fetchExpiringAiContractRiders: async () => candidates,
  });

  assert.deepEqual(stats, { candidates: 2, renewed: 2, failed: 0 });
  assert.equal(riderUpdates.length, 2);

  // r1: end=2, currentSeason=2 → anchor=max(2,2)=2 → newEnd=3. length 1→2 (clamped ≤3).
  assert.equal(riderUpdates[0].patch.contract_end_season, 3);
  assert.equal(riderUpdates[0].patch.contract_length, 2);
  assert.ok(riderUpdates[0].patch.salary > 0);

  // r2: end=1 (allerede udløbet), currentSeason=2 → anchor=max(1,2)=2 → newEnd=3.
  // length 3 er allerede MAX_LENGTH → clampes til 3 (uændret, ikke 4).
  assert.equal(riderUpdates[1].patch.contract_end_season, 3);
  assert.equal(riderUpdates[1].patch.contract_length, 3);
});

test("kontrakten fornys altid til en FREMTIDIG sæson, uanset hvor gammel end_season var (>= currentSeason+1)", async () => {
  const { supabase, riderUpdates } = makeMockSupabase();
  const stats = await renewExpiringAiContracts({
    supabase, seasonNumber: 2,
    fetchExpiringAiContractRiders: async () => [
      { id: "r-old", team_id: "t1", contract_length: null, contract_end_season: null,
        current_production_value: 800, team: { division: 4 } },
    ],
  });
  assert.equal(stats.renewed, 1);
  assert.equal(riderUpdates[0].patch.contract_end_season, 3);
  assert.equal(riderUpdates[0].patch.contract_length, 1);
});

test("concurrency-guard: rytter der skiftede hold sideløbende (0 rows fra update) tælles ikke som renewed", async () => {
  const { supabase } = makeMockSupabase({ unrenewableRiderIds: ["r-moved"] });
  const stats = await renewExpiringAiContracts({
    supabase, seasonNumber: 2,
    fetchExpiringAiContractRiders: async () => [
      { id: "r-moved", team_id: "t1", contract_length: 1, contract_end_season: 2,
        current_production_value: 1000, team: { division: 3 } },
    ],
  });
  assert.equal(stats.renewed, 0);
});

test("én rytters DB-fejl midt i loopet isoleres — resten fornys stadig, fejlen tælles i stats.failed", async () => {
  const { supabase, riderUpdates } = makeMockSupabase({ erroringRiderIds: ["r2"] });
  const stats = await renewExpiringAiContracts({
    supabase, seasonNumber: 2,
    fetchExpiringAiContractRiders: async () => [
      { id: "r1", team_id: "t1", contract_length: 1, contract_end_season: 2, current_production_value: 1000, team: { division: 3 } },
      { id: "r2", team_id: "t2", contract_length: 1, contract_end_season: 2, current_production_value: 1000, team: { division: 3 } },
      { id: "r3", team_id: "t3", contract_length: 1, contract_end_season: 2, current_production_value: 1000, team: { division: 3 } },
    ],
  });
  assert.equal(stats.candidates, 3);
  assert.equal(stats.renewed, 2, "r1 + r3 fornys — r2's fejl taber IKKE de andre");
  assert.equal(stats.failed, 1);
  assert.equal(riderUpdates.length, 3);
});

test("ingen kandidater → nul-stats, ingen writes", async () => {
  const { supabase, riderUpdates } = makeMockSupabase();
  const stats = await renewExpiringAiContracts({
    supabase, seasonNumber: 2,
    fetchExpiringAiContractRiders: async () => [],
  });
  assert.deepEqual(stats, { candidates: 0, renewed: 0, failed: 0 });
  assert.equal(riderUpdates.length, 0);
});

test("ugyldigt seasonNumber → nul-stats uden at røre DB'en", async () => {
  const { supabase } = makeMockSupabase();
  let fetchCalled = false;
  const stats = await renewExpiringAiContracts({
    supabase, seasonNumber: NaN,
    fetchExpiringAiContractRiders: async () => { fetchCalled = true; return []; },
  });
  assert.deepEqual(stats, { candidates: 0, renewed: 0, failed: 0 });
  assert.equal(fetchCalled, false, "guard-clause skal returnere FØR fetch — ingen unødig DB-tur");
});

test("fetchExpiringAiContractRiders-fejl hænger tomme partialStats på errors (intet nået endnu)", async () => {
  const { supabase } = makeMockSupabase();
  const err = await renewExpiringAiContracts({
    supabase, seasonNumber: 2,
    fetchExpiringAiContractRiders: async () => { throw new Error("season lookup boom"); },
  }).then(
    () => { throw new Error("skulle have kastet"); },
    (e) => e,
  );
  assert.match(err.message, /season lookup boom/);
  assert.deepEqual(err.partialStats, { candidates: 0, renewed: 0, failed: 0 });
});
