import test from "node:test";
import assert from "node:assert/strict";
import { fetchSeasonDocumentaryFacts, generateSeasonDocumentary } from "./seasonDocumentaryGenerate.js";

const FACTS = {
  signings: [{ amount: 10000, riderName: "Rider One", source: "auction" }],
  biggestResult: { rider_name: "Rider One", race_name: "Test Race", result_type: "gc", stage_number: null },
  bestRaceDay: { race_name: "Test Race", total_points: 200, riders_scoring: 3 },
  rival: { team_name: "Rival FC", total_points: 990, gap: 10, rank_in_division: 2 },
  myStanding: { division: 3, rank_in_division: 1, total_points: 1000, races_completed: 10 },
};

function makeSupabase({ rpcResult = { data: FACTS, error: null }, upsertError = null, capturedUpserts = [] } = {}) {
  return {
    rpc: async () => rpcResult,
    from(table) {
      assert.equal(table, "season_documentaries");
      return {
        upsert: async (row) => {
          capturedUpserts.push(row);
          return { error: upsertError };
        },
      };
    },
  };
}

test("fetchSeasonDocumentaryFacts throws explicitly on RPC error (#1851-class — no silent || {})", async () => {
  const supabase = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
  await assert.rejects(
    () => fetchSeasonDocumentaryFacts(supabase, "s1", "t1"),
    /get_season_documentary_facts: boom/
  );
});

test("fetchSeasonDocumentaryFacts returns the RPC's data on success", async () => {
  const supabase = { rpc: async () => ({ data: FACTS, error: null }) };
  const facts = await fetchSeasonDocumentaryFacts(supabase, "s1", "t1");
  assert.deepEqual(facts, FACTS);
});

test("generateSeasonDocumentary — LLM disabled: persists deterministic text only, source='deterministic', no network call", async () => {
  const captured = [];
  const supabase = makeSupabase({ capturedUpserts: captured });
  let polishCalled = false;
  const row = await generateSeasonDocumentary({
    supabase,
    seasonId: "s1",
    teamId: "t1",
    teamName: "My Team",
    seasonNumber: 3,
    llmEnabled: false,
    anthropicApiKey: "sk-should-not-be-used",
    polish: async () => { polishCalled = true; return "should never be called"; },
  });

  assert.equal(polishCalled, false, "polish() must not be called when llmEnabled=false — no LLM calls outside the gate");
  assert.equal(row.source, "deterministic");
  assert.equal(row.llm_en, null);
  assert.equal(row.llm_da, null);
  assert.equal(row.llm_model, null);
  assert.ok(row.deterministic_en.length > 0);
  assert.ok(row.deterministic_da.length > 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].season_id, "s1");
  assert.equal(captured[0].team_id, "t1");
});

test("generateSeasonDocumentary — LLM enabled + apiKey + polish succeeds: source='llm', both languages persisted", async () => {
  const captured = [];
  const supabase = makeSupabase({ capturedUpserts: captured });
  const row = await generateSeasonDocumentary({
    supabase,
    seasonId: "s1",
    teamId: "t1",
    teamName: "My Team",
    seasonNumber: 3,
    llmEnabled: true,
    anthropicApiKey: "sk-fake-test-key",
    polish: async ({ lang }) => `polished ${lang} text`,
  });

  assert.equal(row.source, "llm");
  assert.equal(row.llm_en, "polished en text");
  assert.equal(row.llm_da, "polished da text");
  assert.equal(row.llm_model, "claude-sonnet-5");
});

test("generateSeasonDocumentary — LLM enabled but polish fails (returns null): falls back to deterministic, does not throw", async () => {
  const captured = [];
  const supabase = makeSupabase({ capturedUpserts: captured });
  const row = await generateSeasonDocumentary({
    supabase,
    seasonId: "s1",
    teamId: "t1",
    teamName: "My Team",
    seasonNumber: 3,
    llmEnabled: true,
    anthropicApiKey: "sk-fake-test-key",
    polish: async () => null,
  });

  assert.equal(row.source, "deterministic");
  assert.equal(row.llm_en, null);
  assert.equal(row.llm_da, null);
});

test("generateSeasonDocumentary — LLM enabled but no apiKey: skips polish entirely (double gate)", async () => {
  const captured = [];
  const supabase = makeSupabase({ capturedUpserts: captured });
  let polishCalled = false;
  const row = await generateSeasonDocumentary({
    supabase,
    seasonId: "s1",
    teamId: "t1",
    teamName: "My Team",
    seasonNumber: 3,
    llmEnabled: true,
    anthropicApiKey: "",
    polish: async () => { polishCalled = true; return "x"; },
  });

  assert.equal(polishCalled, false);
  assert.equal(row.source, "deterministic");
});

test("generateSeasonDocumentary throws explicitly when the upsert fails", async () => {
  const supabase = makeSupabase({ upsertError: { message: "unique violation" } });
  await assert.rejects(
    () => generateSeasonDocumentary({
      supabase, seasonId: "s1", teamId: "t1", teamName: "My Team", seasonNumber: 3, llmEnabled: false,
    }),
    /season_documentaries upsert: unique violation/
  );
});

test("generateSeasonDocumentary is idempotent — regenerating with identical facts produces identical deterministic text", async () => {
  const capturedA = [];
  const capturedB = [];
  const runOnce = (captured) => generateSeasonDocumentary({
    supabase: makeSupabase({ capturedUpserts: captured }),
    seasonId: "s1", teamId: "t1", teamName: "My Team", seasonNumber: 3, llmEnabled: false,
  });
  await runOnce(capturedA);
  await runOnce(capturedB);
  assert.deepEqual(capturedA[0].deterministic_en, capturedB[0].deterministic_en);
  assert.deepEqual(capturedA[0].deterministic_da, capturedB[0].deterministic_da);
});
