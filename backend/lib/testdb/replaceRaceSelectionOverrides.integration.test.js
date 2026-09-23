// Integrationstest for #5246 (late-fill-log + bevar auto-flag) mod en ÆGTE Postgres-
// motor via PGlite (in-memory, ingen Docker, ingen cost) — samme mønster som
// raceSelectionBulkRpc.integration.test.js. Tester den ÆGTE, committede migration
// (database/2026-09-23-5246-late-fill-log.sql), ikke en re-typet kopi:
//
//   1. race_entries_stamp_auto_fill_trg: stempler auto_filled_at/auto_filled_source
//      ved INSERT/UPDATE OF is_auto_filled, uanset hvilken skriver der rammer
//      race_entries (raceEntryGenerator.js/raceRunner.js/replace_race_selection/
//      admin-regenerate) — se migrationens header for hvorfor det er en TRIGGER og
//      ikke en app-lags-ændring (raceEntryGenerator.js er uden for denne lanes
//      ejerskab, #5246-briefen).
//   2. replace_race_selection: skriver en race_entry_overrides-række FØR
//      delete+insert med om de ERSTATTEDE rækker var auto-fyldte (had_auto_filled)
//      og med hvilken kilde (auto_source) — lukker #5136 §2's proxy-måling
//      ("1 hold" via tidsvindue-gæt) med et direkte tal.
//
// races/race_stage_schedule/race_withdrawals/race_entries-DDL'en er den SAMME
// håndskrevne minimal-DDL som raceSelectionBulkRpc.integration.test.js's BASE_DDL
// (kun de kolonner replace_race_selection selv rører) — 2026-09-23-5246's ALTER
// TABLE ... ADD COLUMN lægger de to nye kolonner oven på den, ligesom i prod.

import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { sanitizeForPglite } from "./sanitizeForPglite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_DIR = join(__dirname, "..", "..", "..", "database");

const BASE_DDL = `
CREATE TABLE races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'scheduled',
  stages_completed INTEGER NOT NULL DEFAULT 0,
  league_division_id INTEGER,
  season_id UUID NOT NULL DEFAULT gen_random_uuid()
);
CREATE TABLE race_stage_schedule (
  race_id UUID REFERENCES races(id) ON DELETE CASCADE,
  game_day INTEGER,
  scheduled_at TIMESTAMPTZ
);
CREATE TABLE race_withdrawals (
  race_id UUID,
  team_id UUID
);
CREATE TABLE race_entries (
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL,
  team_id UUID,
  race_role TEXT NOT NULL DEFAULT 'helper',
  is_auto_filled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (race_id, rider_id)
);
`;

function loadMigration(filename) {
  const raw = readFileSync(join(DATABASE_DIR, filename), "utf8");
  return sanitizeForPglite(raw);
}

let db;
before(async () => {
  db = new PGlite();
  await db.exec(BASE_DDL);
  // #5246: den ÆGTE fil — race_entry_generator_runs, race_entries.auto_filled_at/
  // auto_filled_source + trigger, race_entry_overrides, replace_race_selection.
  await db.exec(loadMigration("2026-09-23-5246-late-fill-log.sql"));
});
after(async () => {
  if (db) await db.close();
});
beforeEach(async () => {
  await db.exec("TRUNCATE race_entries, race_entry_overrides, race_entry_generator_runs, race_stage_schedule, race_withdrawals, races CASCADE");
});

async function makeRace({ status = "scheduled", stagesCompleted = 0, seasonId, gameDays = [] } = {}) {
  const { rows } = seasonId
    ? await db.query(
        "INSERT INTO races (status, stages_completed, season_id) VALUES ($1, $2, $3) RETURNING id, season_id",
        [status, stagesCompleted, seasonId],
      )
    : await db.query(
        "INSERT INTO races (status, stages_completed) VALUES ($1, $2) RETURNING id, season_id",
        [status, stagesCompleted],
      );
  const { id: raceId, season_id: raceSeasonId } = rows[0];
  for (const gd of gameDays) {
    await db.query("INSERT INTO race_stage_schedule (race_id, game_day) VALUES ($1, $2)", [raceId, gd]);
  }
  return { raceId, seasonId: raceSeasonId };
}

async function insertEntry({ raceId, teamId, riderId, isAutoFilled = false, autoFilledSource = null }) {
  await db.query(
    `INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled, auto_filled_source)
     VALUES ($1, $2, $3, 'helper', $4, $5)`,
    [raceId, riderId, teamId, isAutoFilled, autoFilledSource],
  );
}

async function callReplace({ teamId, raceId, riderIds, roles }) {
  return db.query(
    "SELECT replace_race_selection($1::uuid, $2::uuid, $3::uuid[], $4::text[])",
    [teamId, raceId, riderIds, roles],
  );
}

async function entriesFor(raceId, teamId) {
  const { rows } = await db.query(
    "SELECT rider_id, is_auto_filled, auto_filled_at, auto_filled_source FROM race_entries WHERE race_id = $1 AND team_id = $2 ORDER BY rider_id",
    [raceId, teamId],
  );
  return rows;
}

async function overridesFor(raceId, teamId) {
  const { rows } = await db.query(
    "SELECT had_auto_filled, auto_source, overridden_at FROM race_entry_overrides WHERE race_id = $1 AND team_id = $2 ORDER BY overridden_at",
    [raceId, teamId],
  );
  return rows;
}

const TEAM = "11111111-1111-1111-1111-111111111111";
const RIDER_X = "22222222-2222-2222-2222-222222222222";
const RIDER_Y = "33333333-3333-3333-3333-333333333333";

// ── migrationen loader + de nye objekter findes ─────────────────────────────────────

test("migrationen loader fejlfrit: replace_race_selection, triggeren og de to nye tabeller findes", async () => {
  const { rows: fn } = await db.query(`SELECT proname FROM pg_proc WHERE proname = 'replace_race_selection'`);
  assert.equal(fn.length, 1);
  const { rows: trg } = await db.query(`SELECT tgname FROM pg_trigger WHERE tgname = 'race_entries_stamp_auto_fill_trg'`);
  assert.equal(trg.length, 1);
  const { rows: tables } = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
       AND table_name IN ('race_entry_generator_runs', 'race_entry_overrides') ORDER BY table_name`,
  );
  assert.deepEqual(tables.map((r) => r.table_name), ["race_entry_generator_runs", "race_entry_overrides"]);
});

// ── triggeren: race_entries_stamp_auto_fill_trg ─────────────────────────────────────

test("trigger: is_auto_filled=true UDEN eksplicit source → auto_filled_at sat, auto_filled_source default 'late_fill'", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true });
  const [row] = await entriesFor(raceId, TEAM);
  assert.ok(row.auto_filled_at, "auto_filled_at skal være sat af triggeren");
  assert.equal(row.auto_filled_source, "late_fill");
});

test("trigger: is_auto_filled=true MED eksplicit source='start_rescue' → bevares uændret (raceRunner.js's vej)", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true, autoFilledSource: "start_rescue" });
  const [row] = await entriesFor(raceId, TEAM);
  assert.equal(row.auto_filled_source, "start_rescue");
  assert.ok(row.auto_filled_at);
});

test("trigger: is_auto_filled=false → auto_filled_at/auto_filled_source ryddet til NULL (manuel udtagelse)", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: false });
  const [row] = await entriesFor(raceId, TEAM);
  assert.equal(row.auto_filled_at, null);
  assert.equal(row.auto_filled_source, null);
});

test("trigger: UPDATE der rører is_auto_filled (fx re-affirmering) bevarer det OPRINDELIGE auto_filled_at/source via COALESCE", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true, autoFilledSource: "start_rescue" });
  const [before1] = await entriesFor(raceId, TEAM);
  await db.query(
    "UPDATE race_entries SET is_auto_filled = true WHERE race_id = $1 AND rider_id = $2",
    [raceId, RIDER_X],
  );
  const [after1] = await entriesFor(raceId, TEAM);
  assert.equal(after1.auto_filled_source, "start_rescue", "kilden må ikke skifte til default ved en re-affirmering");
  assert.equal(
    new Date(after1.auto_filled_at).getTime(),
    new Date(before1.auto_filled_at).getTime(),
    "det oprindelige tidsstempel må ikke rykke sig",
  );
});

// ── replace_race_selection: race_entry_overrides-logningen ─────────────────────────

test("replace_race_selection: første gem for (løb,hold) uden eksisterende entries → had_auto_filled=false, auto_source=NULL", async () => {
  const { raceId } = await makeRace();
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_X], roles: ["captain"] });
  const overrides = await overridesFor(raceId, TEAM);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].had_auto_filled, false);
  assert.equal(overrides[0].auto_source, null);
});

test("replace_race_selection: erstatter en RENT auto-fyldt trup ('late_fill') → had_auto_filled=true, auto_source='late_fill'", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true }); // default trigger-source: late_fill
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_Y], roles: ["captain"] });
  const overrides = await overridesFor(raceId, TEAM);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].had_auto_filled, true);
  assert.equal(overrides[0].auto_source, "late_fill");
  // Selve erstatningen: manageren har nu selv en manuel række.
  const [row] = await entriesFor(raceId, TEAM);
  assert.equal(row.rider_id, RIDER_Y);
  assert.equal(row.is_auto_filled, false);
  assert.equal(row.auto_filled_at, null, "en manuel gemt entry har intet auto-stempel");
});

test("replace_race_selection: erstatter en trup med BEGGE kilder blandet → auto_source='mixed'", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true, autoFilledSource: "late_fill" });
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_Y, isAutoFilled: true, autoFilledSource: "start_rescue" });
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_X], roles: ["captain"] });
  const overrides = await overridesFor(raceId, TEAM);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].had_auto_filled, true);
  assert.equal(overrides[0].auto_source, "mixed");
});

test("replace_race_selection: erstatter en RENT manuel trup → had_auto_filled=false (ikke en selvrettelse af assistenten)", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: false });
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_Y], roles: ["captain"] });
  const overrides = await overridesFor(raceId, TEAM);
  assert.equal(overrides[0].had_auto_filled, false);
  assert.equal(overrides[0].auto_source, null);
});

test("replace_race_selection: EN raekke pr. kald — to på hinanden følgende gem giver to override-rækker", async () => {
  const { raceId } = await makeRace();
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_X], roles: ["captain"] });
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_Y], roles: ["captain"] });
  const overrides = await overridesFor(raceId, TEAM);
  assert.equal(overrides.length, 2);
});

// ── uændret kerneadfærd (sanity — binding-guard-logikken er byte-for-byte uændret
//    fra 2026-08-18-3420; "frosset løb"-guarden (selection_race_started) hører
//    KUN til replace_race_selection_bulk/app-lagets prepareSelectionChange, IKKE
//    denne singular-RPC — se raceSelection.js. Testes derfor med den guard
//    replace_race_selection FAKTISK har: overlappende rytter-binding, #2256) ────

test("replace_race_selection: kernefunktionen virker stadig uændret — afviser en rytter allerede committet i et overlappende løb (selection_rider_bound), OG skriver ingen override-række for det afviste kald", async () => {
  const { raceId: raceA, seasonId } = await makeRace({ gameDays: [1, 2, 3] });
  const { raceId: raceB } = await makeRace({ seasonId, gameDays: [2, 3, 4] });
  // RIDER_X er allerede committet i raceA (fuldt game_day-backfillet, [1,2,3]).
  await callReplace({ teamId: TEAM, raceId: raceA, riderIds: [RIDER_X], roles: ["captain"] });
  // raceB's vindue [2,3,4] overlapper raceA's [1,2,3] i samme sæson → afvist.
  await assert.rejects(
    () => callReplace({ teamId: TEAM, raceId: raceB, riderIds: [RIDER_X], roles: ["captain"] }),
    /selection_rider_bound/,
  );
  // Hele det afviste kald ruller tilbage ATOMISK — ingen entries og ingen
  // override-log-række for raceB (raceA's EGET, lykkedes gem har naturligvis sin egen).
  assert.equal((await entriesFor(raceB, TEAM)).length, 0);
  assert.equal((await overridesFor(raceB, TEAM)).length, 0);
  assert.equal((await overridesFor(raceA, TEAM)).length, 1);
});
