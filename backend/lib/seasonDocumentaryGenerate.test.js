import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { fetchSeasonDocumentaryFacts, generateSeasonDocumentary } from "./seasonDocumentaryGenerate.js";
import { buildSeasonDocumentary } from "./seasonDocumentaryGrammar.js";
import { createTestDb, readMigration, RESULT_AGGREGATE_SCHEMA_FILES } from "./testdb/createTestDb.js";
import { sanitizeForPglite } from "./testdb/sanitizeForPglite.js";

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

// ── #8361: get_season_documentary_facts mod en ÆGTE Postgres (PGlite) ─────────
// Den committede migration loades oven på skemaet bag 5535-funktionen. To puljer i
// samme division med kendt stilling: rivalen skal komme fra holdets egen pulje og
// være en reel nabo, også når et hold i nabopuljen ligger tættere i point.

const MIGRATION_8361 = "2026-11-17-8361-season-documentary-rival-same-pool.sql";

describe("#8361 get_season_documentary_facts: rival from the team's own pool", () => {
  let db;
  const ids = {};

  async function one(sql, params) {
    return (await db.query(sql, params)).rows[0];
  }

  async function team(name, pool, isAi = false) {
    return (
      await one("INSERT INTO teams (name, is_ai, division, league_division_id) VALUES ($1, $2, 2, $3) RETURNING id", [name, isAi, pool])
    ).id;
  }

  async function standing(teamId, pool, rank, points) {
    await db.query(
      `INSERT INTO season_standings (season_id, team_id, division, league_division_id, rank_in_division, total_points)
       VALUES ($1, $2, 2, $3, $4, $5)`,
      [ids.season, teamId, pool, rank, points],
    );
  }

  async function facts(teamId) {
    return (await one("SELECT public.get_season_documentary_facts($1, $2) AS r", [ids.season, teamId])).r;
  }

  before(async () => {
    db = await createTestDb({ files: [...RESULT_AGGREGATE_SCHEMA_FILES, MIGRATION_8361] });
    ids.season = (await one("INSERT INTO seasons (number, status) VALUES (4, 'completed') RETURNING id")).id;
    ids.poolP = (await one("INSERT INTO league_divisions (tier, pool_index, label) VALUES (2, 0, 'Pulje P') RETURNING id")).id;
    ids.poolQ = (await one("INSERT INTO league_divisions (tier, pool_index, label) VALUES (2, 1, 'Pulje Q') RETURNING id")).id;
    // Pulje P: A (1.), Mig (2.), B (3.), AI-hold (4.), D (5.)
    ids.a = await team("Hold A", ids.poolP);
    ids.me = await team("Hold Mig", ids.poolP);
    ids.b = await team("Hold B", ids.poolP);
    ids.ai = await team("AI-hold", ids.poolP, true);
    ids.d = await team("Hold D", ids.poolP);
    await standing(ids.a, ids.poolP, 1, 5097);
    await standing(ids.me, ids.poolP, 2, 5000);
    await standing(ids.b, ids.poolP, 3, 4950);
    await standing(ids.ai, ids.poolP, 4, 4800);
    await standing(ids.d, ids.poolP, 5, 4700);
    // Pulje Q i samme division: Q1 ligger tættest på Mig i point, men er ikke en nabo.
    ids.q1 = await team("Hold Q1", ids.poolQ);
    await standing(ids.q1, ids.poolQ, 1, 5010);
    // Et hold uden pulje i samme division.
    ids.loose = await team("Hold Uden Pulje", null);
    await standing(ids.loose, null, 1, 5005);
  });

  after(async () => {
    if (db) await db.close();
  });

  test("the rival is the nearest neighbour in the own pool, not a closer team from the other pool", async () => {
    const f = await facts(ids.me);
    assert.equal(f.rival.team_id, ids.b);
    assert.equal(f.rival.league_division_id, ids.poolP);
    assert.equal(f.myStanding.league_division_id, ids.poolP);

    const doc = buildSeasonDocumentary(f, { teamId: ids.me, teamName: "Hold Mig", seasonNumber: 4 });
    for (const lang of ["en", "da"]) {
      const text = doc[lang].join(" ");
      assert.ok(text.includes("Hold B"), `${lang}: rivalen fra egen pulje er nævnt`);
      assert.ok(!text.includes("Hold Q1"), `${lang}: holdet fra nabopuljen er ikke nævnt`);
      assert.doesNotMatch(text, /[—–]/);
    }
  });

  test("a human team two places away is not a rival when the neighbours are AI or missing", async () => {
    const f = await facts(ids.d);
    assert.equal(f.rival, null);
    const doc = buildSeasonDocumentary(f, { teamId: ids.d, teamName: "Hold D", seasonNumber: 4 });
    assert.equal(doc.en.length, 4);
    assert.equal(doc.da.length, 4);
  });

  test("a team without a pool gets no rival from anywhere in the division", async () => {
    const f = await facts(ids.loose);
    assert.equal(f.rival, null);
  });

  test("the migration can run twice (auto-migrate safe)", async () => {
    await db.exec(sanitizeForPglite(readMigration(MIGRATION_8361)));
    const f = await facts(ids.me);
    assert.equal(f.rival.team_id, ids.b);
  });
});
