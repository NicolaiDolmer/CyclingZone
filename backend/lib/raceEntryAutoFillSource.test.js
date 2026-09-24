import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_FILL_SOURCES,
  isMissingAutoFillSourceColumn,
  stripAutoFillSource,
  writeRaceEntriesWithSource,
} from "./raceEntryAutoFillSource.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PGRST204 = {
  code: "PGRST204",
  message: "Could not find the 'auto_filled_source' column of 'race_entries' in the schema cache",
};
const PG_42703 = { code: "42703", message: 'column "auto_filled_source" of relation "race_entries" does not exist' };

// Minimal race_entries-mock: `missingColumn` afviser enhver skrivning der sender feltet
// (vinduet mellem backend-deploy og migrationen); `nextError` er en anden fejl.
function makeSupabase({ missingColumn = false, nextError = null } = {}) {
  const writes = [];
  const respond = (method, rows, opts) => {
    writes.push({ method, rows, opts });
    if (missingColumn && rows.some((r) => "auto_filled_source" in r)) return Promise.resolve({ error: PGRST204 });
    return Promise.resolve({ error: nextError });
  };
  return {
    writes,
    from(table) {
      assert.equal(table, "race_entries");
      return {
        insert: (rows) => respond("insert", rows),
        upsert: (rows, opts) => respond("upsert", rows, opts),
      };
    },
  };
}

const ROWS = [
  { race_id: "r1", rider_id: "a", team_id: "t1", race_role: "captain", is_auto_filled: true, auto_filled_source: "start_rescue" },
  { race_id: "r1", rider_id: "b", team_id: "t1", race_role: "helper", is_auto_filled: true, auto_filled_source: "start_rescue" },
];

test("kilderne matcher CHECK-constrainten i migrationen (ingen default-kilde, ingen stavefejl)", () => {
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "database", "2026-09-23-5246-late-fill-log.sql"),
    "utf8",
  );
  const check = sql.match(/race_entries_auto_filled_source_check\s+CHECK \(auto_filled_source IS NULL OR auto_filled_source IN \(([^)]*)\)/);
  assert.ok(check, "CHECK-constrainten findes i migrationen");
  const inSql = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(inSql, Object.values(AUTO_FILL_SOURCES).sort());
});

test("isMissingAutoFillSourceColumn: PGRST204 og 42703 paa NETOP auto_filled_source", () => {
  assert.equal(isMissingAutoFillSourceColumn(PGRST204), true);
  assert.equal(isMissingAutoFillSourceColumn(PG_42703), true);
});

test("isMissingAutoFillSourceColumn: andre fejl sluges aldrig", () => {
  assert.equal(isMissingAutoFillSourceColumn(null), false);
  assert.equal(isMissingAutoFillSourceColumn({ code: "PGRST204", message: "Could not find the 'other' column" }), false);
  assert.equal(isMissingAutoFillSourceColumn({ code: "23505", message: "auto_filled_source duplicate" }), false);
  assert.equal(isMissingAutoFillSourceColumn({ code: "23P01", message: "no_rider_double_booking" }), false);
});

test("stripAutoFillSource fjerner kun kilde-feltet og muterer ikke input", () => {
  const out = stripAutoFillSource(ROWS);
  assert.ok(out.every((r) => !("auto_filled_source" in r)));
  assert.equal(out[0].race_role, "captain");
  assert.equal(ROWS[0].auto_filled_source, "start_rescue", "input uroert");
});

test("writeRaceEntriesWithSource: kolonnen findes → een skrivning med kilden", async () => {
  const supabase = makeSupabase();
  const res = await writeRaceEntriesWithSource({ supabase, rows: ROWS });
  assert.deepEqual(res, { error: null, sourceDropped: false });
  assert.equal(supabase.writes.length, 1);
  assert.equal(supabase.writes[0].rows[0].auto_filled_source, "start_rescue");
});

test("writeRaceEntriesWithSource (a): kolonnen mangler (deploy-vinduet) → proever EEN gang igen uden kilden", async () => {
  const supabase = makeSupabase({ missingColumn: true });
  const res = await writeRaceEntriesWithSource({ supabase, rows: ROWS });
  assert.deepEqual(res, { error: null, sourceDropped: true });
  assert.equal(supabase.writes.length, 2);
  assert.ok(supabase.writes[1].rows.every((r) => !("auto_filled_source" in r)));
  assert.equal(supabase.writes[1].rows.length, 2, "alle raekker skrives stadig");
});

test("writeRaceEntriesWithSource: upsertOptions bevares paa begge forsoeg", async () => {
  const supabase = makeSupabase({ missingColumn: true });
  const opts = { onConflict: "race_id,rider_id", ignoreDuplicates: true };
  await writeRaceEntriesWithSource({ supabase, rows: ROWS, upsertOptions: opts });
  assert.deepEqual(supabase.writes.map((w) => [w.method, w.opts]), [["upsert", opts], ["upsert", opts]]);
});

test("writeRaceEntriesWithSource: en anden fejl returneres uaendret uden nyt forsoeg (kalderen klassificerer)", async () => {
  const other = { code: "23P01", message: "conflicting key value violates exclusion constraint" };
  const supabase = makeSupabase({ nextError: other });
  const res = await writeRaceEntriesWithSource({ supabase, rows: ROWS });
  assert.equal(res.error, other);
  assert.equal(supabase.writes.length, 1);
});
