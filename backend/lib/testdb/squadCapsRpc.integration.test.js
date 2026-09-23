// #5432 · Loft pr. trup i akademi-RPC'erne, kørt mod en ÆGTE Postgres-motor (PGlite,
// in-memory, ingen Docker) — samme mønster som raceSelectionBulkRpc.integration.test.js.
//
// Hvad filen beviser, mod de ÆGTE committede migrationsfiler (ikke re-typede kopier):
//   1. Apply-rækkefølgen som i prod: de gamle funktionskroppe (06-25 demote, 08-31
//      finalize) loades FØRST, derefter #4619 (riders.squad) og til sidst #5432. Efter
//      #5432 findes der præcis ÉN overload af hver funktion — den gamle signatur med
//      den flade cap er væk, ikke efterladt ved siden af.
//   2. Tællingen sker pr. MÅL-trup: en fuld U23-trup blokerer ikke en junior-optagelse
//      og omvendt — for alle tre stier (nedrykning, ungdomsauktion, intake).
//   3. Loftet og aldersloftet kommer fra kalderen (squads.js), ikke fra SQL: et andet
//      loft i argumentet giver en anden grænse.
//   4. Atomicitet: squad skrives i SAMME transaktion som is_academy. En afvisning
//      skriver intet, og en dublet-idempotency_key (23505) ruller hele optagelsen
//      tilbage — også trup-feltet.
//   5. Overgangsperioden før #4619-backfill'en: en akademirytter med squad='senior'
//      tæller i begge ungdomstrupper, så gaten aldrig bliver mildere end loftet.
//
// Advisory-låsen (pg_advisory_xact_lock) kan ikke bevises med én PGlite-forbindelse;
// den er uændret fra de tidligere versioner og deles af alle tre RPC'er.

import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { sanitizeForPglite } from "./sanitizeForPglite.js";
import { SQUAD_CAPS, SQUAD_MAX_AGE, squadCapRpcArgs } from "../squads.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_DIR = join(__dirname, "..", "..", "..", "database");

// Kun de kolonner RPC'erne læser/skriver. riders.squad kommer fra den ÆGTE #4619-fil.
const BASE_DDL = `
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  balance BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id),
  is_academy BOOLEAN NOT NULL DEFAULT false,
  birthdate DATE,
  salary BIGINT,
  contract_length INTEGER,
  contract_end_season INTEGER,
  acquired_at TIMESTAMPTZ,
  pending_team_id UUID
);
CREATE TABLE academy_graduation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID,
  team_id UUID,
  status TEXT
);
CREATE TABLE auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID,
  status TEXT NOT NULL
);
CREATE TABLE transfer_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID,
  status TEXT NOT NULL
);
CREATE TABLE races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_type TEXT NOT NULL DEFAULT 'stage_race',
  status TEXT NOT NULL DEFAULT 'scheduled',
  stages_completed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE race_entries (
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL,
  team_id UUID,
  PRIMARY KEY (race_id, rider_id)
);
CREATE TABLE finance_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL,
  type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  description TEXT,
  season_id UUID,
  race_id UUID,
  related_loan_id UUID,
  actor_type TEXT,
  actor_id UUID,
  source_path TEXT,
  reason_code TEXT,
  before_balance BIGINT,
  after_balance BIGINT,
  related_entity_type TEXT,
  related_entity_id UUID,
  idempotency_key TEXT UNIQUE
);
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL
);
`;

// Prod-rækkefølge: gamle kroppe → riders.squad → #5432.
const MIGRATIONS = [
  "2026-06-25-academy-promote-demote.sql",
  "2026-08-31-4423-academy-signing-defer.sql",
  "2026-09-15-4619-riders-squad.sql",
  "2026-09-24-5432-squad-caps-rpc.sql",
];

function loadMigration(filename) {
  return sanitizeForPglite(readFileSync(join(DATABASE_DIR, filename), "utf8"));
}

let db;
before(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;");
  await db.exec(BASE_DDL);
  for (const file of MIGRATIONS) {
    try {
      await db.exec(loadMigration(file));
    } catch (err) {
      throw new Error(`load af '${file}' fejlede i PGlite: ${err.message}`, { cause: err });
    }
  }
});
after(async () => {
  if (db) await db.close();
});
beforeEach(async () => {
  await db.exec(
    "TRUNCATE finance_transactions, race_entries, races, auctions, transfer_listings, academy_graduation, riders, teams CASCADE",
  );
});

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Sæson 1 = kalenderår 2026 (LAUNCH_REFERENCE_YEAR). Født 2006 → 20 (U23), født
// 2009 → 17 (junior), født 2000 → 26 (senior).
const SEASON_START_YEAR = 2026;
const BORN_U23 = "2006-05-01";
const BORN_JUNIOR = "2009-05-01";
const BORN_SENIOR = "2000-05-01";

async function makeTeam(balance = 1_000_000) {
  const { rows } = await db.query("INSERT INTO teams (balance) VALUES ($1) RETURNING id", [balance]);
  return rows[0].id;
}

async function makeRider({ teamId = null, isAcademy = false, squad = "senior", birthdate = BORN_U23, salary = 5000 } = {}) {
  const { rows } = await db.query(
    `INSERT INTO riders (team_id, is_academy, squad, birthdate, salary, contract_length, contract_end_season)
     VALUES ($1, $2, $3, $4, $5, 3, 3) RETURNING id`,
    [teamId, isAcademy, squad, birthdate, salary],
  );
  return rows[0].id;
}

async function fillSquad(teamId, squad, n) {
  for (let i = 0; i < n; i++) await makeRider({ teamId, isAcademy: true, squad });
}

async function riderRow(id) {
  const { rows } = await db.query(
    "SELECT team_id, is_academy, squad, salary, pending_academy_signing FROM riders WHERE id = $1",
    [id],
  );
  return rows[0];
}

async function demote(teamId, riderId, squad, { cap, maxAge } = {}) {
  const args = squadCapRpcArgs(squad);
  const { rows } = await db.query(
    `SELECT demote_rider_to_academy($1::uuid, $2::uuid, $3::bigint, $4::int, $5::int, $6::int, $7::text, $8::int, $9::int) AS r`,
    [teamId, riderId, 4000, 3, 3, SEASON_START_YEAR, args.p_squad, cap ?? args.p_squad_cap, maxAge ?? SQUAD_MAX_AGE[squad]],
  );
  return rows[0].r;
}

async function finalize(teamId, riderId, squad, { price = 0, cap, idempotencyKey = null } = {}) {
  const args = squadCapRpcArgs(squad);
  const payload = { type: "academy_signing", amount: -price, description: "test", idempotency_key: idempotencyKey };
  const { rows } = await db.query(
    `SELECT finalize_academy_acquisition($1::uuid, $2::uuid, $3::bigint, $4::bigint, $5::int, $6::int, $7::timestamptz, $8::jsonb, $9::text, $10::int) AS r`,
    [teamId, riderId, price, 1000, 3, 3, "2026-09-24T10:00:00Z", JSON.stringify(payload), args.p_squad, cap ?? args.p_squad_cap],
  );
  return rows[0].r;
}

async function move(teamId, riderId, squad, { cap } = {}) {
  const args = squadCapRpcArgs(squad);
  const { rows } = await db.query(
    "SELECT move_academy_rider_squad($1::uuid, $2::uuid, $3::text, $4::int) AS r",
    [teamId, riderId, args.p_squad, cap ?? args.p_squad_cap],
  );
  return rows[0].r;
}

// ── 1. Signaturer efter prod-apply-rækkefølgen ────────────────────────────────

test("apply-rækkefølge: præcis ÉN overload pr. funktion — den gamle flade-cap-signatur er droppet", async () => {
  const { rows } = await db.query(
    `SELECT proname, pronargs FROM pg_proc
     WHERE proname IN ('demote_rider_to_academy', 'finalize_academy_acquisition',
                       'move_academy_rider_squad', 'count_team_squad_members')
     ORDER BY proname`,
  );
  assert.deepEqual(rows, [
    { proname: "count_team_squad_members", pronargs: 3 },
    { proname: "demote_rider_to_academy", pronargs: 9 },
    { proname: "finalize_academy_acquisition", pronargs: 10 },
    { proname: "move_academy_rider_squad", pronargs: 4 },
  ]);
});

test("migrationen er idempotent: en anden kørsel er en no-op", async () => {
  await db.exec(loadMigration("2026-09-24-5432-squad-caps-rpc.sql"));
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('demote_rider_to_academy', 'finalize_academy_acquisition')",
  );
  assert.equal(rows[0].n, 2);
});

test("ingen tal i SQL: migrationen nævner hverken SQUAD_CAPS- eller SQUAD_MAX_AGE-værdierne som litteraler i en sammenligning", () => {
  const sql = readFileSync(join(DATABASE_DIR, "2026-09-24-5432-squad-caps-rpc.sql"), "utf8")
    .replace(/--[^\n]*/g, "");
  const literals = [...Object.values(SQUAD_CAPS), SQUAD_MAX_AGE.junior, SQUAD_MAX_AGE.u23];
  for (const n of literals) {
    assert.doesNotMatch(sql, new RegExp(`[<>=]\\s*${n}\\b`), `tallet ${n} må ikke stå som grænse i SQL`);
  }
});

// ── 2. Nedrykning (demote_rider_to_academy) ───────────────────────────────────

test("demote: fuld U23-trup afviser (academy_full) uden at skrive noget", async () => {
  const teamId = await makeTeam();
  await fillSquad(teamId, "u23", SQUAD_CAPS.u23);
  const riderId = await makeRider({ teamId, birthdate: BORN_U23 });
  const raceId = (await db.query("INSERT INTO races (race_type) VALUES ('one_day') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO race_entries (race_id, rider_id, team_id) VALUES ($1, $2, $3)", [raceId, riderId, teamId]);

  const r = await demote(teamId, riderId, "u23");
  assert.deepEqual(r, { ok: false, code: "academy_full" });
  assert.deepEqual(await riderRow(riderId), { team_id: teamId, is_academy: false, squad: "senior", salary: 5000, pending_academy_signing: false });
  const { rows } = await db.query("SELECT count(*)::int AS n FROM race_entries WHERE rider_id = $1", [riderId]);
  assert.equal(rows[0].n, 1, "fremtidige løb ryddes IKKE ved en afvisning");
});

test("demote: pladsen før loftet går igennem — squad og is_academy skrives i samme række", async () => {
  const teamId = await makeTeam();
  await fillSquad(teamId, "u23", SQUAD_CAPS.u23 - 1);
  const riderId = await makeRider({ teamId, birthdate: BORN_U23 });

  const r = await demote(teamId, riderId, "u23");
  assert.equal(r.ok, true);
  assert.equal(r.squad, "u23");
  assert.equal(r.squad_count, SQUAD_CAPS.u23);
  const row = await riderRow(riderId);
  assert.equal(row.is_academy, true);
  assert.equal(row.squad, "u23");
  assert.equal(row.salary, 4000);
});

test("demote: tælles PR. TRUP — en fuld U23 blokerer ikke en junior-nedrykning", async () => {
  const teamId = await makeTeam();
  await fillSquad(teamId, "u23", SQUAD_CAPS.u23);
  await fillSquad(teamId, "junior", 2);
  const riderId = await makeRider({ teamId, birthdate: BORN_JUNIOR });

  const r = await demote(teamId, riderId, "junior");
  assert.equal(r.ok, true);
  assert.equal((await riderRow(riderId)).squad, "junior");
});

test("demote: loftet kommer fra argumentet, ikke fra SQL", async () => {
  const teamId = await makeTeam();
  await fillSquad(teamId, "u23", 2);
  const riderId = await makeRider({ teamId, birthdate: BORN_U23 });
  assert.deepEqual(await demote(teamId, riderId, "u23", { cap: 2 }), { ok: false, code: "academy_full" });
  assert.equal((await demote(teamId, riderId, "u23", { cap: 3 })).ok, true);
});

test("demote: aldersloftet kommer fra argumentet — for gammel til U23 = not_u23, til junior = too_old_for_squad", async () => {
  const teamId = await makeTeam();
  const senior = await makeRider({ teamId, birthdate: BORN_SENIOR });
  assert.deepEqual(await demote(teamId, senior, "u23"), { ok: false, code: "not_u23" });

  const u23Age = await makeRider({ teamId, birthdate: BORN_U23 });
  assert.deepEqual(await demote(teamId, u23Age, "junior"), { ok: false, code: "too_old_for_squad" });
  assert.equal((await riderRow(u23Age)).is_academy, false, "ingen skrivning ved afvisning");
});

test("demote: ugyldig trup (senior) afvises før låsen — ingen fallback-tal", async () => {
  const teamId = await makeTeam();
  const riderId = await makeRider({ teamId, birthdate: BORN_U23 });
  const { rows } = await db.query(
    `SELECT demote_rider_to_academy($1::uuid, $2::uuid, 1, 3, 3, $3::int, 'senior', 30, 99) AS r`,
    [teamId, riderId, SEASON_START_YEAR],
  );
  assert.deepEqual(rows[0].r, { ok: false, code: "invalid_squad" });
  const nullCap = await db.query(
    `SELECT demote_rider_to_academy($1::uuid, $2::uuid, 1, 3, 3, $3::int, 'u23', NULL, 22) AS r`,
    [teamId, riderId, SEASON_START_YEAR],
  );
  assert.deepEqual(nullCap.rows[0].r, { ok: false, code: "invalid_squad" });
});

test("demote: overgangsperioden — akademiryttere uden trup (før backfill) tæller i mål-truppen", async () => {
  const teamId = await makeTeam();
  // 3 ikke-backfillede akademiryttere + (loft − 3) U23 = fuld U23.
  for (let i = 0; i < 3; i++) await makeRider({ teamId, isAcademy: true, squad: "senior" });
  await fillSquad(teamId, "u23", SQUAD_CAPS.u23 - 3);
  const riderId = await makeRider({ teamId, birthdate: BORN_U23 });
  assert.deepEqual(await demote(teamId, riderId, "u23"), { ok: false, code: "academy_full" });
});

// ── 3. Ungdomsauktion (finalize_academy_acquisition, betalende) ───────────────

test("auktion: fuld mål-trup → academy_full; ingen debit, ingen finance-række, rytteren urørt", async () => {
  const teamId = await makeTeam(100_000);
  await fillSquad(teamId, "junior", SQUAD_CAPS.junior);
  const riderId = await makeRider({ birthdate: BORN_JUNIOR, salary: null });

  const r = await finalize(teamId, riderId, "junior", { price: 25_000, idempotencyKey: "youth_auction_winner:a1" });
  assert.deepEqual(r, { ok: false, code: "academy_full" });
  assert.equal((await riderRow(riderId)).team_id, null);
  const bal = await db.query("SELECT balance FROM teams WHERE id = $1", [teamId]);
  assert.equal(bal.rows[0].balance, 100000);
  const ft = await db.query("SELECT count(*)::int AS n FROM finance_transactions");
  assert.equal(ft.rows[0].n, 0);
});

test("auktion: fuld U23 blokerer ikke en junior-vinder — squad, is_academy, debit og finance-række i ét hug", async () => {
  const teamId = await makeTeam(100_000);
  await fillSquad(teamId, "u23", SQUAD_CAPS.u23);
  const riderId = await makeRider({ birthdate: BORN_JUNIOR, salary: null });

  const r = await finalize(teamId, riderId, "junior", { price: 25_000, idempotencyKey: "youth_auction_winner:a2" });
  assert.equal(r.ok, true);
  assert.equal(r.squad, "junior");
  assert.equal(r.squad_count, 1);
  assert.equal(r.deferred, false);
  const row = await riderRow(riderId);
  assert.equal(row.team_id, teamId);
  assert.equal(row.is_academy, true);
  assert.equal(row.squad, "junior");
  const bal = await db.query("SELECT balance FROM teams WHERE id = $1", [teamId]);
  assert.equal(bal.rows[0].balance, 75000);
});

test("auktion: dublet-idempotency_key (cron-retry) ruller HELE optagelsen tilbage — også trup-feltet", async () => {
  const teamId = await makeTeam(100_000);
  await db.query(
    "INSERT INTO finance_transactions (team_id, type, amount, idempotency_key) VALUES ($1, 'academy_signing', -1, 'youth_auction_winner:dup')",
    [teamId],
  );
  const riderId = await makeRider({ birthdate: BORN_U23, salary: null });

  await assert.rejects(
    () => finalize(teamId, riderId, "u23", { price: 25_000, idempotencyKey: "youth_auction_winner:dup" }),
    (err) => err?.code === "23505",
  );
  assert.deepEqual(await riderRow(riderId), { team_id: null, is_academy: false, squad: "senior", salary: null, pending_academy_signing: false });
  const bal = await db.query("SELECT balance FROM teams WHERE id = $1", [teamId]);
  assert.equal(bal.rows[0].balance, 100000);
});

test("auktion: utilstrækkelig balance → ingen skrivning af trup eller akademi-flag", async () => {
  const teamId = await makeTeam(10);
  const riderId = await makeRider({ birthdate: BORN_U23, salary: null });
  const r = await finalize(teamId, riderId, "u23", { price: 25_000, idempotencyKey: "youth_auction_winner:poor" });
  assert.deepEqual(r, { ok: false, code: "insufficient_balance" });
  assert.equal((await riderRow(riderId)).squad, "senior");
});

// ── 4. Intake-signering (finalize_academy_acquisition, signing-fee) ───────────

test("intake: fri kandidat lander i den trup kalderen sender, tællingen er pr. trup", async () => {
  const teamId = await makeTeam(100_000);
  await fillSquad(teamId, "junior", SQUAD_CAPS.junior - 1);
  const first = await makeRider({ birthdate: BORN_JUNIOR, salary: null });
  const second = await makeRider({ birthdate: BORN_JUNIOR, salary: null });

  const ok = await finalize(teamId, first, "junior", { price: 500, idempotencyKey: `academy_signing:${first}` });
  assert.equal(ok.ok, true);
  assert.equal(ok.squad_count, SQUAD_CAPS.junior);
  const full = await finalize(teamId, second, "junior", { price: 500, idempotencyKey: `academy_signing:${second}` });
  assert.deepEqual(full, { ok: false, code: "academy_full" });
  assert.equal((await riderRow(second)).team_id, null, "den afviste kandidat forbliver fri");
});

test("intake: udskudt optagelse (#4423, aktivt etapeløb) rører hverken is_academy eller squad", async () => {
  const teamId = await makeTeam(100_000);
  const riderId = await makeRider({ teamId, birthdate: BORN_U23 });
  const raceId = (await db.query("INSERT INTO races (race_type, stages_completed) VALUES ('stage_race', 2) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO race_entries (race_id, rider_id, team_id) VALUES ($1, $2, $3)", [raceId, riderId, teamId]);

  const r = await finalize(teamId, riderId, "u23", { price: 500, idempotencyKey: `academy_signing:${riderId}` });
  assert.equal(r.ok, true);
  assert.equal(r.deferred, true);
  assert.equal(r.squad_count, 0, "han optager ikke en plads før flippet");
  const row = await riderRow(riderId);
  assert.equal(row.is_academy, false);
  assert.equal(row.squad, "senior", "de to kolonner forbliver enige mens flippet venter");
  assert.equal(row.pending_academy_signing, true);
});

test("intake: rytter ejet af et andet hold → rider_owned uden skrivning", async () => {
  const teamId = await makeTeam(100_000);
  const other = await makeTeam();
  const riderId = await makeRider({ teamId: other, birthdate: BORN_U23 });
  assert.deepEqual(await finalize(teamId, riderId, "u23", { price: 500, idempotencyKey: "k-owned" }), { ok: false, code: "rider_owned" });
  assert.equal((await riderRow(riderId)).squad, "senior");
});

// ── 5. Flyt mellem junior og U23 (move_academy_rider_squad) ───────────────────

test("move: junior → U23 skriver kun squad; is_academy bliver stående", async () => {
  const teamId = await makeTeam();
  const riderId = await makeRider({ teamId, isAcademy: true, squad: "junior", birthdate: BORN_JUNIOR });
  const r = await move(teamId, riderId, "u23");
  assert.deepEqual(r, { ok: true, squad: "u23", squad_count: 1 });
  const row = await riderRow(riderId);
  assert.equal(row.squad, "u23");
  assert.equal(row.is_academy, true);
});

test("move: fuld mål-trup → squad_full; rytteren bliver hvor han er", async () => {
  const teamId = await makeTeam();
  await fillSquad(teamId, "u23", SQUAD_CAPS.u23);
  const riderId = await makeRider({ teamId, isAcademy: true, squad: "junior", birthdate: BORN_JUNIOR });
  assert.deepEqual(await move(teamId, riderId, "u23"), { ok: false, code: "squad_full" });
  assert.equal((await riderRow(riderId)).squad, "junior");
});

test("move: en ikke-backfillet rytter tæller ikke mod sin egen nye plads", async () => {
  const teamId = await makeTeam();
  await fillSquad(teamId, "u23", SQUAD_CAPS.u23 - 1);
  const riderId = await makeRider({ teamId, isAcademy: true, squad: "senior", birthdate: BORN_JUNIOR });
  const r = await move(teamId, riderId, "u23");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.squad_count, SQUAD_CAPS.u23);
});

test("move: dagens gates — aktiv auktion, aktivt etapeløb, samme trup, seniorrytter, andet hold", async () => {
  const teamId = await makeTeam();
  const other = await makeTeam();

  const onMarket = await makeRider({ teamId, isAcademy: true, squad: "junior" });
  await db.query("INSERT INTO auctions (rider_id, status) VALUES ($1, 'active')", [onMarket]);
  assert.deepEqual(await move(teamId, onMarket, "u23"), { ok: false, code: "rider_on_market" });

  const racing = await makeRider({ teamId, isAcademy: true, squad: "u23" });
  const raceId = (await db.query("INSERT INTO races (race_type, stages_completed) VALUES ('stage_race', 1) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO race_entries (race_id, rider_id, team_id) VALUES ($1, $2, $3)", [raceId, racing, teamId]);
  assert.deepEqual(await move(teamId, racing, "junior"), { ok: false, code: "rider_in_stage_race" });

  const same = await makeRider({ teamId, isAcademy: true, squad: "u23" });
  assert.deepEqual(await move(teamId, same, "u23"), { ok: false, code: "same_squad" });

  const senior = await makeRider({ teamId, isAcademy: false });
  assert.deepEqual(await move(teamId, senior, "u23"), { ok: false, code: "not_academy" });

  const foreign = await makeRider({ teamId: other, isAcademy: true, squad: "junior" });
  assert.deepEqual(await move(teamId, foreign, "u23"), { ok: false, code: "not_owned" });
});

test("move: et afsluttet eller ikke-startet etapeløb blokerer ikke", async () => {
  const teamId = await makeTeam();
  const riderId = await makeRider({ teamId, isAcademy: true, squad: "junior" });
  const done = (await db.query("INSERT INTO races (race_type, status, stages_completed) VALUES ('stage_race', 'completed', 5) RETURNING id")).rows[0].id;
  const future = (await db.query("INSERT INTO races (race_type, stages_completed) VALUES ('stage_race', 0) RETURNING id")).rows[0].id;
  await db.query("INSERT INTO race_entries (race_id, rider_id, team_id) VALUES ($1, $3, $4), ($2, $3, $4)", [done, future, riderId, teamId]);
  assert.equal((await move(teamId, riderId, "u23")).ok, true);
});
