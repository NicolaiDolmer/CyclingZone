// Enhedstests for #4204's to veje til race_results-dublet-invarianten.
//
// Selve ÆKVIVALENSEN mellem SQL og JS bevises mod en ægte Postgres-motor i
// testdb/raceResultDuplicateRpc.integration.test.js. Denne fil dækker det
// integrationstesten ikke kan: kontrakten mellem RPC-svaret og scriptet, dvs.
// hvad der sker når svaret er tomt, mangler felter eller slet ikke er et objekt.
// Uden dem ville en ændret RPC-form fejle først ude i den natlige vagt.

import test from "node:test";
import assert from "node:assert/strict";

import {
  RACE_RESULT_DUPLICATE_RPC,
  RACE_RESULT_VIOLATION_LIMIT,
  computeRaceResultDuplicates,
  normalizeRaceResultDuplicatesRpc,
} from "./raceResultDuplicateInvariant.js";

const ROW = (over = {}) => ({
  race_id: "race-1",
  stage_number: 1,
  result_type: "stage",
  rider_id: "rider-1",
  rank: 1,
  ...over,
});

test("RPC-navn og rapporterings-loft er de værdier scriptet og migrationen deler", () => {
  assert.equal(RACE_RESULT_DUPLICATE_RPC, "verify_race_result_duplicates");
  // 50 er det loft den tidligere .slice(0, 50) havde. Ændres det, skal p_limit
  // følge med, ellers rapporterer de to veje forskelligt antal brud.
  assert.equal(RACE_RESULT_VIOLATION_LIMIT, 50);
});

test("normalizer: fuldt svar oversættes felt for felt", () => {
  const summary = normalizeRaceResultDuplicatesRpc({
    total_rows: 1128609,
    rider_key_count: 490426,
    duplicate_key_count: 2,
    duplicate_race_count: 1,
    duplicate_keys: [
      { race_id: "race-1", stage_number: 3, result_type: "stage", rider_id: "rider-9", rows: 2 },
    ],
    duplicate_rank_count: 1,
    duplicate_ranks: [{ race_id: "race-1", stage_number: 3, result_type: "gc", rank: 4, rows: 3 }],
  });

  assert.deepStrictEqual(summary, {
    totalRows: 1128609,
    riderKeyCount: 490426,
    duplicateKeyCount: 2,
    duplicateRaceCount: 1,
    duplicateKeys: [
      { raceId: "race-1", stageNumber: 3, resultType: "stage", riderId: "rider-9", rows: 2 },
    ],
    duplicateRankCount: 1,
    duplicateRanks: [{ raceId: "race-1", stageNumber: 3, resultType: "gc", rank: 4, rows: 3 }],
  });
});

test("normalizer: bigint-tællere som strenge bliver til tal", () => {
  // PostgREST serialiserer int8 som JSON-tal, men en driver kan levere dem som
  // streng. Scriptet sammenligner med === 0, så typen skal være tal.
  const summary = normalizeRaceResultDuplicatesRpc({
    total_rows: "1128609",
    rider_key_count: "490426",
    duplicate_key_count: "0",
    duplicate_race_count: "0",
    duplicate_keys: [],
    duplicate_rank_count: "0",
    duplicate_ranks: [],
  });
  assert.strictEqual(summary.totalRows, 1128609);
  assert.strictEqual(summary.duplicateKeyCount, 0);
  assert.strictEqual(summary.duplicateRankCount, 0);
});

test("normalizer: manglende arrays bliver til tomme lister, ikke undefined", () => {
  const summary = normalizeRaceResultDuplicatesRpc({});
  assert.deepStrictEqual(summary.duplicateKeys, []);
  assert.deepStrictEqual(summary.duplicateRanks, []);
  assert.strictEqual(summary.totalRows, 0);
});

test("normalizer: et svar der ikke er et objekt kaster med RPC-navnet i beskeden", () => {
  for (const bad of [null, undefined, 42, "nej", []]) {
    assert.throws(() => normalizeRaceResultDuplicatesRpc(bad), /verify_race_result_duplicates/);
  }
});

test("reference: rytterløse rækker tælles hverken som nøgler eller dubletter", () => {
  const summary = computeRaceResultDuplicates([
    ROW({ rider_id: null, result_type: "team", rank: 1 }),
    ROW({ rider_id: null, result_type: "team", rank: 2 }),
    ROW(),
  ]);
  assert.equal(summary.totalRows, 3);
  assert.equal(summary.riderKeyCount, 1);
  assert.equal(summary.duplicateKeyCount, 0);
});

test("reference: loftet skærer listen, men tællerne er de fulde tal", () => {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    rows.push(ROW({ rider_id: `rider-${i}`, rank: i }));
    rows.push(ROW({ rider_id: `rider-${i}`, rank: i }));
  }
  const summary = computeRaceResultDuplicates(rows, { limit: 2 });
  assert.equal(summary.duplicateKeyCount, 5);
  assert.equal(summary.duplicateKeys.length, 2);
  assert.equal(summary.duplicateRaceCount, 1);
  // Første set først: rækkerne kommer i id-orden fra fetchAll.
  assert.deepStrictEqual(
    summary.duplicateKeys.map((d) => d.riderId),
    ["rider-0", "rider-1"],
  );
});

test("reference: NULL stage_number bevares som null (ikke NaN) i violation-listen", () => {
  const summary = computeRaceResultDuplicates([
    ROW({ stage_number: null }),
    ROW({ stage_number: null }),
  ]);
  assert.equal(summary.duplicateKeyCount, 1);
  assert.strictEqual(summary.duplicateKeys[0].stageNumber, null);
  // JSON-outputtet er dét vagten arkiverer, og det er uændret fra den gamle vej
  // (JSON.stringify(NaN) gav også null).
  assert.equal(JSON.parse(JSON.stringify(summary.duplicateKeys[0])).stageNumber, null);
});
