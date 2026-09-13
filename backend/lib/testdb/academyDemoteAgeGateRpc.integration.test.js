// #5145 — SQL-test af alders-gaten i demote_rider_to_academy mod en ÆGTE
// Postgres-motor via PGlite (in-memory, ingen Docker, ingen cost). Samme mønster
// som raceSelectionBulkRpc.integration.test.js.
//
// Hvad den beviser:
//   1. EFTER migrationen: sæson-alder 21 → ok, rytteren står is_academy = true.
//   2. EFTER migrationen: sæson-alder 22 → afvist med code 'not_u23', og rytteren
//      er UÆNDRET (ingen delvis mutation).
//   3. FØR migrationen (kun 2026-06-25-versionen loadet): sæson-alder 22 blev
//      ACCEPTERET. Det er selve bug'en fra #5145/#5133 — testen pinner deltaet,
//      så en fremtidig CREATE OR REPLACE der genindfører `> 22` fejler her.
//   4. Grænsen er en GRÆNSE, ikke en tilfældighed: 20 og 21 går igennem, 22 og 23
//      afvises.
//
// Funktionerne er de ÆGTE, committede filer (database/2026-06-25-academy-promote-
// demote.sql + database/2026-09-13-5145-demote-age-gate-21.sql), saneret af
// sanitizeForPglite — ikke en re-typet kopi. Apply-rækkefølgen er den samme som
// prod's (auto-migrate.yml kører dem i dato-orden), så det er den GÆLDENDE
// funktionskrop vi tester.
//
// BASE_DDL er hånd-skrevet minimalt (kun de kolonner RPC'en rører). riders/teams
// har ingen FK-krav i denne sti, så team_id er en bar UUID — samme forenkling som
// raceResultsEntrantUnique.integration.test.js.

import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { sanitizeForPglite } from "./sanitizeForPglite.js";
import { ACADEMY } from "../academyFlag.js";
import { GRADUATION } from "../academyGraduation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_DIR = join(__dirname, "..", "..", "..", "database");

const BASE_MIGRATION = "2026-06-25-academy-promote-demote.sql";
const FIX_MIGRATION = "2026-09-13-5145-demote-age-gate-21.sql";

// Sæsonens referenceår som backend sender det (LAUNCH_REFERENCE_YEAR + season - 1).
// Konkret tal fremfor import: testen skal fejle hvis RPC'ens formel ændrer sig,
// ikke følge med.
const SEASON_START_YEAR = 2027;
const TEAM_ID = "11111111-1111-4111-8111-111111111111";

const BASE_DDL = `
CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID,
  is_academy BOOLEAN NOT NULL DEFAULT FALSE,
  birthdate DATE,
  salary BIGINT,
  contract_length INTEGER,
  contract_end_season INTEGER
);
CREATE TABLE auctions (
  rider_id UUID NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE transfer_listings (
  rider_id UUID NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'scheduled',
  stages_completed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE race_entries (
  race_id UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  rider_id UUID NOT NULL
);
-- 2026-06-25-migrationen udvider notifications_type_check; tabellen skal findes
-- for at dens ALTER TABLE kan køre. Kolonnerne herunder er kun dem den rører.
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL
);
`;

function loadMigration(filename) {
  return sanitizeForPglite(readFileSync(join(DATABASE_DIR, filename), "utf8"));
}

async function makeDb({ withFix }) {
  const db = new PGlite();
  await db.exec(BASE_DDL);
  await db.exec(loadMigration(BASE_MIGRATION));
  if (withFix) await db.exec(loadMigration(FIX_MIGRATION));
  return db;
}

// Opret en senior-rytter hvis sæson-alder i SEASON_START_YEAR er præcis `age`.
async function makeSenior(db, age) {
  const birthdate = `${SEASON_START_YEAR - age}-05-14`;
  const { rows } = await db.query(
    "INSERT INTO riders (team_id, is_academy, birthdate, salary, contract_length, contract_end_season) "
    + "VALUES ($1, FALSE, $2::date, 9000, 2, 4) RETURNING id",
    [TEAM_ID, birthdate],
  );
  return rows[0].id;
}

async function callDemote(db, riderId) {
  const { rows } = await db.query(
    "SELECT demote_rider_to_academy($1::uuid, $2::uuid, $3::bigint, $4::int, $5::int, $6::int) AS result",
    [TEAM_ID, riderId, 1200, 3, 5, SEASON_START_YEAR],
  );
  return rows[0].result;
}

async function isAcademy(db, riderId) {
  const { rows } = await db.query("SELECT is_academy FROM riders WHERE id = $1", [riderId]);
  return rows[0].is_academy;
}

let db;
before(async () => { db = await makeDb({ withFix: true }); });
after(async () => { if (db) await db.close(); });
beforeEach(async () => { await db.exec("TRUNCATE race_entries, races, auctions, transfer_listings, riders CASCADE"); });

test("#5145: sæson-alder 21 (ACADEMY.MAX_AGE) må stadig rykke ned i akademiet", async () => {
  const riderId = await makeSenior(db, ACADEMY.MAX_AGE);
  const result = await callDemote(db, riderId);
  assert.equal(result.ok, true, `alder ${ACADEMY.MAX_AGE} skal accepteres, fik ${JSON.stringify(result)}`);
  assert.equal(await isAcademy(db, riderId), true, "rytteren skal stå som akademi-rytter bagefter");
});

test("#5145: sæson-alder 22 (GRADUATION.GRADUATE_AGE) afvises med 'not_u23' og muterer intet", async () => {
  const riderId = await makeSenior(db, GRADUATION.GRADUATE_AGE);
  const result = await callDemote(db, riderId);
  assert.equal(result.ok, false, "gradueringsalderen må ikke kunne rykkes ned i");
  assert.equal(result.code, "not_u23", "fejlkoden er bevidst uændret (internt kontrakt-navn, se migrationens header)");
  assert.equal(await isAcademy(db, riderId), false, "afvisning må ikke efterlade en delvis mutation");
});

test("#5145: gaten er en grænse — 20/21 igennem, 22/23 afvist", async () => {
  for (const age of [20, 21]) {
    const riderId = await makeSenior(db, age);
    const result = await callDemote(db, riderId);
    assert.equal(result.ok, true, `alder ${age} skal accepteres, fik ${JSON.stringify(result)}`);
  }
  for (const age of [22, 23]) {
    const riderId = await makeSenior(db, age);
    const result = await callDemote(db, riderId);
    assert.equal(result.ok, false, `alder ${age} skal afvises, fik ${JSON.stringify(result)}`);
    assert.equal(result.code, "not_u23");
  }
});

test("#5145 regressions-pin: UDEN migrationen accepterede RPC'en en 22-årig (selve bug'en)", async () => {
  const legacy = await makeDb({ withFix: false });
  try {
    const riderId = await makeSenior(legacy, GRADUATION.GRADUATE_AGE);
    const result = await callDemote(legacy, riderId);
    assert.equal(
      result.ok, true,
      "2026-06-25-versionen SKAL acceptere 22 — gør den ikke det, tester denne fil ikke længere det delta #5145 handler om",
    );
  } finally {
    await legacy.close();
  }
});

test("#5145: alders-konstanterne hænger sammen — GRADUATE_AGE = MAX_AGE + 1", () => {
  assert.equal(
    GRADUATION.GRADUATE_AGE, ACADEMY.MAX_AGE + 1,
    "gaten i SQL'en er skrevet som <= MAX_AGE netop fordi akademiet slutter ved MAX_AGE + 1",
  );
});
