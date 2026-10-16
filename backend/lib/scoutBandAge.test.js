import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scoutBandAge,
  pickAgeReferenceSeasonNumber,
  resolveScoutBandSeasonNumber,
} from "./scoutBandAge.js";
import { ageForSeason, LAUNCH_REFERENCE_YEAR } from "./riderSeasonAge.js";

test("scoutBandAge: soeson-drevet, ikke wall-clock", () => {
  assert.equal(scoutBandAge("2001-03-01", 1), LAUNCH_REFERENCE_YEAR - 2001);
  assert.equal(scoutBandAge("2001-03-01", 3), LAUNCH_REFERENCE_YEAR + 2 - 2001);
  assert.equal(scoutBandAge("2001-03-01", 3), ageForSeason("2001-03-01", 3));
});

test("scoutBandAge: 1. januar er tidszone-uafhaengig", () => {
  assert.equal(scoutBandAge("2001-01-01", 1), LAUNCH_REFERENCE_YEAR - 2001);
});

test("scoutBandAge: manglende input giver null", () => {
  assert.equal(scoutBandAge(null, 1), null);
  assert.equal(scoutBandAge(undefined, 1), null);
  assert.equal(scoutBandAge("2001-03-01", NaN), null);
});

test("development-projection bruger scoutBandAge, ikke kalenderaar", () => {
  const api = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "routes", "api.js"), "utf8");
  const start = api.indexOf('"/riders/:id/development-projection"');
  assert.ok(start > 0);
  const block = api.slice(start, start + 3500);
  assert.match(block, /scoutBandAge\(/);
  assert.doesNotMatch(block, /new Date\(\)\.getFullYear\(\)/);
  // Saesonpausen: getActiveSeasonNumber() falder tavst tilbage til 1 -> maa ikke bruges her.
  assert.match(block, /resolveScoutBandSeasonNumber\(/);
  assert.doesNotMatch(block, /scoutBandAge\([^)]*getActiveSeasonNumber/);
});

test("referencesaeson: aktiv saeson vinder", () => {
  assert.equal(pickAgeReferenceSeasonNumber([
    { number: 2, status: "completed" },
    { number: 3, status: "active" },
    { number: 4, status: "upcoming" },
  ]), 3);
});

test("referencesaeson i saesonpausen: naermeste upcoming, aldrig 1", () => {
  const rows = [
    { number: 1, status: "completed" },
    { number: 2, status: "completed" },
    { number: 4, status: "upcoming" },
    { number: 3, status: "upcoming" },
  ];
  assert.equal(pickAgeReferenceSeasonNumber(rows), 3);
  assert.equal(scoutBandAge("2001-03-01", pickAgeReferenceSeasonNumber(rows)), ageForSeason("2001-03-01", 3));
});

test("referencesaeson i saesonpausen uden upcoming: seneste completed", () => {
  assert.equal(pickAgeReferenceSeasonNumber([
    { number: 1, status: "completed" },
    { number: 2, status: "completed" },
  ]), 2);
});

test("referencesaeson: intet brugbart giver null (ikke 1), saeson 0 ignoreres", () => {
  assert.equal(pickAgeReferenceSeasonNumber([]), null);
  assert.equal(pickAgeReferenceSeasonNumber(null), null);
  assert.equal(pickAgeReferenceSeasonNumber([{ number: 0, status: "active" }]), null);
  assert.equal(scoutBandAge("2001-03-01", pickAgeReferenceSeasonNumber([])), null);
});

function stubSupabase(result) {
  const calls = [];
  const chain = {
    select(cols) { calls.push(["select", cols]); return chain; },
    gt(col, val) { calls.push(["gt", col, val]); return Promise.resolve(result); },
  };
  return { calls, client: { from(t) { calls.push(["from", t]); return chain; } } };
}

test("resolveScoutBandSeasonNumber: saesonpause slaar op uden status-filter", async () => {
  const { calls, client } = stubSupabase({
    data: [{ number: 2, status: "completed" }, { number: 3, status: "upcoming" }],
    error: null,
  });
  assert.equal(await resolveScoutBandSeasonNumber(client), 3);
  assert.deepEqual(calls, [["from", "seasons"], ["select", "number, status"], ["gt", "number", 0]]);
});

test("resolveScoutBandSeasonNumber: DB-fejl kastes, gaettes ikke", async () => {
  const { client } = stubSupabase({ data: null, error: { message: "boom" } });
  await assert.rejects(() => resolveScoutBandSeasonNumber(client), /boom/);
});
