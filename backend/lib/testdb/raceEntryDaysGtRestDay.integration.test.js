// #4209 — en Grand Tour-rytter er bundet til GT'en OGSÅ på GT'ens hviledage.
//
// EJER-BESLUTNING 3/9 (#4209, L = A): "det er race_entry_days_rebuild()/bindingen der
// skal binde rytteren over GT'ens hviledage (en hviledag ER en løbsdag GT'en optager,
// CALENDAR_RULES §3)." Skal være live før S4-cutover 28/9.
//
// HVAD DENNE FIL BEVISER — og hvorfor den ikke ændrer funktionen.
// Reglen er allerede håndhævet i prod: #4217 gjorde 25/8 ønske-mængden i
// race_entry_days_rebuild til HELE spændet min(game_day)..max(game_day) via
// generate_series, og det spænd indeholder GT'ens hviledage. Målt read-only mod prod
// 4/9: race_entry_days har præcis 19 dag-rækker pr. rytter i Tour de l'Hexagone
// (17 etaper + 2 hviledage), heraf 57 × 2 rækker på selve hviledagene.
//
// Det der MANGLEDE var beviset og vagten. Bindingen kunne stilfærdigt falde tilbage til
// #4173's "kun de kørte etapedage" uden at nogen test blev rød — præcis dén regression
// #4217 selv findes for at rette, og præcis dén drift-klasse
// .claude/learnings/2026-08-27-guard-og-haandhaevelse-skal-dele-maengde-semantik.md
// beskriver. Testene her er derfor en FORWARD-GUARD på en regel der allerede gælder,
// ikke en ny adfærd.
//
// Kørt mod en ÆGTE Postgres-motor via PGlite (in-memory, ingen Docker, ingen cost) og
// mod de ÆGTE, committede migrations-filer i prod's apply-rækkefølge — ikke re-typede
// kopier. Samme mønster som raceSelectionBulkRpc.integration.test.js.
//
// riders/teams-DDL'en er UDELADT (race_entries.rider_id/team_id er blotte UUID-kolonner,
// ingen FK). races/race_stage_schedule/race_withdrawals/race_entries er hånd-skrevet
// minimalt — kun de kolonner rebuild-funktionen og dens fire porte rører.
//
// Refs #4209 #4203 #4217 #4191 #4173 #4283 #3470

import test, { before, after, beforeEach } from "node:test";
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
  race_class TEXT,
  league_division_id INTEGER,
  season_id UUID NOT NULL
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
  return sanitizeForPglite(readFileSync(join(DATABASE_DIR, filename), "utf8"));
}

const SEASON = "aaaaaaaa-0000-0000-0000-000000000001";
const TEAM = "11111111-1111-1111-1111-111111111111";
const RIDER = "22222222-2222-2222-2222-222222222222";
const RIDER_B = "33333333-3333-3333-3333-333333333333";

// GT-formen fra docs/CALENDAR_RULES.md §3: præcis 2 hviledage (GRAND_TOUR_REST_DAYS),
// placeret efter etape 9 og 15 (GT_REST_DAY_PATTERN). 17 etaper → spænd 0..18 (19
// løbsdage), hviledage på løbsdag 9 og 16. Samme form som prod's Tour de l'Hexagone
// og Vuelta Ibérica (målt 4/9: 17 etaper, game_day-spænd på 19).
const GT_REST_DAYS = [9, 16];
const GT_STAGE_DAYS = Array.from({ length: 19 }, (_, i) => i).filter((d) => !GT_REST_DAYS.includes(d));

let db;
before(async () => {
  db = new PGlite();
  await db.exec(BASE_DDL);
  // Prod's apply-rækkefølge. IKKE 3420 (kræver btree_gist, ikke tilgængeligt i PGlite)
  // — irrelevant her, 4173 dropper 3420's EXCLUDE-constraint betingelsesløst.
  //   4173 — tabellen, no_rider_double_booking_day, triggerne, første rebuild-krop
  //   4191 — rebuild bliver en diff (want/gone/insert) i stedet for riv-ned-byg-op
  //   4217 — ønske-mængden bliver HELE spændet (denne fils emne)
  await db.exec(loadMigration("2026-08-24-4173-rider-binding-per-game-day.sql"));
  await db.exec(loadMigration("2026-08-24-4191-race-entry-days-diff-rebuild.sql"));
  await db.exec(loadMigration("2026-08-25-4217-spaend-binding.sql"));
});
after(async () => {
  if (db) await db.close();
});
beforeEach(async () => {
  await db.exec("TRUNCATE race_entries, race_entry_days, race_stage_schedule, race_withdrawals, races CASCADE");
});

async function makeRace({ raceClass = null, gameDays, status = "scheduled" }) {
  const { rows } = await db.query(
    "INSERT INTO races (status, race_class, season_id) VALUES ($1, $2, $3) RETURNING id",
    [status, raceClass, SEASON],
  );
  const raceId = rows[0].id;
  for (const gd of gameDays) {
    await db.query("INSERT INTO race_stage_schedule (race_id, game_day) VALUES ($1, $2)", [raceId, gd]);
  }
  return raceId;
}

async function enter(raceId, riderId = RIDER, teamId = TEAM) {
  // trg_race_entries_sync_days (#4173) kalder race_entry_days_rebuild i AFTER INSERT,
  // så dag-rækkerne skrives af selve udtagelsen — ingen manuelt rebuild-kald her.
  await db.query("INSERT INTO race_entries (race_id, rider_id, team_id) VALUES ($1, $2, $3)", [raceId, riderId, teamId]);
}

async function boundDays(raceId, riderId = RIDER) {
  const { rows } = await db.query(
    "SELECT game_day FROM race_entry_days WHERE race_id = $1 AND rider_id = $2 ORDER BY game_day",
    [raceId, riderId],
  );
  return rows.map((r) => r.game_day);
}

// ── Forudsætning ────────────────────────────────────────────────────────────────────

test("den GÆLDENDE race_entry_days_rebuild er #4217's spænd-krop (generate_series), ikke #4173's etapedage", async () => {
  const { rows } = await db.query(
    `SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p WHERE p.proname = 'race_entry_days_rebuild'`,
  );
  assert.equal(rows.length, 1);
  assert.match(rows[0].def, /generate_series/, "rebuild skal bygge ønske-mængden over HELE spændet (#4217)");
});

// ── #4209: GT-hviledagen binder ─────────────────────────────────────────────────────

test("#4209: GT-rytteren har dag-rækker på HELE spændet, hviledagene inkluderet", async () => {
  const gt = await makeRace({ raceClass: "GiroVuelta", gameDays: GT_STAGE_DAYS });
  await enter(gt);

  const days = await boundDays(gt);
  assert.deepEqual(days, Array.from({ length: 19 }, (_, i) => i),
    "17 etaper + 2 hviledage = 19 sammenhængende løbsdage (CALENDAR_RULES §3: etaper + 2)");
  for (const rest of GT_REST_DAYS) {
    assert.ok(days.includes(rest), `hviledag ${rest} skal være bundet — den ER en løbsdag GT'en optager`);
  }
});

test("#4209: et andet løb på GT'ens HVILEDAG afvises for den samme rytter (no_rider_double_booking_day)", async () => {
  const gt = await makeRace({ raceClass: "GiroVuelta", gameDays: GT_STAGE_DAYS });
  await enter(gt);

  // Endagsløb præcis i hviledags-slottet — dét #4203/PR #4208 flyttede Monumenterne ud af.
  const fyldloeb = await makeRace({ raceClass: "Classic", gameDays: [GT_REST_DAYS[0]] });
  await assert.rejects(() => enter(fyldloeb), /no_rider_double_booking_day/,
    "GT-rytteren må ikke kunne forlade GT'en på hviledagen for at køre et andet løb");

  // Rod-årsagen skal være hviledagen, ikke løbet i sig selv: en ANDEN rytter er fri.
  await enter(fyldloeb, RIDER_B);
  assert.deepEqual(await boundDays(fyldloeb, RIDER_B), [GT_REST_DAYS[0]]);
});

test("#4209: også den ANDEN hviledag binder (ikke kun den første)", async () => {
  const gt = await makeRace({ raceClass: "TourFrance", gameDays: GT_STAGE_DAYS });
  await enter(gt);
  const fyldloeb = await makeRace({ raceClass: "Classic", gameDays: [GT_REST_DAYS[1]] });
  await assert.rejects(() => enter(fyldloeb), /no_rider_double_booking_day/);
});

test("#4209: et etapeløb der OVERLAPPER GT'ens hviledag afvises, selv om det ikke selv kører den dag", async () => {
  const gt = await makeRace({ raceClass: "GiroVuelta", gameDays: GT_STAGE_DAYS });
  await enter(gt);
  // Kører på 8 og 10, springer 9 over — men spændet 8..10 optager hviledag 9.
  const etapeloeb = await makeRace({ raceClass: "Stage", gameDays: [8, 10] });
  await assert.rejects(() => enter(etapeloeb), /no_rider_double_booking_day/);
});

// ── Ikke-GT-løb er uændrede ─────────────────────────────────────────────────────────

test("ikke-GT: endagsløb binder præcis sin ene løbsdag — uændret", async () => {
  const klassiker = await makeRace({ raceClass: "Classic", gameDays: [30] });
  await enter(klassiker);
  assert.deepEqual(await boundDays(klassiker), [30]);
});

test("ikke-GT: en rytter kan køre to endagsløb på FORSKELLIGE løbsdage — uændret", async () => {
  const a = await makeRace({ raceClass: "Classic", gameDays: [30] });
  const b = await makeRace({ raceClass: "Classic", gameDays: [31] });
  await enter(a);
  await enter(b);
  assert.deepEqual(await boundDays(a), [30]);
  assert.deepEqual(await boundDays(b), [31]);
});

test("ikke-GT: sammenhængende etapeløb binder sine egne dage — uændret", async () => {
  const etapeloeb = await makeRace({ raceClass: "Stage", gameDays: [40, 41, 42] });
  await enter(etapeloeb);
  assert.deepEqual(await boundDays(etapeloeb), [40, 41, 42]);
});

// #4217 er en regel om SPÆND, ikke om GT'er. Springene i et ikke-GT-etapeløb er ikke
// hviledage (CALENDAR_RULES §2b: en løbsdag er et halvdags-slot, og slot-tælleren løber
// videre for de øvrige løb i puljen), men de bindes af samme grund: en rytter må ikke
// forlade et etapeløb midt i. Denne test låser at #4209 IKKE gjorde reglen GT-specifik.
test("ikke-GT: etapeløb med spring binder også springet — #4217's spænd er ikke GT-specifikt", async () => {
  const dueMari = await makeRace({ raceClass: "Stage", gameDays: [50, 53, 57] });
  await enter(dueMari);
  assert.deepEqual(await boundDays(dueMari), [50, 51, 52, 53, 54, 55, 56, 57]);
});

// ── De fire porte er uberørte af #4209 ──────────────────────────────────────────────

test("porte: et afmeldt hold bindes ikke af GT'en — heller ikke på hviledagen", async () => {
  const gt = await makeRace({ raceClass: "GiroVuelta", gameDays: GT_STAGE_DAYS });
  await enter(gt);
  await db.query("INSERT INTO race_withdrawals (race_id, team_id) VALUES ($1, $2)", [gt, TEAM]);
  await db.query("SELECT race_entry_days_rebuild($1::uuid, $2::uuid)", [gt, TEAM]);
  assert.deepEqual(await boundDays(gt), []);

  // Og så er hviledagen fri igen (Rod A, #1823).
  const fyldloeb = await makeRace({ raceClass: "Classic", gameDays: [GT_REST_DAYS[0]] });
  await enter(fyldloeb);
  assert.deepEqual(await boundDays(fyldloeb), [GT_REST_DAYS[0]]);
});

test("porte: et færdigkørt løb binder intet — heller ikke sit spænd", async () => {
  const gt = await makeRace({ raceClass: "GiroVuelta", gameDays: GT_STAGE_DAYS });
  await enter(gt);
  await db.query("UPDATE races SET status = 'completed' WHERE id = $1", [gt]);
  await db.query("SELECT race_entry_days_rebuild($1::uuid, $2::uuid)", [gt, TEAM]);
  assert.deepEqual(await boundDays(gt), []);
});

test("porte: delvist backfillet schedule (en game_day er NULL) binder intet", async () => {
  const gt = await makeRace({ raceClass: "GiroVuelta", gameDays: GT_STAGE_DAYS });
  await db.query("INSERT INTO race_stage_schedule (race_id, game_day) VALUES ($1, NULL)", [gt]);
  await enter(gt);
  assert.deepEqual(await boundDays(gt), []);
});

// ── Idempotens (#4191's diff-kontrakt overlever spændet) ────────────────────────────

test("idempotent: to rebuilds i træk uden udtagelses-ændring giver samme mængde", async () => {
  const gt = await makeRace({ raceClass: "GiroVuelta", gameDays: GT_STAGE_DAYS });
  await enter(gt);
  const foer = await boundDays(gt);
  await db.query("SELECT race_entry_days_rebuild($1::uuid, $2::uuid)", [gt, TEAM]);
  assert.deepEqual(await boundDays(gt), foer);
});
