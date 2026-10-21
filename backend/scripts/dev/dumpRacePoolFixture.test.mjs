import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dumpRacePoolFixture } from "./dumpRacePoolFixture.mjs";

// Project only selected columns, as PostgREST does: a missing SELECT field must
// fail the preservation assertion even if the serializer still mentions it.
function database(rows) {
  return { from(table) {
    return { select(columns) {
      if (table === "league_divisions" || table === "teams") return Promise.resolve({ data: [], error: null });
      assert.equal(table, "race_pool");
      const keys = columns.split(",").map(key => key.trim());
      return { is(column, value) {
        assert.equal(column, "retired_at");
        assert.equal(value, null);
        return { order(column) {
          assert.equal(column, "id");
          return { range: async (from, to) => ({ data: rows.slice(from, to + 1).map(row => Object.fromEntries(keys.map(key => [key, row[key]]))), error: null }) };
        } };
      } };
    } };
  } };
}

for (const identity of [
  { race_identity_type: null, signature: null, authored_route: null },
  { race_identity_type: "hilly", signature: { features: [{ kind: "itt", stage_hint: "last", band: "hilly" }] }, authored_route: { profile_type: "cobbles", finale_type: "reduced_sprint", distance_km: 260, elevation_gain_m: 700, climbs: [], sprints: [], sectors: [{ kind: "cobbles", name: "Bospoort", start_km: 100, length_km: 2 }] } },
]) {
  test(`refresh and --check preserve ${identity.signature === null ? "null" : "populated"} race identity fields`, async t => {
    const directory = mkdtempSync(join(tmpdir(), "race-pool-dump-6857-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const fixturePath = join(directory, "catalog.json");
    const row = { id: "race-1", external_id: "example-race", terrain_archetype: "hilly_tour", name: "Example", race_class: "Class1", race_type: "stage_race", stages: 3, date_text: "19/10", ...identity };
    const options = { sb: database([row]), fixturePath, today: "2026-10-19" };

    assert.equal(await dumpRacePoolFixture(options), true);
    const serialized = readFileSync(fixturePath, "utf8");
    assert.deepEqual(JSON.parse(serialized).catalog, [row]);
    assert.equal(await dumpRacePoolFixture({ ...options, checkOnly: true, today: "2026-10-20" }), true);
    assert.equal(readFileSync(fixturePath, "utf8"), serialized, "check never rewrites the fixture");

    // Real identity drift must still fail, even when the row count is unchanged.
    for (const field of ["race_identity_type", "signature", "authored_route"]) {
      const stale = JSON.parse(serialized);
      delete stale.catalog[0][field];
      const staleJson = JSON.stringify(stale);
      writeFileSync(fixturePath, staleJson);
      assert.equal(await dumpRacePoolFixture({ ...options, checkOnly: true }), false, field);
      assert.equal(readFileSync(fixturePath, "utf8"), staleJson);
    }
  });
}
