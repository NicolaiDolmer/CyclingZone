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
//   - riders-pending-team-id-drift-closer — riders.pending_team_id + FK + index
//                                 (#2628 — kolonnen findes i prod, men var ALDRIG
//                                 committet som migration; se filens header)
//
// rider-types loades tidligt fordi strategi-rosterens projektion (primary_type /
// secondary_type) afhænger af de kolonner — uden den fejler fidelitets-meta-testen.
//
// ⚠️ DRIFT-RISIKO (drift-gap, jf. spec §7 "Lag 2 skema-samling"): denne liste er
// HÅND-VEDLIGEHOLDT. Fidelitets-meta-testen beviser KUN at KENDTE kolonner findes —
// den fanger IKKE at listen er ufuldstændig. Hvis en ny `ADD COLUMN`-migration lander
// på en tabel et contract-testet endpoint projicerer (riders/races/…), SKAL filen
// tilføjes her i dato-rækkefølge — ellers giver harnessen falsk-grøn (kolonnen findes
// i prod men ikke i det loadede skema). Tilføj OGSÅ en kolonne-assertion i den
// relevante contract-test, så et glemt fil-tilføj fanges. Robustere fremtid (load alle
// database/*.sql i dato-orden, fejl loud ved inkompatibel migration) er en tracket
// opfølgning, ikke gjort her. #2628 fandt YDERLIGERE hånd-vedligeholdelses-drift
// (kolonner i prod som denne liste ikke loader) på flere tabeller — dokumenteret i
// PR-body, ikke fixet her (kun pending_team_id var i scope).
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
  "2026-07-18-riders-pending-team-id-drift-closer.sql",
  // #4619 · riders.squad. SKAL loades: senior-læsernes delte filter
  // (squads.applySeniorSquadFilter) spørger på kolonnen, så uden migrationen
  // ville contract-testenes endpoints fejle mod PGlite — præcis den drift-fælde
  // listens egen header advarer om.
  "2026-09-15-4619-riders-squad.sql",
  // #5517 · league_divisions.squad + races.squad + teams' ungdomspulje-FK'er. SKAL
  // loades af samme grund som riders.squad ovenfor: senior-læsernes delte scope
  // (squads.withSeniorSquadScope) filtrerer på kolonnen, og PGlite-skemaet skal
  // bevise at migrationen faktisk kan køres (idempotent, to gange) oven på base-
  // skemaets inline UNIQUE (tier, pool_index).
  "2026-09-24-5517-squad-leagues-races-teams.sql",
];

// #5535 (spor S1) · Kolonner som senior-resultat-aggregaterne læser, og som prod
// har fra migrationer der IKKE kan loades alene her: begge filer rører også
// tabeller uden for base-skemaet (transfer_windows hhv. admin_log). Statements er
// kopieret ordret fra kildefilen, så typen og defaulten er prods.
export const RESULT_AGGREGATE_DRIFT_DDL = {
  label: "drift: season_standings.penalty_points + finance_transactions.related_entity_type",
  sql: `
    -- 2026-05-04-squad-enforcement.sql §3
    ALTER TABLE season_standings
      ADD COLUMN IF NOT EXISTS penalty_points BIGINT NOT NULL DEFAULT 0;
    -- 2026-05-09-audit-log-foundation.sql
    ALTER TABLE finance_transactions
      ADD COLUMN IF NOT EXISTS related_entity_type TEXT;
  `,
};

// #5535 (spor S1) · Skemaet bag seniorstillingen, de tre rangliste-matviews og
// dashboard/recap-funktionerne. SQL-funktioner og matviews valideres mod skemaet
// når de OPRETTES, så hver kolonne de nævner skal findes før S1-migrationen:
//   - teams.is_test_account, finance_transactions.metadata, races.league_division_id
//     fra deres egne (PGlite-loadbare) migrationer, resten via drift-DDL'en ovenfor.
//   - 2026-07-04-ranking-matviews.sql loader prods matviews som de så ud FØR S1, så
//     S1's DROP + CREATE køres oven på eksisterende views, præcis som i prod.
// S4 (ungdomsstilling) og S5 (ungdoms-rytterrangliste) bygger videre på listen.
export const RESULT_AGGREGATE_PRE_S1_FILES = [
  ...RACE_HUB_SCHEMA_FILES,
  "2026-05-08-teams-is-test-account.sql",
  "2026-05-26-backend-message-codes.sql",
  "2026-06-22-races-league-division.sql",
  RESULT_AGGREGATE_DRIFT_DDL,
  "2026-07-04-ranking-matviews.sql",
];

export const RESULT_AGGREGATE_SCHEMA_FILES = [
  ...RESULT_AGGREGATE_PRE_S1_FILES,
  "2026-09-25-5535-senior-only-result-aggregates.sql",
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
  -- Supabase opretter selv publikationen 'supabase_realtime'; PGlite har den ikke.
  -- Flere migrationer (fx 2026-08-06-3199-forum.sql) tilfoejer tabeller til den i
  -- en DO-blok, som sanitizeForPglite ikke kan strippe (den ligger inde i et
  -- PL/pgSQL-legeme, ikke som et selvstaendigt statement). Uden stubben fejler
  -- loadet med 42704 "publication does not exist". #4818.
  CREATE PUBLICATION supabase_realtime;
`;

/**
 * Opret en frisk in-memory Postgres med det ægte (sanerede) skema loadet.
 *
 * @param {object} [opts]
 * @param {Array<string | {label: string, sql: string}>} [opts.files] ordnet liste af
 *   filnavne i database/ (default RACE_HUB_SCHEMA_FILES). Et `{label, sql}`-element er
 *   inline drift-DDL (fx RESULT_AGGREGATE_DRIFT_DDL) og loades på sin plads i listen.
 * @returns {Promise<import("@electric-sql/pglite").PGlite>} klar PGlite-instans
 */
export async function createTestDb({ files = RACE_HUB_SCHEMA_FILES } = {}) {
  const db = new PGlite();
  await db.exec(PREREQ);

  for (const file of files) {
    const label = typeof file === "string" ? file : file.label;
    const raw = typeof file === "string" ? readFileSync(join(DATABASE_DIR, file), "utf8") : file.sql;
    const sql = sanitizeForPglite(raw);
    try {
      await db.exec(sql);
    } catch (err) {
      // Wrap med filnavn så en DDL-fejl er debugbar (hvilken migration fejlede).
      throw new Error(`createTestDb: load af '${label}' fejlede i PGlite: ${err.message}`, {
        cause: err,
      });
    }
  }
  return db;
}

/**
 * Indholdet af en migrationsfil i database/ (til tests der kører en fil igen).
 *
 * @param {string} file filnavn i database/
 * @returns {string} rå SQL
 */
export function readMigration(file) {
  return readFileSync(join(DATABASE_DIR, file), "utf8");
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
