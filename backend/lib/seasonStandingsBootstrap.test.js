import { test } from "node:test";
import assert from "node:assert/strict";

import { ensureSeasonStandings, makeEnsureSeasonStandings } from "./seasonStandingsBootstrap.js";

// Mock-supabase: tabel-specifikke svar + opsamling af inserts.
function makeSupabase(tables = {}) {
  const writes = [];
  function from(table) {
    const b = {
      select() { return b; },
      eq() { return b; },
      insert(rows) { writes.push({ table, rows }); return Promise.resolve({ error: null }); },
      then(res) { return Promise.resolve({ data: tables[table] || [], error: null }).then(res); },
    };
    return b;
  }
  return { from, __writes: writes };
}

test("ensureSeasonStandings: indsætter manglende hold (ekskl. test-konti) i season_standings", async () => {
  const supabase = makeSupabase({
    teams: [{ id: "T1", division: 1 }, { id: "T2", division: 2 }],
    season_standings: [{ team_id: "T1" }], // T1 findes; T2 mangler
  });
  const r = await ensureSeasonStandings(supabase, "s1");
  assert.equal(r.created, 1, "kun T2 mangler");
  assert.equal(r.total_teams, 2);
  const ins = supabase.__writes.find((w) => w.table === "season_standings");
  assert.ok(ins, "manglende række blev ikke indsat");
  assert.deepEqual(ins.rows, [{ season_id: "s1", team_id: "T2", division: 2 }]);
});

test("ensureSeasonStandings: alle hold findes → ingen insert", async () => {
  const supabase = makeSupabase({
    teams: [{ id: "T1", division: 1 }],
    season_standings: [{ team_id: "T1" }],
  });
  const r = await ensureSeasonStandings(supabase, "s1");
  assert.equal(r.created, 0);
  assert.equal(supabase.__writes.length, 0, "ingen insert når intet mangler");
});

test("makeEnsureSeasonStandings: curry'er supabase → (seasonId)-callback (applyRaceResults-form)", async () => {
  const supabase = makeSupabase({
    teams: [{ id: "T1", division: 1 }],
    season_standings: [],
  });
  const fn = makeEnsureSeasonStandings(supabase);
  const r = await fn("s2"); // kaldes med kun seasonId
  assert.equal(r.created, 1);
  const ins = supabase.__writes.find((w) => w.table === "season_standings");
  assert.equal(ins.rows[0].season_id, "s2");
});
