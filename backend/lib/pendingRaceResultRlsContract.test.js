import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Contract: migration 2026-05-22-pending-race-result-atomic-rpc.sql (#518) skal
// (1) definere submit_race_results RPC med SECURITY INVOKER,
// (2) droppe gamle permissive policies "Insert pending rows" / "Read pending rows",
// (3) erstatte med owner-or-admin-gated policies der joiner til parent.
// Hvis migrationen ændres uden at bevare disse garantier, fejler testen.

const MIGRATION_PATH = resolve(
  __dirname,
  "../../database/2026-05-22-pending-race-result-atomic-rpc.sql",
);

function migrationContent() {
  return readFileSync(MIGRATION_PATH, "utf8");
}

test("#518 migration definerer submit_race_results RPC med SECURITY INVOKER", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.submit_race_results\s*\(\s*p_race_id uuid\s*,\s*p_rows jsonb\s*\)/i,
    "RPC submit_race_results(p_race_id uuid, p_rows jsonb) skal være defineret",
  );
  assert.match(sql, /SECURITY INVOKER/i, "RPC skal være SECURITY INVOKER så RLS håndhæves");
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.submit_race_results.*TO authenticated/i,
    "authenticated rolle skal kunne kalde RPC",
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.submit_race_results.*FROM PUBLIC/i,
    "PUBLIC-grant skal være revoked — kun authenticated har EXECUTE",
  );
});

test("#518 migration dropper permissive policies på pending_race_result_rows", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /DROP POLICY IF EXISTS "Insert pending rows" ON public\.pending_race_result_rows/i,
    "gammel WITH CHECK (true) INSERT-policy skal droppes",
  );
  assert.match(
    sql,
    /DROP POLICY IF EXISTS "Read pending rows" ON public\.pending_race_result_rows/i,
    "gammel USING (true) SELECT-policy skal droppes",
  );
});

test("#518 migration tilføjer owner-or-admin-gated policies på pending_race_result_rows", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /CREATE POLICY "Owner or admin insert pending rows"[\s\S]*?FOR INSERT TO authenticated[\s\S]*?WITH CHECK[\s\S]*?pending_race_results[\s\S]*?submitted_by = auth\.uid\(\)[\s\S]*?is_admin\(\)/i,
    "INSERT-policy skal joine til parent og gate på submitted_by eller is_admin()",
  );
  assert.match(
    sql,
    /CREATE POLICY "Owner or admin read pending rows"[\s\S]*?FOR SELECT TO authenticated[\s\S]*?USING[\s\S]*?pending_race_results[\s\S]*?submitted_by = auth\.uid\(\)[\s\S]*?is_admin\(\)/i,
    "SELECT-policy skal joine til parent og gate på submitted_by eller is_admin()",
  );
});

test("#518 migration tilføjer index på pending_id (RLS-perf)", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS pending_race_result_rows_pending_id_idx[\s\S]*?ON public\.pending_race_result_rows\s*\(\s*pending_id\s*\)/i,
    "index på pending_id skal eksistere — bruges af RLS-join",
  );
});

test("#518 migration validerer p_rows array bounds (DOS-guard)", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /jsonb_array_length\(p_rows\)[\s\S]{0,200}>\s*500/i,
    "RPC skal afvise > 500 rows for at undgå DOS via stor jsonb",
  );
  assert.match(
    sql,
    /jsonb_array_length\(p_rows\)[\s\S]{0,200}=\s*0/i,
    "RPC skal afvise tom rows-array",
  );
});

test("#518 migration kræver authentication", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /v_user_id := auth\.uid\(\)[\s\S]*?IF v_user_id IS NULL THEN[\s\S]*?RAISE EXCEPTION 'Authentication required'/i,
    "RPC skal RAISE hvis auth.uid() er NULL (defense-in-depth oven på authenticated-grant)",
  );
});
