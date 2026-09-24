import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("best-role migration is idempotent, preserves values and grants read-only access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated;
      CREATE TABLE public.riders (id integer PRIMARY KEY, base_value integer);
      CREATE TABLE public.backup_5443_value_event_20260920 (rider_id integer PRIMARY KEY);
      ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
      CREATE POLICY read_riders ON public.riders FOR SELECT USING (true);
      GRANT UPDATE ON public.riders TO authenticated;
      INSERT INTO public.riders VALUES (1, 123);`);
    const sql = readFileSync(new URL("../../database/2026-09-22-5443-best-role-data.sql", import.meta.url), "utf8");
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual((await db.query("SELECT * FROM riders")).rows, [{ id: 1, base_value: 123, best_role: null, best_role_rating: null }]);
    await db.exec("UPDATE riders SET best_role = 'sprinter', best_role_rating = 0 WHERE id = 1");
    await assert.rejects(db.exec("UPDATE riders SET best_role_rating = NULL WHERE id = 1"), /riders_best_role_valid/);
    await assert.rejects(db.exec("UPDATE riders SET best_role = 'invalid' WHERE id = 1"), /riders_best_role_valid/);
    await assert.rejects(db.exec("UPDATE riders SET best_role_rating = 100 WHERE id = 1"), /riders_best_role_valid/);
    // Production has table UPDATE grants but no write RLS policy: mirror both.
    await db.exec("SET ROLE authenticated");
    assert.deepEqual((await db.query("SELECT best_role_rating FROM riders")).rows, [{ best_role_rating: 0 }]);
    await db.exec("UPDATE riders SET best_role_rating = 99");
    assert.deepEqual((await db.query("SELECT best_role_rating FROM riders")).rows, [{ best_role_rating: 0 }]);
    await db.exec("RESET ROLE");
    await db.exec("INSERT INTO backup_5443_value_event_20260920 (rider_id, best_role, best_role_rating) VALUES (1, 'sprinter', 0)");
  } finally {
    await db.close();
  }
});
