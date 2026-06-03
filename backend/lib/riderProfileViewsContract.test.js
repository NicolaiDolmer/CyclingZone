import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Contract: migration 2026-06-03-rider-profile-views.sql (#963) skal
// (1) oprette rider_profile_views med FK til riders + auth.users (ON DELETE CASCADE),
// (2) håndhæve daily-dedup via en navngiven UNIQUE-constraint på (user_id, rider_id, view_date),
// (3) have view_date som GENERATED STORED UTC-dag (så ON CONFLICT kan bruge constraint-navnet),
// (4) aktivere RLS med en authenticated-insert-own policy (og INGEN authenticated SELECT-policy),
// (5) have indexes der understøtter per-rytter + globale tidsvinduer.
// Ændres migrationen uden at bevare disse garantier, fejler testen.

const MIGRATION_PATH = resolve(
  __dirname,
  "../../database/2026-06-03-rider-profile-views.sql",
);

function migrationContent() {
  return readFileSync(MIGRATION_PATH, "utf8");
}

test("#963 migration opretter rider_profile_views med cascade-FKs", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /CREATE TABLE IF NOT EXISTS rider_profile_views/i,
    "tabellen rider_profile_views skal oprettes",
  );
  assert.match(
    sql,
    /rider_id\s+UUID\s+NOT NULL\s+REFERENCES riders\(id\)\s+ON DELETE CASCADE/i,
    "rider_id skal være UUID FK til riders med ON DELETE CASCADE",
  );
  assert.match(
    sql,
    /user_id\s+UUID\s+NOT NULL\s+REFERENCES auth\.users\(id\)\s+ON DELETE CASCADE/i,
    "user_id skal være UUID FK til auth.users med ON DELETE CASCADE",
  );
});

test("#963 view_date er en GENERATED STORED UTC-dag", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /view_date\s+DATE\s+NOT NULL\s+GENERATED ALWAYS AS\s*\(\s*\(viewed_at AT TIME ZONE 'UTC'\)::date\s*\)\s*STORED/i,
    "view_date skal være GENERATED ALWAYS AS ((viewed_at AT TIME ZONE 'UTC')::date) STORED",
  );
});

test("#963 daily-dedup håndhæves af navngiven UNIQUE-constraint", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /CONSTRAINT rider_profile_views_daily_uniq UNIQUE \(user_id, rider_id, view_date\)/i,
    "UNIQUE (user_id, rider_id, view_date) skal hedde rider_profile_views_daily_uniq — ON CONFLICT bruger navnet",
  );
});

test("#963 RLS er aktiveret med authenticated-insert-own og INGEN authenticated SELECT", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /ALTER TABLE rider_profile_views ENABLE ROW LEVEL SECURITY/i,
    "RLS skal være aktiveret",
  );
  assert.match(
    sql,
    /CREATE POLICY "Authenticated can insert own rider views"[\s\S]*?FOR INSERT[\s\S]*?TO authenticated[\s\S]*?WITH CHECK \(auth\.uid\(\) = user_id\)/i,
    "INSERT-policy skal gate på auth.uid() = user_id",
  );
  assert.doesNotMatch(
    sql,
    /FOR SELECT\s+TO authenticated/i,
    "authenticated må IKKE have en SELECT-policy — læsning sker aggregeret via service_role",
  );
});

test("#963 indexes understøtter per-rytter + globale tidsvinduer", () => {
  const sql = migrationContent();
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS rider_profile_views_rider_id_viewed_at_idx[\s\S]*?\(rider_id, viewed_at DESC\)/i,
    "per-rytter index (rider_id, viewed_at DESC) skal eksistere",
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS rider_profile_views_viewed_at_idx[\s\S]*?\(viewed_at DESC\)/i,
    "globalt tidsvindue-index (viewed_at DESC) skal eksistere",
  );
});
