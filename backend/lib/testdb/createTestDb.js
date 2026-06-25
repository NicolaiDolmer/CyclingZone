// createTestDb — in-memory Postgres-harness til pre-live contract-tests (#1840, B2).
//
// Loader den ÆGTE committede DDL (database/*.sql) mod en éngangs-PGlite-instans,
// saneret via sanitizeForPglite (stripper Supabase-isms PGlite ikke kan køre).
// Formålet: contract-tests kan køre et endpoints reelle kolonne-projektion mod det
// reelle skema, så en ikke-eksisterende kolonne (riders.overall, #1840) fejler i CI.
//
// Ingen Docker/cost — samme mønster som countriesSeed.integration.test.js (#669/#844).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { sanitizeForPglite } from "./sanitizeForPglite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// backend/lib/testdb -> repo-root/database
const DATABASE_DIR = join(__dirname, "..", "..", "..", "database");

// Ordnet liste over de committede DDL-filer der tilsammen skaber Race-Hub-/
// strategi-fladens tabeller. Rækkefølgen er load-rækkefølge (FK-afhængigheder):
//   1. schema.sql               — base: teams, riders, seasons, races, ...
//   2. 2026-06-06-rider-types   — riders.primary_type / secondary_type (#49)
//   3. 2026-05-16-app-config    — public.app_config (race_engine_v2-flag mm.);
//                                 SKAL loades før race-engine-slice2's INSERT i den
//   4..N race-engine-migrations — fysiologi, stage-profiler, slice2, progress
//   - academy-mvp               — is_academy-relaterede tabeller
//   - team-race-strategy        — selve strategi-tabellen (#1834 / S3)
//
// rider-types loades tidligt fordi strategi-rosterens projektion (primary_type /
// secondary_type) afhænger af de kolonner — uden den fejler fidelitets-meta-testen.
export const RACE_HUB_SCHEMA_FILES = [
  "schema.sql",
  "2026-06-06-rider-types.sql",
  "2026-05-16-app-config.sql",
  "2026-06-04-race-engine-physiology-schema.sql",
  "2026-06-06-race-stage-profiles.sql",
  "2026-06-07-race-engine-slice2.sql",
  "2026-06-20-races-stage-progress.sql",
  "2026-06-13-academy-mvp.sql",
  "2026-06-25-team-race-strategy.sql",
];

// Supabase-prærekvisitter som migrationerne antager findes i prod, men som PGlite
// ikke har. Vi stubber dem minimalt så DDL'en kan loades:
//   - roller authenticated/anon/service_role (refereret af GRANT/policy — vi
//     stripper GRANT/policy, men stubber rollerne for en sikkerheds skyld)
//   - schema `auth` + auth.uid()/auth.role() (refereres i policy-bodies; strippes,
//     men stub gør load robust hvis en reference smutter med)
//   - public.is_admin() => false
//   - uuid_generate_v4(): schema.sql bruger uuid-ossp's funktion (CREATE EXTENSION
//     "uuid-ossp" findes ikke i PGlite). Vi mapper den til PGlite's indbyggede
//     gen_random_uuid(), så DEFAULT-udtryk på PK-kolonner virker.
const PREREQ = `
  CREATE ROLE authenticated;
  CREATE ROLE anon;
  CREATE ROLE service_role;
  CREATE SCHEMA IF NOT EXISTS auth;
  -- Minimal stub af Supabase's auth.users (FK-mål for fx app_config.updated_by).
  -- Supabase ejer denne tabel; PGlite har den ikke. Vi skaber kun id-kolonnen så
  -- FK-referencer resolver — vi tester ikke auth-laget her.
  CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
  CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE OR REPLACE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
`;

/**
 * Opret en frisk in-memory Postgres med det ægte (sanerede) skema loadet.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.files] ordnet liste af filnavne i database/ (default RACE_HUB_SCHEMA_FILES)
 * @returns {Promise<import("@electric-sql/pglite").PGlite>} klar PGlite-instans
 */
export async function createTestDb({ files = RACE_HUB_SCHEMA_FILES } = {}) {
  const db = new PGlite();
  await db.exec(PREREQ);

  for (const file of files) {
    const raw = readFileSync(join(DATABASE_DIR, file), "utf8");
    const sql = sanitizeForPglite(raw);
    try {
      await db.exec(sql);
    } catch (err) {
      // Wrap med filnavn så en DDL-fejl er debugbar (hvilken migration fejlede).
      throw new Error(`createTestDb: load af '${file}' fejlede i PGlite: ${err.message}`, {
        cause: err,
      });
    }
  }
  return db;
}

/**
 * True hvis `table` har kolonnen `column` i public-skemaet for det loadede skema.
 *
 * @param {import("@electric-sql/pglite").PGlite} db
 * @param {string} table
 * @param {string} column
 * @returns {Promise<boolean>}
 */
export async function columnExists(db, table, column) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

export default createTestDb;
