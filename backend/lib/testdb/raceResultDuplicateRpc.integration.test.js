// Ækvivalens-bevis for #4204: den nye RPC og den gamle in-memory-optælling giver
// NØJAGTIGT samme svar.
//
// verify-invariants.js talte tidligere race_results-dubletter ved at hente alle
// ~1,1 mio. rækker over PostgREST (~1.130 HTTP-kald, ~20 min). #4204 flytter
// optællingen til Postgres. Kravet var eksplicit: samme resultat, bare hurtigere.
// Den påstand bevises her i stedet for at blive hævdet.
//
// Opsætning: den ÆGTE, COMMITTEDE migration (database/2026-08-29-4204-race-result-
// duplicate-rpc.sql) køres mod en éngangs-PGlite-instans (rigtig Postgres-motor,
// ingen Docker, ingen cost) oven på et prod-tro race_results-skema. For hvert
// datasæt køres BEGGE veje over de SAMME rækker:
//
//   RPC-vejen:  select public.verify_race_result_duplicates(limit)
//               -> normalizeRaceResultDuplicatesRpc()
//   Gamle vej:  select * from race_results order by id
//               -> computeRaceResultDuplicates()
//
// og de to resultater sammenlignes med deepStrictEqual PLUS JSON.stringify, så
// både værdier, rækkefølge og nøgle-orden er ens. Nøgle-orden er ikke pedanteri:
// scriptets --json-output er det de daglige workflow-artefakter indeholder.
//
// Datasættene rammer de kanter hvor SQL og JS normalt divergerer: NULL rider_id
// (hold-klassementer), NULL rank (ikke-scorende rækker), NULL stage_number, NULL
// race_id, og flere brud end rapporterings-loftet.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { sanitizeForPglite } from "./sanitizeForPglite.js";
import {
  computeRaceResultDuplicates,
  normalizeRaceResultDuplicatesRpc,
} from "../raceResultDuplicateInvariant.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_DIR = join(__dirname, "..", "..", "..", "database");
const MIGRATION = "2026-08-29-4204-race-result-duplicate-rpc.sql";
// #4507: perf-fix oven på #4204 — CREATE OR REPLACE af samme funktion (uændret
// signatur/jsonb-form, kun HVORDAN tallene beregnes internt). Køres EFTER
// #4204 i before(), så testene nedenfor måler den nyeste version af funktionen
// mod uændret ækvivalens-facit.
const PERF_MIGRATION = "2026-08-31-4507-race-result-duplicate-rpc-perf.sql";

// Minimal, prod-tro DDL: kun de kolonner dublet-invarianterne rører, med samme
// nullability som schema.sql (race_id, stage_number, rank og rider_id er alle
// nullable - det er præcis dét kanterne nedenfor handler om). gen_random_uuid()
// i stedet for uuid_generate_v4() fordi PGlite ikke har uuid-ossp, samme greb som
// raceResultsEntrantUnique.integration.test.js.
const BASE_DDL = `
CREATE TABLE races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT
);
CREATE TABLE riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firstname TEXT
);
CREATE TABLE race_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID REFERENCES races(id) ON DELETE CASCADE,
  stage_number INTEGER DEFAULT 1,
  result_type TEXT NOT NULL CHECK (result_type IN ('stage', 'gc', 'points', 'mountain', 'young', 'team', 'leader', 'mountain_day', 'points_day', 'young_day')),
  rank INTEGER,
  rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
  points_earned INTEGER DEFAULT 0
);
`;

// Deterministiske uuid'er: id'ets sidste ciffergruppe tæller op i indsættelses-
// rækkefølge, så "stigende id" == "indsættelses-rækkefølge". Det er dét
// rapporterings-rækkefølgen afhænger af i begge veje (min(id::text) i SQL, first-seen i
// Map'en), så testen kan udtale sig om HVILKE brud der rapporteres.
function seqUuid(prefix, n) {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const RACE_A = seqUuid("aaaaaaaa", 1);
const RACE_B = seqUuid("aaaaaaaa", 2);
const RIDER_1 = seqUuid("bbbbbbbb", 1);
const RIDER_2 = seqUuid("bbbbbbbb", 2);
const RIDER_3 = seqUuid("bbbbbbbb", 3);

let db;

before(async () => {
  db = new PGlite();
  await db.exec(BASE_DDL);
  await db.exec(sanitizeForPglite(readFileSync(join(DATABASE_DIR, MIGRATION), "utf8")));
  await db.exec(sanitizeForPglite(readFileSync(join(DATABASE_DIR, PERF_MIGRATION), "utf8")));
  await db.query("INSERT INTO races (id, name) VALUES ($1, 'Race A'), ($2, 'Race B')", [RACE_A, RACE_B]);
  await db.query("INSERT INTO riders (id, firstname) VALUES ($1, 'R1'), ($2, 'R2'), ($3, 'R3')", [
    RIDER_1,
    RIDER_2,
    RIDER_3,
  ]);
});

after(async () => {
  if (db) await db.close();
});

/**
 * Skriv datasættet, kør begge veje over det, og returnér de to resultater.
 * `rows` indsættes i den angivne rækkefølge med stigende id.
 */
async function bothWays(rows, limit) {
  await db.exec("DELETE FROM race_results");
  let seq = 0;
  for (const r of rows) {
    seq += 1;
    await db.query(
      `INSERT INTO race_results (id, race_id, stage_number, result_type, rank, rider_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [seqUuid("cccccccc", seq), r.race_id, r.stage_number, r.result_type, r.rank, r.rider_id],
    );
  }

  // Gamle vej: præcis den projektion og sortering fetchAll bruger (order=id.asc).
  const fetched = await db.query(
    "SELECT race_id, stage_number, result_type, rider_id, rank FROM race_results ORDER BY id ASC",
  );
  const reference = computeRaceResultDuplicates(fetched.rows, { limit });

  // Ny vej: den committede SQL-funktion.
  const rpc = await db.query("SELECT public.verify_race_result_duplicates($1) AS payload", [limit]);
  const actual = normalizeRaceResultDuplicatesRpc(rpc.rows[0].payload);

  return { reference, actual };
}

function assertEquivalent(reference, actual) {
  assert.deepStrictEqual(actual, reference);
  // Nøgle-orden med: --json-outputtet skal være byte-identisk, ikke bare "lige så".
  assert.equal(JSON.stringify(actual), JSON.stringify(reference));
}

test("tom tabel: begge veje giver nul på tværs af alle felter", async () => {
  const { reference, actual } = await bothWays([], 50);
  assertEquivalent(reference, actual);
  assert.deepStrictEqual(reference, {
    totalRows: 0,
    riderKeyCount: 0,
    duplicateKeyCount: 0,
    duplicateRaceCount: 0,
    duplicateKeys: [],
    duplicateRankCount: 0,
    duplicateRanks: [],
  });
});

test("ren data: rytterløse hold-rækker og NULL-rang tælles ikke som dubletter", async () => {
  const rows = [
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDER_1 },
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 2, rider_id: RIDER_2 },
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 3, rider_id: RIDER_3 },
    // Hold-klassementet: ingen rytter per design. To rækker med samme
    // (løb, etape, klassement) - de MÅ ikke tælle som en rytter-dublet.
    { race_id: RACE_A, stage_number: 1, result_type: "team", rank: 1, rider_id: null },
    { race_id: RACE_A, stage_number: 1, result_type: "team", rank: 2, rider_id: null },
    // Ikke-scorende rækker: rank=null i massevis, må ikke tælle som rang-dublet.
    { race_id: RACE_A, stage_number: 2, result_type: "stage", rank: null, rider_id: RIDER_1 },
    { race_id: RACE_A, stage_number: 2, result_type: "stage", rank: null, rider_id: RIDER_2 },
    { race_id: RACE_A, stage_number: 2, result_type: "stage", rank: null, rider_id: RIDER_3 },
  ];
  const { reference, actual } = await bothWays(rows, 50);
  assertEquivalent(reference, actual);
  assert.equal(reference.totalRows, 8);
  assert.equal(reference.riderKeyCount, 6);
  assert.equal(reference.duplicateKeyCount, 0);
  assert.equal(reference.duplicateRankCount, 0);
});

test("ægte rytter-dublet (fejlet delete-then-insert) fanges ens af begge veje", async () => {
  const rows = [
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDER_1 },
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 2, rider_id: RIDER_2 },
    // Genafvikling oven på et fejlet delete: samme rytter, samme klassement igen.
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDER_1 },
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 2, rider_id: RIDER_2 },
  ];
  const { reference, actual } = await bothWays(rows, 50);
  assertEquivalent(reference, actual);
  assert.equal(reference.duplicateKeyCount, 2);
  assert.equal(reference.duplicateRaceCount, 1);
  assert.deepStrictEqual(reference.duplicateKeys[0], {
    raceId: RACE_A,
    stageNumber: 1,
    resultType: "stage",
    riderId: RIDER_1,
    rows: 2,
  });
  // Samme rang to gange i samme klassement fanges af den anden invariant.
  assert.equal(reference.duplicateRankCount, 2);
});

test("rang-dublet UDEN rytter-dublet fanges kun af rang-invarianten", async () => {
  const rows = [
    { race_id: RACE_B, stage_number: 3, result_type: "gc", rank: 1, rider_id: RIDER_1 },
    // Anden rytter, samme rang i samme klassement: ikke en rytter-dublet.
    { race_id: RACE_B, stage_number: 3, result_type: "gc", rank: 1, rider_id: RIDER_2 },
  ];
  const { reference, actual } = await bothWays(rows, 50);
  assertEquivalent(reference, actual);
  assert.equal(reference.duplicateKeyCount, 0);
  assert.equal(reference.duplicateRankCount, 1);
  assert.deepStrictEqual(reference.duplicateRanks[0], {
    raceId: RACE_B,
    stageNumber: 3,
    resultType: "gc",
    rank: 1,
    rows: 2,
  });
});

test("NULL stage_number og NULL race_id grupperes ens i SQL og JS", async () => {
  const rows = [
    // NULL stage_number: GROUP BY samler NULL med NULL, det gjorde Map-nøglen også.
    { race_id: RACE_A, stage_number: null, result_type: "gc", rank: 1, rider_id: RIDER_1 },
    { race_id: RACE_A, stage_number: null, result_type: "gc", rank: 1, rider_id: RIDER_1 },
    // NULL race_id (historiske importer): skal tælle som ÉT løb i duplicateRaceCount,
    // ligesom new Set([undefined-nøglen]) gjorde.
    { race_id: null, stage_number: 1, result_type: "gc", rank: 5, rider_id: RIDER_2 },
    { race_id: null, stage_number: 1, result_type: "gc", rank: 5, rider_id: RIDER_2 },
  ];
  const { reference, actual } = await bothWays(rows, 50);
  assertEquivalent(reference, actual);
  assert.equal(reference.duplicateKeyCount, 2);
  assert.equal(reference.duplicateRaceCount, 2); // RACE_A + NULL-løbet
  assert.equal(reference.duplicateKeys[0].stageNumber, null);
  assert.equal(reference.duplicateKeys[1].raceId, null);
});

test("flere brud end loftet: begge veje rapporterer de SAMME første brud", async () => {
  // Seks distinkte rytter-dubletter, indsat så id-rækkefølgen er kendt. Med
  // limit=3 skal begge veje vælge de tre der blev set først.
  const riders = [RIDER_1, RIDER_2, RIDER_3];
  const rows = [];
  let stage = 0;
  for (const race of [RACE_A, RACE_B]) {
    for (const rider of riders) {
      stage += 1;
      rows.push({ race_id: race, stage_number: stage, result_type: "stage", rank: 1, rider_id: rider });
      rows.push({ race_id: race, stage_number: stage, result_type: "stage", rank: 1, rider_id: rider });
    }
  }

  const { reference, actual } = await bothWays(rows, 3);
  assertEquivalent(reference, actual);
  assert.equal(reference.duplicateKeyCount, 6);
  assert.equal(reference.duplicateKeys.length, 3);
  assert.equal(reference.duplicateRaceCount, 2);
  // De tre første er RACE_A's tre, i indsættelses-rækkefølge.
  assert.deepStrictEqual(
    reference.duplicateKeys.map((d) => d.riderId),
    riders,
  );
  assert.deepStrictEqual(
    actual.duplicateKeys.map((d) => d.riderId),
    riders,
  );
});

test("p_limit = 0 giver totaler uden violation-liste, ens i begge veje", async () => {
  const rows = [
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDER_1 },
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDER_1 },
  ];
  const { reference, actual } = await bothWays(rows, 0);
  assertEquivalent(reference, actual);
  assert.equal(reference.duplicateKeyCount, 1);
  assert.deepStrictEqual(reference.duplicateKeys, []);
});

test("funktionen er read-only: et kald muterer ikke race_results", async () => {
  const rows = [
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDER_1 },
    { race_id: RACE_A, stage_number: 1, result_type: "stage", rank: 1, rider_id: RIDER_1 },
    { race_id: RACE_B, stage_number: 1, result_type: "team", rank: null, rider_id: null },
  ];
  await bothWays(rows, 50);
  const before = await db.query("SELECT count(*)::int AS n FROM race_results");
  await db.query("SELECT public.verify_race_result_duplicates(50)");
  const after = await db.query("SELECT count(*)::int AS n FROM race_results");
  assert.equal(after.rows[0].n, before.rows[0].n);
  assert.equal(after.rows[0].n, 3);
});

test("randomiseret sweep: 40 kombinationer af tilfældige rækker giver identisk svar", async () => {
  // Håndplukkede datasæt beviser de kanter jeg kom i tanke om. Denne sweep dækker
  // dem jeg ikke gjorde: rækker trækkes tilfældigt (men deterministisk seedet, så
  // en fejl kan reproduceres) fra et lille domæne hvor kollisioner er hyppige, og
  // hver kørsel sammenlignes felt for felt.
  let seed = 20260829;
  const rand = (n) => {
    // xorshift32: deterministisk, ingen afhængighed af Math.random-implementation.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed % n;
  };

  const races = [RACE_A, RACE_B, null];
  const stages = [1, 2, null];
  const types = ["stage", "gc", "team"];
  const ranks = [1, 2, 3, null];
  const riders = [RIDER_1, RIDER_2, RIDER_3, null];

  for (let iteration = 0; iteration < 40; iteration++) {
    const rows = [];
    const rowCount = 1 + rand(25);
    for (let i = 0; i < rowCount; i++) {
      rows.push({
        race_id: races[rand(races.length)],
        stage_number: stages[rand(stages.length)],
        result_type: types[rand(types.length)],
        rank: ranks[rand(ranks.length)],
        rider_id: riders[rand(riders.length)],
      });
    }
    const limit = rand(4);
    const { reference, actual } = await bothWays(rows, limit);
    assert.deepStrictEqual(actual, reference, `iteration ${iteration} (limit ${limit})`);
    assert.equal(JSON.stringify(actual), JSON.stringify(reference), `iteration ${iteration}`);
  }
});
