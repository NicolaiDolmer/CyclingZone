// Integrationstest for #5246 (late-fill-log + bevar auto-flag) mod en ÆGTE Postgres-
// motor via PGlite (in-memory, ingen Docker, ingen cost) — samme mønster som
// raceSelectionBulkRpc.integration.test.js. Tester den ÆGTE, committede migration
// (database/2026-09-23-5246-late-fill-log.sql), ikke en re-typet kopi.
//
// Rettelse 23/9 (BLOCKER fra diff-reviewet): migrationen genskabte replace_race_selection
// ud fra udgaven 18/8 (#3420), ikke den der koerer i prod (#4283). Harnessen koerer
// derfor NU hele kaeden i prod-raekkefoelge — 4173 (race_entry_days + apply_race_entry_
// unit_batch), 4191, 4217 (spaend-rebuild), 1146 + 4534 (bulk-RPC'en), 4283
// (replace_race_selection) — og FOERST DEREFTER 5246. Saa tester vi at 5246 bygger
// ovenpaa de gaeldende funktioner og ikke ruller dem tilbage.
//
// races/race_stage_schedule/race_withdrawals/race_entries-DDL'en er den SAMME
// håndskrevne minimal-DDL som raceSelectionBulkRpc.integration.test.js's BASE_DDL.

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

// Prod-raekkefoelgen for alt 5246 bygger ovenpaa (se filens header).
const PREREQUISITE_MIGRATIONS = [
  "2026-08-24-4173-rider-binding-per-game-day.sql",
  "2026-08-24-4191-race-entry-days-diff-rebuild.sql",
  "2026-08-25-4217-spaend-binding.sql",
  "2026-08-27-1146-selection-bulk-rpc.sql",
  "2026-08-27-4283-selection-guard-spaend.sql",
  "2026-08-31-4534-selection-frozen-both-directions.sql",
];
const MIGRATION_5246 = "2026-09-23-5246-late-fill-log.sql";

function loadMigration(filename) {
  const raw = readFileSync(join(DATABASE_DIR, filename), "utf8");
  return sanitizeForPglite(raw);
}

let db;
before(async () => {
  db = new PGlite();
  await db.exec(BASE_DDL);
  for (const file of PREREQUISITE_MIGRATIONS) await db.exec(loadMigration(file));
  await db.exec(loadMigration(MIGRATION_5246));
});
after(async () => {
  if (db) await db.close();
});
beforeEach(async () => {
  await db.exec(
    "TRUNCATE race_entries, race_entry_days, race_entry_overrides, race_entry_generator_runs, race_stage_schedule, race_withdrawals, races CASCADE",
  );
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

async function callBulk({ teamId, changes, autoReleases = [] }) {
  return db.query(
    "SELECT replace_race_selection_bulk($1::uuid, $2::jsonb, $3::jsonb)",
    [teamId, JSON.stringify(changes), JSON.stringify(autoReleases)],
  );
}

async function callBatch({ teamId, units }) {
  const { rows } = await db.query(
    "SELECT apply_race_entry_unit_batch($1::uuid, $2::jsonb) AS res",
    [teamId, JSON.stringify(units)],
  );
  return rows[0].res;
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

async function functionDef(signature) {
  const { rows } = await db.query(`SELECT pg_get_functiondef('${signature}'::regprocedure) AS def`);
  return rows[0].def;
}

const TEAM = "11111111-1111-1111-1111-111111111111";
const RIDER_X = "22222222-2222-2222-2222-222222222222";
const RIDER_Y = "33333333-3333-3333-3333-333333333333";

// ── migrationen loader + de nye objekter findes ─────────────────────────────────────

test("migrationen loader fejlfrit oven paa prod-kaeden: triggeren og de to nye tabeller findes", async () => {
  const { rows: trg } = await db.query(`SELECT tgname FROM pg_trigger WHERE tgname = 'race_entries_stamp_auto_fill_trg'`);
  assert.equal(trg.length, 1);
  const { rows: tables } = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
       AND table_name IN ('race_entry_generator_runs', 'race_entry_overrides') ORDER BY table_name`,
  );
  assert.deepEqual(tables.map((r) => r.table_name), ["race_entry_generator_runs", "race_entry_overrides"]);
});

test("migrationen er idempotent: en gen-koersel oven paa sig selv fejler ikke", async () => {
  await db.exec(loadMigration(MIGRATION_5246));
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'race_entries_auto_filled_source_check'",
  );
  assert.equal(rows[0].n, 1);
});

// ── BLOCKER 23/9: funktionerne bygger paa de versioner der koerer i prod ─────────────

test("BLOCKER: replace_race_selection er 4283-kroppen (race_entry_days + generate_series), ikke 3420's", async () => {
  const def = await functionDef("public.replace_race_selection(uuid,uuid,uuid[],text[])");
  assert.match(def, /FROM race_entry_days d/);
  assert.match(def, /JOIN generate_series\(v_start, v_end\) AS gs\(game_day\)/);
  assert.doesNotMatch(def, /100000/, "ingen Monument-sentinel-gren (fjernet af 4075/4173)");
  assert.doesNotMatch(def, /exclusion_violation/, "ingen fangst fra en constraint der ikke findes");
  assert.doesNotMatch(def, /no_rider_double_booking\b(?!_day)/);
  assert.match(def, /INSERT INTO race_entry_overrides/);
});

test("BLOCKER: replace_race_selection binder via race_entry_days — et FAERDIGKOERT overlappende loeb binder ikke (3420-versionen afviste)", async () => {
  const { raceId: raceA, seasonId } = await makeRace({ gameDays: [1, 2, 3] });
  const { raceId: raceB } = await makeRace({ seasonId, gameDays: [2, 3, 4] });
  await callReplace({ teamId: TEAM, raceId: raceA, riderIds: [RIDER_X], roles: ["captain"] });
  await db.query("UPDATE races SET status = 'completed' WHERE id = $1", [raceA]);
  await db.query("SELECT race_entry_days_rebuild($1::uuid, $2::uuid)", [raceA, TEAM]);
  await callReplace({ teamId: TEAM, raceId: raceB, riderIds: [RIDER_X], roles: ["captain"] });
  assert.equal((await entriesFor(raceB, TEAM)).length, 1);
});

test("BLOCKER: replace_race_selection afviser stadig en rytter bundet i et ikke-afsluttet overlappende loeb (selection_rider_bound), uden override-raekke", async () => {
  const { raceId: raceA, seasonId } = await makeRace({ gameDays: [1, 2, 3] });
  const { raceId: raceB } = await makeRace({ seasonId, gameDays: [2, 3, 4] });
  await callReplace({ teamId: TEAM, raceId: raceA, riderIds: [RIDER_X], roles: ["captain"] });
  await assert.rejects(
    () => callReplace({ teamId: TEAM, raceId: raceB, riderIds: [RIDER_X], roles: ["captain"] }),
    /selection_rider_bound/,
  );
  assert.equal((await entriesFor(raceB, TEAM)).length, 0);
  assert.equal((await overridesFor(raceB, TEAM)).length, 0, "afvist kald ruller ogsaa loggen tilbage");
  assert.equal((await overridesFor(raceA, TEAM)).length, 1);
});

test("BLOCKER: replace_race_selection binder GT-hviledagen (4217-spaendet): pause-dag i loeb A blokerer loeb B paa den dag", async () => {
  const { raceId: raceA, seasonId } = await makeRace({ gameDays: [1, 3] }); // dag 2 = hviledag
  const { raceId: raceB } = await makeRace({ seasonId, gameDays: [2] });
  await callReplace({ teamId: TEAM, raceId: raceA, riderIds: [RIDER_X], roles: ["captain"] });
  await assert.rejects(
    () => callReplace({ teamId: TEAM, raceId: raceB, riderIds: [RIDER_X], roles: ["captain"] }),
    /selection_rider_bound/,
  );
});

test("BLOCKER: replace_race_selection_bulk er 4534-kroppen + loggen (frys-guard i begge retninger bevaret)", async () => {
  const def = await functionDef("public.replace_race_selection_bulk(uuid,jsonb,jsonb)");
  assert.match(def, /selection_race_started/);
  assert.doesNotMatch(def, /v_current_rider_ids/, "4534 fjernede delmaengde-undtagelsen");
  assert.match(def, /insert into public\.race_entry_overrides/);
});

test("BLOCKER: apply_race_entry_unit_batch er 4173-kroppen + kilden (no_rider_double_booking_day udskudt)", async () => {
  const def = await functionDef("public.apply_race_entry_unit_batch(uuid,jsonb)");
  assert.match(def, /set constraints no_rider_double_booking_day deferred/);
  assert.match(def, /sweep_race_lineup_frozen/);
  assert.match(def, /auto_filled_source/);
});

// ── triggeren: race_entries_stamp_auto_fill_trg ─────────────────────────────────────

test("(c) trigger: is_auto_filled=true UDEN kilde → auto_filled_at sat, kilden forbliver NULL (ingen late_fill-default)", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true });
  const [row] = await entriesFor(raceId, TEAM);
  assert.ok(row.auto_filled_at, "auto_filled_at skal være sat af triggeren");
  assert.equal(row.auto_filled_source, null);
});

test("(c) trigger: en eksplicit kilde bevares uaendret", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true, autoFilledSource: "start_rescue" });
  const [row] = await entriesFor(raceId, TEAM);
  assert.equal(row.auto_filled_source, "start_rescue");
  assert.ok(row.auto_filled_at);
});

test("(c) CHECK: alle fem kilder accepteres", async () => {
  const { raceId } = await makeRace();
  const sources = ["late_fill", "opt_in", "start_rescue", "manager_auto", "ai_generator"];
  for (const [i, src] of sources.entries()) {
    await insertEntry({
      raceId, teamId: TEAM, riderId: `4444444${i}-4444-4444-4444-444444444444`, isAutoFilled: true, autoFilledSource: src,
    });
  }
  assert.equal((await entriesFor(raceId, TEAM)).length, sources.length);
});

test("(c) CHECK: en ukendt kilde afvises", async () => {
  const { raceId } = await makeRace();
  await assert.rejects(
    () => insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true, autoFilledSource: "sweep" }),
    /race_entries_auto_filled_source_check/,
  );
});

test("trigger: is_auto_filled=false → auto_filled_at/auto_filled_source ryddet til NULL (manuel udtagelse)", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: false, autoFilledSource: "late_fill" });
  const [row] = await entriesFor(raceId, TEAM);
  assert.equal(row.auto_filled_at, null);
  assert.equal(row.auto_filled_source, null);
});

test("trigger: UPDATE der rører is_auto_filled bevarer det OPRINDELIGE auto_filled_at/kilde", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true, autoFilledSource: "start_rescue" });
  const [before1] = await entriesFor(raceId, TEAM);
  await db.query("UPDATE race_entries SET is_auto_filled = true WHERE race_id = $1 AND rider_id = $2", [raceId, RIDER_X]);
  const [after1] = await entriesFor(raceId, TEAM);
  assert.equal(after1.auto_filled_source, "start_rescue");
  assert.equal(new Date(after1.auto_filled_at).getTime(), new Date(before1.auto_filled_at).getTime());
});

// ── replace_race_selection: race_entry_overrides-logningen ─────────────────────────

test("replace_race_selection: første gem uden eksisterende entries → had_auto_filled=false, auto_source=NULL", async () => {
  const { raceId } = await makeRace();
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_X], roles: ["captain"] });
  const overrides = await overridesFor(raceId, TEAM);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].had_auto_filled, false);
  assert.equal(overrides[0].auto_source, null);
});

test("replace_race_selection: erstatter en late_fill-trup → had_auto_filled=true, auto_source='late_fill'", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true, autoFilledSource: "late_fill" });
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_Y], roles: ["captain"] });
  const overrides = await overridesFor(raceId, TEAM);
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].had_auto_filled, true);
  assert.equal(overrides[0].auto_source, "late_fill");
  const [row] = await entriesFor(raceId, TEAM);
  assert.equal(row.rider_id, RIDER_Y);
  assert.equal(row.is_auto_filled, false);
  assert.equal(row.auto_filled_at, null);
});

test("(d) replace_race_selection: auto-raekker UDEN kilde (fra foer #5246) → auto_source='unknown', ikke 'mixed'", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true });
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_Y, isAutoFilled: true });
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_X], roles: ["captain"] });
  const [o] = await overridesFor(raceId, TEAM);
  assert.equal(o.had_auto_filled, true);
  assert.equal(o.auto_source, "unknown");
});

test("replace_race_selection: to forskellige kilder blandet → auto_source='mixed'", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true, autoFilledSource: "late_fill" });
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_Y, isAutoFilled: true, autoFilledSource: "start_rescue" });
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_X], roles: ["captain"] });
  const [o] = await overridesFor(raceId, TEAM);
  assert.equal(o.auto_source, "mixed");
});

test("replace_race_selection: erstatter en RENT manuel trup → had_auto_filled=false", async () => {
  const { raceId } = await makeRace();
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: false });
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_Y], roles: ["captain"] });
  const [o] = await overridesFor(raceId, TEAM);
  assert.equal(o.had_auto_filled, false);
  assert.equal(o.auto_source, null);
});

test("replace_race_selection: EN raekke pr. kald — to gem giver to override-rækker", async () => {
  const { raceId } = await makeRace();
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_X], roles: ["captain"] });
  await callReplace({ teamId: TEAM, raceId, riderIds: [RIDER_Y], roles: ["captain"] });
  assert.equal((await overridesFor(raceId, TEAM)).length, 2);
});

// ── (b) replace_race_selection_bulk: saesonmatrixens "Gem plan" logges ogsaa ──────────

test("(b) bulk: EN override-raekke pr. p_changes-loeb, med hvert loebs egen auto-status", async () => {
  const { raceId: raceA } = await makeRace({ gameDays: [1] });
  const { raceId: raceB } = await makeRace({ gameDays: [5] });
  await insertEntry({ raceId: raceA, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true, autoFilledSource: "late_fill" });
  await insertEntry({ raceId: raceB, teamId: TEAM, riderId: RIDER_Y, isAutoFilled: false });
  await callBulk({
    teamId: TEAM,
    changes: [
      { race_id: raceA, rider_ids: [RIDER_Y], roles: ["captain"] },
      { race_id: raceB, rider_ids: [RIDER_X], roles: ["captain"] },
    ],
  });
  const [a] = await overridesFor(raceA, TEAM);
  const [b] = await overridesFor(raceB, TEAM);
  assert.equal(a.had_auto_filled, true);
  assert.equal(a.auto_source, "late_fill");
  assert.equal(b.had_auto_filled, false);
  assert.equal(b.auto_source, null);
});

test("(b)(d) bulk: auto-raekker uden kilde → 'unknown'", async () => {
  const { raceId } = await makeRace({ gameDays: [1] });
  await insertEntry({ raceId, teamId: TEAM, riderId: RIDER_X, isAutoFilled: true });
  await callBulk({ teamId: TEAM, changes: [{ race_id: raceId, rider_ids: [RIDER_Y], roles: ["captain"] }] });
  const [o] = await overridesFor(raceId, TEAM);
  assert.equal(o.auto_source, "unknown");
});

test("(b) bulk: et afvist kald (frosset loeb) efterlader hverken entries eller override-raekker", async () => {
  const { raceId: open } = await makeRace({ gameDays: [1] });
  const { raceId: frozen } = await makeRace({ stagesCompleted: 1, gameDays: [5] });
  await assert.rejects(
    () => callBulk({
      teamId: TEAM,
      changes: [
        { race_id: open, rider_ids: [RIDER_X], roles: ["captain"] },
        { race_id: frozen, rider_ids: [RIDER_Y], roles: ["captain"] },
      ],
    }),
    /selection_race_started/,
  );
  assert.equal((await overridesFor(open, TEAM)).length, 0, "hele transaktionen rulles tilbage");
  assert.equal((await entriesFor(open, TEAM)).length, 0);
});

test("(b) bulk: kerneadfaerden er uaendret — en swap mellem to overlappende loeb lykkes i EET kald", async () => {
  const { raceId: raceA, seasonId } = await makeRace({ gameDays: [1, 2] });
  const { raceId: raceB } = await makeRace({ seasonId, gameDays: [2, 3] });
  await callBulk({ teamId: TEAM, changes: [{ race_id: raceA, rider_ids: [RIDER_X], roles: ["captain"] }] });
  await callBulk({
    teamId: TEAM,
    changes: [
      { race_id: raceB, rider_ids: [RIDER_X], roles: ["captain"] },
      { race_id: raceA, rider_ids: [], roles: [] },
    ],
  });
  assert.equal((await entriesFor(raceB, TEAM)).length, 1);
  assert.equal((await entriesFor(raceA, TEAM)).length, 0);
});

// ── (c) apply_race_entry_unit_batch: generatorens kilde pr. ny raekke ────────────────

test("(c) batch-RPC: auto_filled_source fra payloaden skrives paa raekken (ai_generator)", async () => {
  const { raceId } = await makeRace({ gameDays: [1] });
  const res = await callBatch({
    teamId: TEAM,
    units: [{ race_id: raceId, inserts: [{ rider_id: RIDER_X, race_role: "captain", auto_filled_source: "ai_generator" }] }],
  });
  assert.equal(res.inserted, 1);
  const [row] = await entriesFor(raceId, TEAM);
  assert.equal(row.is_auto_filled, true);
  assert.equal(row.auto_filled_source, "ai_generator");
  assert.ok(row.auto_filled_at);
});

test("(a) batch-RPC: en payload UDEN noeglen (aeldre backend) virker og giver NULL-kilde", async () => {
  const { raceId } = await makeRace({ gameDays: [1] });
  const res = await callBatch({ teamId: TEAM, units: [{ race_id: raceId, inserts: [{ rider_id: RIDER_X, race_role: "captain" }] }] });
  assert.equal(res.inserted, 1);
  const [row] = await entriesFor(raceId, TEAM);
  assert.equal(row.auto_filled_source, null);
  assert.ok(row.auto_filled_at);
});
