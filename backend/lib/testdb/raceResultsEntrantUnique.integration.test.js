// Integrationstest for race_results-integritet (#3022) mod en ægte Postgres-motor
// via PGlite (in-memory, ingen Docker, ingen cost) — samme mønster som
// fictionalRiderGenerator.integration.test.js.
//
// Kører de TO ÆGTE, COMMITTEDE migrations-filer (database/proposals/2026-08-05-*.sql)
// mod et prod-tro race_results-skema — IKKE en re-typet kopi. Beviser:
//   1. entrant_key-kolonnen beregnes af DB'en 1:1 som backend/lib/raceResultEntrantKey.js
//      forudsiger (de to sider bevises ENIGE her, ikke bare "burde matche").
//   2. race_results_entrant_unique afviser en ægte dublet (rider_id-baseret).
//   3. Constrainten afviser OGSÅ en dublet blandt NULL-rider_id-orphans med
//      identisk navne-fallback — den kollision den naive nøgle ikke ville fange.
//   4. To FORSKELLIGE orphans (forskelligt navn) for samme løb/etape/klassement
//      kolliderer IKKE — ingen falsk-positiv fra navne-fallbacken.
//   5. apply_race_results_batch-RPC'en gør delete+insert atomisk: en fejlet insert
//      (unique-violation) ruller BÅDE insert og det forudgående delete tilbage.
//
// riders/teams/races-DDL'en er minimal (kun de kolonner race_results refererer),
// gen_random_uuid() i stedet for uuid_generate_v4() (PGlite har ikke uuid-ossp —
// funktionelt ækvivalent for testen, samme tilgang som fictionalRiderGenerator's).

import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { sanitizeForPglite } from "./sanitizeForPglite.js";
import { computeEntrantKey } from "../raceResultEntrantKey.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_DIR = join(__dirname, "..", "..", "..", "database");

const BASE_DDL = `
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  is_ai BOOLEAN DEFAULT FALSE
);
CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firstname TEXT,
  lastname TEXT,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL
);
CREATE TABLE races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT
);
CREATE TABLE race_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID REFERENCES races(id) ON DELETE CASCADE,
  stage_number INTEGER DEFAULT 1,
  result_type TEXT NOT NULL CHECK (result_type IN ('stage', 'gc', 'points', 'mountain', 'young', 'team', 'leader', 'mountain_day', 'points_day', 'young_day', 'team_day')),
  rank INTEGER,
  rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
  rider_name TEXT,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  team_name TEXT,
  finish_time TEXT,
  points_earned INTEGER DEFAULT 0,
  prize_money BIGINT DEFAULT 0,
  in_breakaway BOOLEAN NOT NULL DEFAULT false,
  breakaway_caught BOOLEAN NOT NULL DEFAULT false,
  sprint_points INTEGER,
  kom_points INTEGER,
  bonus_seconds INTEGER,
  imported_at TIMESTAMPTZ DEFAULT NOW()
);
`;

function loadProposal(filename) {
  const raw = readFileSync(join(DATABASE_DIR, "proposals", filename), "utf8");
  return sanitizeForPglite(raw);
}

function loadMigration(filename) {
  const raw = readFileSync(join(DATABASE_DIR, filename), "utf8");
  return sanitizeForPglite(raw);
}

let db;
before(async () => {
  db = new PGlite();
  await db.exec(BASE_DDL);
  await db.exec(loadProposal("2026-08-05-race-results-entrant-key-unique-constraint.sql"));
  await db.exec(loadProposal("2026-08-05-race-results-batch-write-atomic-rpc.sql"));
  // #3416: entrant_uid-migrationen ovenpå — præcis som prod-apply-rækkefølgen.
  await db.exec(loadMigration("2026-08-06-race-results-entrant-uid.sql"));
});
after(async () => {
  if (db) await db.close();
});
beforeEach(async () => {
  await db.exec("TRUNCATE race_results, riders, teams, races CASCADE");
});

async function makeRace() {
  const { rows } = await db.query("INSERT INTO races (name) VALUES ('Test Race') RETURNING id");
  return rows[0].id;
}
async function makeRider(name = "Test Rider") {
  const { rows } = await db.query("INSERT INTO riders (firstname, lastname) VALUES ($1, $2) RETURNING id", [name, "X"]);
  return rows[0].id;
}

test("migrationen loader fejlfrit og constrainten findes", async () => {
  const { rows } = await db.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'race_results_entrant_unique'`,
  );
  assert.equal(rows.length, 1, "race_results_entrant_unique skal eksistere efter migrationen");
});

test("entrant_key beregnet af DB matcher JS-sidens computeEntrantKey 1:1 (rider_id sat)", async () => {
  const raceId = await makeRace();
  const riderId = await makeRider();
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rider_id, rider_name, team_name)
     VALUES ($1, 1, 'stage', $2, 'Real Rider', 'Real Team')`,
    [raceId, riderId],
  );
  const { rows } = await db.query("SELECT entrant_key FROM race_results LIMIT 1");
  assert.equal(rows[0].entrant_key, computeEntrantKey({ result_type: "stage", rider_id: riderId, rider_name: "Real Rider", team_name: "Real Team" }));
  assert.equal(rows[0].entrant_key, riderId, "rider_id-tilstedeværelse skal give entrant_key = rider_id");
});

test("entrant_key beregnet af DB matcher JS-sidens computeEntrantKey 1:1 (rider_id NULL, navne-fallback)", async () => {
  const raceId = await makeRace();
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rider_id, rider_name, team_name)
     VALUES ($1, 4, 'gc', NULL, 'AI Rider 7', 'AI Team 12')`,
    [raceId],
  );
  const { rows } = await db.query("SELECT entrant_key FROM race_results LIMIT 1");
  const expected = computeEntrantKey({ result_type: "gc", rider_id: null, rider_name: "AI Rider 7", team_name: "AI Team 12" });
  assert.equal(rows[0].entrant_key, expected);
  assert.equal(rows[0].entrant_key, "rider-name:ai rider 7::ai team 12");
});

test("race_results_entrant_unique afviser en ægte dublet (samme rider_id, samme løb/etape/klassement)", async () => {
  const raceId = await makeRace();
  const riderId = await makeRider();
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id) VALUES ($1, 1, 'gc', 1, $2)`,
    [raceId, riderId],
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id) VALUES ($1, 1, 'gc', 2, $2)`,
      [raceId, riderId],
    ),
    /race_results_entrant_unique/,
  );
});

test("race_results_entrant_unique afviser en dublet blandt NULL-rider_id-orphans med identisk navne-fallback (#1847-klassen)", async () => {
  const raceId = await makeRace();
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_name)
     VALUES ($1, 3, 'stage', 5, NULL, 'AI Rider 7', 'AI Team 12')`,
    [raceId],
  );
  await assert.rejects(
    () => db.query(
      `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_name)
       VALUES ($1, 3, 'stage', 6, NULL, 'AI Rider 7', 'AI Team 12')`,
      [raceId],
    ),
    /race_results_entrant_unique/,
    "den naive (race_id,stage,type,rider_id)-nøgle ville IKKE have fanget denne — begge har rider_id NULL",
  );
});

test("to FORSKELLIGE orphans (forskelligt navn, samme AI-hold) kolliderer IKKE — ingen falsk-positiv", async () => {
  const raceId = await makeRace();
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_name)
     VALUES ($1, 3, 'stage', 5, NULL, 'AI Rider 7', 'AI Team 12')`,
    [raceId],
  );
  // Skal IKKE kaste — andet rider_name, samme team_name.
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_name)
     VALUES ($1, 3, 'stage', 6, NULL, 'AI Rider 8', 'AI Team 12')`,
    [raceId],
  );
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM race_results WHERE race_id = $1", [raceId]);
  assert.equal(rows[0].n, 2);
});

test("team-scoped rækker (team/team_day) og rider-scoped rækker deler IKKE identitetsrum", async () => {
  const raceId = await makeRace();
  const teamId = (await db.query("INSERT INTO teams (name) VALUES ('Team A') RETURNING id")).rows[0].id;
  // Samme UUID-værdi kan aldrig gå igen mellem rider_id og team_id (forskellige tabeller),
  // men entrant_key for 'team' bruger CASE-grenen for team_id — bevis at den rammer korrekt
  // og ikke falder ned i rider-grenen (som ville give en anden nøgle).
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, team_id, team_name) VALUES ($1, 1, 'team', 1, $2, 'Team A')`,
    [raceId, teamId],
  );
  const { rows } = await db.query("SELECT entrant_key FROM race_results LIMIT 1");
  assert.equal(rows[0].entrant_key, teamId);
});

test("apply_race_results_batch: normal skrivning sletter berørte etaper + inserter atomisk", async () => {
  const raceId = await makeRace();
  const riderId = await makeRider();
  // Forudgående række for etape 1 (skal slettes af batchen).
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id) VALUES ($1, 1, 'stage', 1, $2)`,
    [raceId, riderId],
  );
  const rows = JSON.stringify([
    { rider_id: riderId, rider_name: "Test Rider", result_type: "stage", rank: 1, stage_number: 1, points_earned: 50, prize_money: 50000 },
  ]);
  const { rows: out } = await db.query(
    `SELECT apply_race_results_batch($1::uuid, ARRAY[1], $2::jsonb) AS result`,
    [raceId, rows],
  );
  assert.equal(out[0].result.rows_deleted, 1);
  assert.equal(out[0].result.rows_inserted, 1);
  const { rows: after } = await db.query("SELECT COUNT(*)::int AS n FROM race_results WHERE race_id = $1", [raceId]);
  assert.equal(after[0].n, 1, "gammel række slettet, ny række indsat — netto uændret antal");
});

test("apply_race_results_batch: PARTIAL-ROLLBACK — en unique-violation midt i batchen ruller BÅDE delete og insert tilbage", async () => {
  const raceId = await makeRace();
  const riderId = await makeRider();
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id) VALUES ($1, 1, 'stage', 1, $2)`,
    [raceId, riderId],
  );
  // Batch med to rækker for SAMME rider_id/result_type/stage — vil kollidere internt
  // (Postgres evaluerer UNIQUE inkrementelt pr. row inden for samme statement/insert-sæt).
  const rows = JSON.stringify([
    { rider_id: riderId, result_type: "stage", rank: 1, stage_number: 1 },
    { rider_id: riderId, result_type: "stage", rank: 2, stage_number: 1 },
  ]);
  await assert.rejects(
    () => db.query(`SELECT apply_race_results_batch($1::uuid, ARRAY[1], $2::jsonb) AS result`, [raceId, rows]),
    /race_results_entrant_unique/,
  );
  // INGEN partial state: den oprindelige række overlevede (delete'et blev rullet tilbage
  // sammen med det fejlede insert — hele funktionskaldet er ÉN transaktion).
  const { rows: after } = await db.query("SELECT COUNT(*)::int AS n FROM race_results WHERE race_id = $1", [raceId]);
  assert.equal(after[0].n, 1, "løbet må IKKE stå resultatløst efter en rullet-tilbage batch — den GAMLE række skal stadig være der");
});

// ── #3416: entrant_uid — nøglen er STABIL hen over rytter-/hold-sletning ──────

test("#3416-regression: to ryttere med SAMME navn på samme hold — sletning lykkes og rækkerne forbliver distinkte", async () => {
  const raceId = await makeRace();
  const teamId = (await db.query("INSERT INTO teams (name, is_ai) VALUES ('AI Aero Devo', TRUE) RETURNING id")).rows[0].id;
  const r1 = (await db.query(
    "INSERT INTO riders (firstname, lastname, team_id) VALUES ('Minjun', 'Han', $1) RETURNING id", [teamId],
  )).rows[0].id;
  const r2 = (await db.query(
    "INSERT INTO riders (firstname, lastname, team_id) VALUES ('Minjun', 'Han', $1) RETURNING id", [teamId],
  )).rows[0].id;
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name)
     VALUES ($1, 1, 'stage', 5, $2, 'Minjun Han', $3, 'AI Aero Devo'),
            ($1, 1, 'stage', 6, $4, 'Minjun Han', $3, 'AI Aero Devo')`,
    [raceId, r1, teamId, r2],
  );
  // Prod-fejlen: dette DELETE væltede med race_results_entrant_unique fordi begge
  // rækkers nøgle kollapsede til 'rider-name:minjun han::ai aero devo' ved SET NULL.
  await db.query("DELETE FROM riders WHERE team_id = $1", [teamId]);
  const { rows } = await db.query(
    "SELECT entrant_key, entrant_uid, rider_id, rider_name FROM race_results WHERE race_id = $1 ORDER BY rank", [raceId],
  );
  assert.equal(rows.length, 2, "begge historik-rækker skal overleve sletningen");
  assert.equal(rows[0].rider_id, null);
  assert.equal(rows[0].rider_name, "Minjun Han", "navne-snapshottet skal stadig sættes");
  assert.equal(rows[0].entrant_uid, r1, "entrant_uid = den slettede rytters uuid");
  assert.equal(rows[1].entrant_uid, r2);
  assert.equal(rows[0].entrant_key, r1, "nøglen skal være UÆNDRET af sletningen (uid-grenen, ikke navne-grenen)");
  assert.equal(rows[1].entrant_key, r2);
});

test("#3416: DB's entrant_key matcher JS-sidens computeEntrantKey også i entrant_uid-grenen", async () => {
  const raceId = await makeRace();
  const riderId = await makeRider("Solo");
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_name)
     VALUES ($1, 2, 'gc', 1, $2, 'Solo X', 'Team Y')`,
    [raceId, riderId],
  );
  await db.query("DELETE FROM riders WHERE id = $1", [riderId]);
  const { rows } = await db.query("SELECT entrant_key, entrant_uid FROM race_results WHERE race_id = $1", [raceId]);
  const expected = computeEntrantKey({
    result_type: "gc", rider_id: null, entrant_uid: rows[0].entrant_uid, rider_name: "Solo X", team_name: "Team Y",
  });
  assert.equal(rows[0].entrant_key, expected, "DB og JS skal være enige om uid-fallbacken");
  assert.equal(rows[0].entrant_key, riderId);
});

test("#3416: hold-sletning giver team-scoped rækker uid = holdets uuid; rider-scoped rækker røres ikke", async () => {
  const raceId = await makeRace();
  const teamId = (await db.query("INSERT INTO teams (name, is_ai) VALUES ('AI Uid Team', TRUE) RETURNING id")).rows[0].id;
  const riderId = await makeRider("Alive");
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, team_id, team_name)
     VALUES ($1, 1, 'team', 1, $2, NULL)`,
    [raceId, teamId],
  );
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name)
     VALUES ($1, 1, 'stage', 1, $2, 'Alive X', $3, NULL)`,
    [raceId, riderId, teamId],
  );
  await db.query("DELETE FROM teams WHERE id = $1", [teamId]);
  const { rows } = await db.query(
    "SELECT result_type, entrant_key, entrant_uid, team_name FROM race_results WHERE race_id = $1 ORDER BY result_type", [raceId],
  );
  const stageRow = rows.find((r) => r.result_type === "stage");
  const teamRow = rows.find((r) => r.result_type === "team");
  assert.equal(teamRow.entrant_uid, teamId, "team-scoped række: uid = holdets uuid");
  assert.equal(teamRow.entrant_key, teamId, "team-scoped nøgle uændret af sletningen");
  assert.equal(teamRow.team_name, "AI Uid Team", "navne-snapshottet sættes stadig");
  assert.equal(stageRow.entrant_uid, null, "rider-scoped række ejes af rytteren — hold-sletning sætter IKKE dens uid");
  assert.equal(stageRow.entrant_key, riderId, "rider-scoped nøgle er stadig rytterens id (rytteren lever)");
});

test("apply_race_results_batch: en anden etape end p_stage_numbers er urørt (idempotent PR. ETAPE bevaret)", async () => {
  const raceId = await makeRace();
  const riderId = await makeRider();
  await db.query(
    `INSERT INTO race_results (race_id, stage_number, result_type, rank, rider_id) VALUES ($1, 2, 'stage', 1, $2)`,
    [raceId, riderId],
  );
  const rows = JSON.stringify([
    { rider_id: riderId, result_type: "stage", rank: 1, stage_number: 1 },
  ]);
  await db.query(`SELECT apply_race_results_batch($1::uuid, ARRAY[1], $2::jsonb) AS result`, [raceId, rows]);
  const { rows: stage2 } = await db.query(
    "SELECT COUNT(*)::int AS n FROM race_results WHERE race_id = $1 AND stage_number = 2",
    [raceId],
  );
  assert.equal(stage2[0].n, 1, "etape 2 skal være urørt når kun etape 1 sendes med i batchen");
});
