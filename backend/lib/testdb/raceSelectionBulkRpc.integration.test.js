// Integrationstest for replace_race_selection_bulk (#1146) mod en ÆGTE Postgres-motor via
// PGlite (in-memory, ingen Docker, ingen cost) — samme mønster som
// raceResultsEntrantUnique.integration.test.js.
//
// #4310-refutation (adversarisk gennemgang af PR #4316) fandt tre huller; DENNE fil
// verificerer de to SQL-niveau-fund direkte mod den ÆGTE, committede RPC-fil (ikke en
// re-typet kopi) + dens forudsætninger fra 2026-08-24-4173:
//   FUND 1 — forward-guard: et løb hvis felt er LÅST (stages_completed>0) eller hvis
//     status ikke er 'scheduled' må kun modtage en RENT FJERNENDE ændring. Beviser at
//     guarden både AFVISER en tilføjelse til et frosset løb OG TILLADER en ren fjernelse.
//   FUND 2 — race_entry_days-oprydning: verificerer at der IKKE efterlades forældreløse
//     race_entry_days-rækker når et løbs ønskeliste bliver tom i et bulk-kald (uanset om
//     det er via race_entry_days_entry_fkey's ON DELETE CASCADE eller det eksplicitte
//     rebuild-kald i RPC'en — testen beviser SLUTRESULTATET, ikke mekanismen).
//
// Beviser desuden selve "swap er rækkefølge-uafhængig"-kernepåstanden (samme pointe som
// classifyBulkSelectionConflicts-testene i raceSelection.test.js, men her på SQL-niveau):
// en rytter flyttet fra løb A til løb B i ÉT bulk-kald lykkes uanset hvilken rækkefølge
// p_changes leverer de to løb i.
//
// riders/teams-DDL'en er UDELADT (race_entries.rider_id/team_id er blotte UUID-kolonner,
// ingen FK) — irrelevant for det vi tester her, samme forenkling som
// raceResultsEntrantUnique.integration.test.js's minimale BASE_DDL. races/race_entries/
// race_stage_schedule/race_withdrawals-DDL'en er også hånd-skrevet minimalt (kun de
// kolonner denne RPC + dens 4173-forudsætninger rører), men race_entry_days-tabellen,
// dens rebuild-funktion, dens trigger, og selve replace_race_selection_bulk-funktionen er
// de ÆGTE, committede filer (database/2026-08-24-4173-...sql + database/2026-08-27-1146-
// ...sql), saneret af sanitizeForPglite — IKKE en re-typet kopi.

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
  // #4173: race_entry_days-tabellen, race_entry_days_rebuild, trg_race_entries_sync_days,
  // no_rider_double_booking_day-constrainten. IKKE 3420 (kræver btree_gist, ikke
  // tilgængeligt i PGlite) — irrelevant her, 4173 dropper 3420's EXCLUDE-constraint
  // betingelsesløst ("if exists") og genskaber intet der afhænger af den.
  await db.exec(loadMigration("2026-08-24-4173-rider-binding-per-game-day.sql"));
  // #1146: selve den RPC vi tester — den ÆGTE fil, ikke en kopi.
  await db.exec(loadMigration("2026-08-27-1146-selection-bulk-rpc.sql"));
});
after(async () => {
  if (db) await db.close();
});
beforeEach(async () => {
  await db.exec("TRUNCATE race_entries, race_entry_days, race_stage_schedule, race_withdrawals, races CASCADE");
});

async function makeRace({ status = "scheduled", stagesCompleted = 0, gameDays = [1, 2, 3] } = {}) {
  const { rows } = await db.query(
    "INSERT INTO races (status, stages_completed) VALUES ($1, $2) RETURNING id, season_id",
    [status, stagesCompleted],
  );
  const { id: raceId, season_id: seasonId } = rows[0];
  for (const gd of gameDays) {
    await db.query("INSERT INTO race_stage_schedule (race_id, game_day) VALUES ($1, $2)", [raceId, gd]);
  }
  return { raceId, seasonId };
}

async function callBulk({ teamId, changes, autoReleases = [] }) {
  return db.query(
    "SELECT replace_race_selection_bulk($1::uuid, $2::jsonb, $3::jsonb)",
    [teamId, JSON.stringify(changes), JSON.stringify(autoReleases)],
  );
}

async function entryDaysFor(raceId, teamId) {
  const { rows } = await db.query(
    "SELECT rider_id, game_day FROM race_entry_days WHERE race_id = $1 AND team_id = $2 ORDER BY rider_id, game_day",
    [raceId, teamId],
  );
  return rows;
}

// ── migrationen loader + funktionen findes ──────────────────────────────────────────

test("migrationen loader fejlfrit og replace_race_selection_bulk findes", async () => {
  const { rows } = await db.query(`SELECT proname FROM pg_proc WHERE proname = 'replace_race_selection_bulk'`);
  assert.equal(rows.length, 1);
});

// ── FUND 1: forward-guard (frosset/afsluttet løb) ───────────────────────────────────

test("FUND 1: afviser en TILFØJELSE til et løb med stages_completed>0 (selection_race_started)", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const { raceId } = await makeRace({ stagesCompleted: 1 });
  await assert.rejects(
    () => callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX], roles: ["captain"] }] }),
    /selection_race_started/,
  );
  // Ingen skrivning må have fundet sted (hele batchen ruller tilbage).
  const { rows } = await db.query("SELECT count(*)::int AS n FROM race_entries WHERE race_id = $1", [raceId]);
  assert.equal(rows[0].n, 0);
});

test("FUND 1: afviser UBETINGET når løbets status ikke er 'scheduled' (fx 'completed'), selv med stages_completed=0 (selection_race_not_open)", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const { raceId } = await makeRace({ status: "completed", stagesCompleted: 0 });
  await assert.rejects(
    () => callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX], roles: ["captain"] }] }),
    /selection_race_not_open/,
  );
});

test("FUND 1: afviser også en REN FJERNELSE mod et 'completed'-løb (ingen removal-undtagelse for ikke-åbne løb, #2074)", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const riderY = "33333333-3333-3333-3333-333333333333";
  // Byg feltet mens løbet er åbent, afslut det derefter (finalisering).
  const { raceId } = await makeRace({ stagesCompleted: 0 });
  await callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX, riderY], roles: ["captain", "helper"] }] });
  await db.query("UPDATE races SET status = 'completed' WHERE id = $1", [raceId]);
  // Ren fjernelse er tilladt for et frosset-men-åbent løb; for et afsluttet løb er der
  // intet aktivt felt at redigere (raceActiveGuard.js:55-56, #2074).
  await assert.rejects(
    () => callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX], roles: ["captain"] }] }),
    /selection_race_not_open/,
  );
  const { rows } = await db.query("SELECT count(*)::int AS n FROM race_entries WHERE race_id = $1", [raceId]);
  assert.equal(rows[0].n, 2);
});

test("FUND 1: TILLADER en REN FJERNELSE fra et frosset løb (v_rider_ids ⊆ eksisterende entries)", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const riderY = "33333333-3333-3333-3333-333333333333";
  // Byg feltet FØR løbet fryses (stages_completed=0, normalt kald).
  const { raceId } = await makeRace({ stagesCompleted: 0 });
  await callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX, riderY], roles: ["captain", "helper"] }] });
  // Frys løbet (simulerer at etape 1 er kørt imellem de to bulk-kald).
  await db.query("UPDATE races SET stages_completed = 1 WHERE id = $1", [raceId]);
  // Fjern riderY (skadet) — en RENT fjernende ændring, skal TILLADES selv om løbet er låst.
  await callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX], roles: ["captain"] }] });
  const { rows } = await db.query("SELECT rider_id FROM race_entries WHERE race_id = $1", [raceId]);
  assert.deepEqual(rows.map((r) => r.rider_id), [riderX]);
});

test("FUND 1: afviser en TILFØJELSE til et frosset løb selv når nogle ryttere beholdes (blandet tilføjelse+beholdelse er IKKE en ren fjernelse)", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const riderNew = "44444444-4444-4444-4444-444444444444";
  const { raceId } = await makeRace({ stagesCompleted: 0 });
  await callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX], roles: ["captain"] }] });
  await db.query("UPDATE races SET stages_completed = 1 WHERE id = $1", [raceId]);
  await assert.rejects(
    () => callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX, riderNew], roles: ["captain", "helper"] }] }),
    /selection_race_started/,
  );
});

// ── FUND 4: `<@` alene tillod en ROLLEÆNDRING i et frosset løb ──────────────────────

test("FUND 4: afviser en ren ROLLEÆNDRING (uændret ryttersæt) mod et frosset løb — `<@` alene er inklusiv", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const riderY = "33333333-3333-3333-3333-333333333333";
  const { raceId } = await makeRace({ stagesCompleted: 0 });
  await callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX, riderY], roles: ["captain", "helper"] }] });
  await db.query("UPDATE races SET stages_completed = 1 WHERE id = $1", [raceId]);

  // SAMME ryttere, byttede roller. Er en delmængde af sig selv, så den gamle guard
  // (`v_rider_ids <@ v_current_rider_ids`) slap den igennem — og linje-181-delete'en
  // genindsatte derefter feltet med de nye roller, dvs. et kaptajnsskifte midt i et løb.
  await assert.rejects(
    () => callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX, riderY], roles: ["helper", "captain"] }] }),
    /selection_race_started/,
  );

  // Rollerne skal være uændrede — intet delvist skriv.
  const { rows } = await db.query(
    "SELECT rider_id, race_role FROM race_entries WHERE race_id = $1 ORDER BY rider_id",
    [raceId],
  );
  assert.deepEqual(rows, [
    { rider_id: riderX, race_role: "captain" },
    { rider_id: riderY, race_role: "helper" },
  ]);
});

// ── FUND 3: frigivelser havde ingen forward-guard overhovedet ───────────────────────

test("FUND 3: afviser en #2637-frigivelse mod et løb der er STARTET (selection_rider_bound) — guarden lå kun i p_changes-løkken", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const { raceId: releasedRace } = await makeRace({ gameDays: [5, 6] });
  const { raceId: otherRace } = await makeRace({ gameDays: [10] });

  // riderX er auto-udtaget i releasedRace (uden for batchen), som app-laget klassificerede
  // som `resolvable` mens det stadig var ikke-startet.
  await db.query(
    "INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled) VALUES ($1, $2, $3, 'helper', true)",
    [releasedRace, riderX, teamId],
  );
  // TOCTOU: løbet starter MELLEM klassifikationen og denne transaktion.
  await db.query("UPDATE races SET stages_completed = 1 WHERE id = $1", [releasedRace]);

  await assert.rejects(
    () => callBulk({
      teamId,
      changes: [{ race_id: otherRace, rider_ids: [riderX], roles: ["captain"] }],
      autoReleases: [{ race_id: releasedRace, rider_id: riderX }],
    }),
    /selection_rider_bound/,
  );

  // Den låste lineup skal være urørt, og HELE batchen rullet tilbage.
  const { rows: kept } = await db.query(
    "SELECT count(*)::int AS n FROM race_entries WHERE race_id = $1 AND rider_id = $2",
    [releasedRace, riderX],
  );
  assert.equal(kept[0].n, 1, "den frigivne rytter må ikke være fjernet fra det startede løb");
  const { rows: other } = await db.query("SELECT count(*)::int AS n FROM race_entries WHERE race_id = $1", [otherRace]);
  assert.equal(other[0].n, 0, "batchens øvrige ændring skal være rullet tilbage");
});

test("FUND 3: TILLADER stadig en frigivelse mod et IKKE-startet løb (stages_completed=0)", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const { raceId: releasedRace } = await makeRace({ gameDays: [5, 6] });
  const { raceId: otherRace } = await makeRace({ gameDays: [10] });
  await db.query(
    "INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled) VALUES ($1, $2, $3, 'helper', true)",
    [releasedRace, riderX, teamId],
  );

  await callBulk({
    teamId,
    changes: [{ race_id: otherRace, rider_ids: [riderX], roles: ["captain"] }],
    autoReleases: [{ race_id: releasedRace, rider_id: riderX }],
  });

  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM race_entries WHERE race_id = $1 AND rider_id = $2",
    [releasedRace, riderX],
  );
  assert.equal(rows[0].n, 0, "frigivelsen skal stadig virke for et ikke-startet løb");
});

// ── FUND 2: race_entry_days-oprydning (ingen forældreløse rækker) ───────────────────

test("FUND 2: et løbs entries tømmes (v_len=0) i et bulk-kald — INGEN forældreløse race_entry_days-rækker bagefter", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const { raceId } = await makeRace({ gameDays: [1, 2, 3] });
  await callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [riderX], roles: ["captain"] }] });
  assert.equal((await entryDaysFor(raceId, teamId)).length, 3, "forudsætning: 3 dag-rækker oprettet");

  // Tøm løbets ønskeliste (v_len=0) i ÉT bulk-kald — den gren der IKKE fyrer
  // trg_race_entries_sync_days (ingen insert).
  await callBulk({ teamId, changes: [{ race_id: raceId, rider_ids: [], roles: [] }] });

  assert.equal((await entryDaysFor(raceId, teamId)).length, 0, "race_entry_days skal være HELT ryddet, ingen forældreløse rækker");
  const { rows } = await db.query("SELECT count(*)::int AS n FROM race_entries WHERE race_id = $1", [raceId]);
  assert.equal(rows[0].n, 0);
});

test("FUND 2: #2637 auto-release (p_auto_releases) tømmer IKKE en forældreløs race_entry_days-række for den frigivne rytter", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  const { raceId: releasedRace } = await makeRace({ gameDays: [5, 6] });
  const { raceId: otherRace } = await makeRace({ gameDays: [10] }); // urelateret løb, skal være urørt

  // riderX er auto-udtaget i releasedRace (uden for denne batch).
  await db.query(
    "INSERT INTO race_entries (race_id, rider_id, team_id, race_role, is_auto_filled) VALUES ($1, $2, $3, 'helper', true)",
    [releasedRace, riderX, teamId],
  );
  // Trigger-baseret opbygning sker kun ved INSERT/UPDATE af race_id/team_id — kør et
  // manuelt rebuild for at simulere at raden allerede var korrekt vedligeholdt (samme
  // tilstand som trg_race_entries_sync_days ville have produceret).
  await db.query("SELECT race_entry_days_rebuild($1, $2)", [releasedRace, teamId]);
  assert.equal((await entryDaysFor(releasedRace, teamId)).length, 2, "forudsætning: 2 dag-rækker for det auto-udtagne løb");

  // Frigiv riderX fra releasedRace (samme transaktion som en anden batch-ændring et
  // helt andet sted) via p_auto_releases.
  await callBulk({
    teamId,
    changes: [{ race_id: otherRace, rider_ids: [riderX], roles: ["captain"] }],
    autoReleases: [{ race_id: releasedRace, rider_id: riderX }],
  });

  assert.equal((await entryDaysFor(releasedRace, teamId)).length, 0, "det frigivne løbs dag-rækker for riderX skal være ryddet, ingen forældreløse");
  assert.equal((await entryDaysFor(otherRace, teamId)).length, 1, "det NYE løb skal have fået sin dag-række");
});

// ── Kerne-påstand: swap mellem to løb i SAMME bulk-kald er rækkefølge-uafhængig ─────

test("swap: rytter flyttet fra løb A til løb B i SAMME bulk-kald lykkes UANSET rækkefølge i p_changes", async () => {
  const teamId = "11111111-1111-1111-1111-111111111111";
  const riderX = "22222222-2222-2222-2222-222222222222";
  // Samme sæson (season_id) og overlappende game_day-vinduer, ellers binder de ikke
  // hinanden i første omgang (no_rider_double_booking_day er sæson+dag-scoped).
  const { raceId: raceA, seasonId } = await makeRace({ gameDays: [1, 2] });
  const raceBRes = await db.query(
    "INSERT INTO races (status, stages_completed, season_id) VALUES ('scheduled', 0, $1) RETURNING id",
    [seasonId],
  );
  const raceB = raceBRes.rows[0].id;
  await db.query("INSERT INTO race_stage_schedule (race_id, game_day) VALUES ($1, 1), ($1, 2)", [raceB]);

  // riderX starter i raceA.
  await callBulk({ teamId, changes: [{ race_id: raceA, rider_ids: [riderX], roles: ["captain"] }] });

  // Swap: A mister riderX, B får riderX — test BEGGE rækkefølger af p_changes.
  await callBulk({
    teamId,
    changes: [
      { race_id: raceA, rider_ids: [], roles: [] },
      { race_id: raceB, rider_ids: [riderX], roles: ["captain"] },
    ],
  });
  assert.deepEqual((await db.query("SELECT rider_id FROM race_entries WHERE race_id = $1", [raceA])).rows, []);
  assert.equal((await db.query("SELECT rider_id FROM race_entries WHERE race_id = $1", [raceB])).rows.length, 1);

  // Swap tilbage, men med p_changes i den MODSATTE rækkefølge (B FØR A) — skal give
  // samme resultat, ikke en falsk no_rider_double_booking_day-fejl.
  await callBulk({
    teamId,
    changes: [
      { race_id: raceB, rider_ids: [], roles: [] },
      { race_id: raceA, rider_ids: [riderX], roles: ["captain"] },
    ],
  });
  assert.equal((await db.query("SELECT rider_id FROM race_entries WHERE race_id = $1", [raceA])).rows.length, 1);
  assert.deepEqual((await db.query("SELECT rider_id FROM race_entries WHERE race_id = $1", [raceB])).rows, []);
});
