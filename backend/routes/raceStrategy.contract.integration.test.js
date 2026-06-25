// Contract-integrationstest for GET /api/races/strategy's roster-projektion (#1840, B3).
//
// Motiverende bug: strategi-endpointet projicerede en ikke-eksisterende kolonne
// (riders.overall) → hele queryen fejlede tavst → tom roster → blank strategi-flade.
// Denne test korer endpointets REELLE projektion (den delte STRATEGY_ROSTER_COLUMNS-
// konstant, importeret fra selve api.js) mod det REELLE skema (createTestDb), så et
// fremtidigt drift mellem projektion og skema fanges i CI før merge.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { createTestDb } from "../lib/testdb/createTestDb.js";
import { STRATEGY_ROSTER_COLUMNS } from "./api.js";

const TEAM_ID = "11111111-1111-1111-1111-111111111111";

let db;
before(async () => {
  db = await createTestDb();
  await db.query("INSERT INTO public.teams (id, name) VALUES ($1, $2)", [TEAM_ID, "Contract Test Team"]);
});
after(async () => {
  if (db) await db.close();
});

test("STRATEGY_ROSTER_COLUMNS er eksporteret og ikke-tom", () => {
  assert.equal(typeof STRATEGY_ROSTER_COLUMNS, "string");
  assert.ok(STRATEGY_ROSTER_COLUMNS.trim().length > 0);
});

test("roster-projektionen eksekverer mod skemaet (alle kolonner findes)", async () => {
  // Spejler endpointets .from('riders').select(STRATEGY_ROSTER_COLUMNS)
  //   .eq('team_id', ...).eq('is_academy', false).or('is_retired.is.null,is_retired.eq.false')
  // Hvis EN kolonne i projektionen ikke findes (fx 'overall'), fejler denne query.
  await assert.doesNotReject(async () => {
    await db.query(
      `SELECT ${STRATEGY_ROSTER_COLUMNS} FROM public.riders
       WHERE team_id = $1 AND is_academy = false AND (is_retired IS NULL OR is_retired = false)`,
      [TEAM_ID],
    );
  });
});

test("tom roster → [] (ikke en fejl) — regressionsvagt for #1840's blanke flade", async () => {
  const { rows } = await db.query(
    `SELECT ${STRATEGY_ROSTER_COLUMNS} FROM public.riders
     WHERE team_id = $1 AND is_academy = false AND (is_retired IS NULL OR is_retired = false)`,
    [TEAM_ID],
  );
  assert.deepEqual(rows, [], "intet hold-roster → tom liste, ikke kastet fejl");
});

test("projektion med en IKKE-eksisterende kolonne (overall) FEJLER — harnessen fanger #1840-klassen", async () => {
  await assert.rejects(
    async () => {
      await db.query("SELECT id, overall FROM public.riders WHERE team_id = $1", [TEAM_ID]);
    },
    /column .*overall.* does not exist|overall/i,
    "et select af riders.overall SKAL fejle mod det reelle skema",
  );
});
