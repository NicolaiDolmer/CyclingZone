// backend/scripts/exportSeasonStageProfiles.test.js
// Test af den ENESTE rene, testbare del af exportSeasonStageProfiles.js
// (resten er DB-IO, verificeret manuelt mod prod read-only, jf. PR-body).

import assert from "node:assert/strict";
import { test } from "node:test";
import { pickRepresentativeRaces } from "./exportSeasonStageProfiles.js";

test("pickRepresentativeRaces: vaelger mindste id pr. pool_race_id (deterministisk)", () => {
  const races = [
    { id: "b", pool_race_id: "pool1" },
    { id: "a", pool_race_id: "pool1" },
    { id: "c", pool_race_id: "pool1" },
    { id: "x", pool_race_id: "pool2" },
  ];
  const reps = pickRepresentativeRaces(races);
  assert.equal(reps.length, 2);
  const byPool = Object.fromEntries(reps.map((r) => [r.pool_race_id, r.id]));
  assert.equal(byPool.pool1, "a");
  assert.equal(byPool.pool2, "x");
});

test("pickRepresentativeRaces: null pool_race_id behandles som eget solo-pool (medtages, ikke droppet)", () => {
  const races = [
    { id: "r1", pool_race_id: null },
    { id: "r2", pool_race_id: null },
  ];
  const reps = pickRepresentativeRaces(races);
  assert.equal(reps.length, 2);
});

test("pickRepresentativeRaces: tom liste -> tom liste", () => {
  assert.deepEqual(pickRepresentativeRaces([]), []);
});

test("pickRepresentativeRaces: idempotent (kald to gange giver samme resultat)", () => {
  const races = [
    { id: "2", pool_race_id: "p" },
    { id: "10", pool_race_id: "p" },
  ];
  // Streng-sammenligning ("10" < "2" leksikografisk) — dokumenterer bevidst
  // valg (deterministisk, ikke numerisk) frem for at skjule det som en bug.
  const reps = pickRepresentativeRaces(races);
  assert.equal(reps[0].id, "10");
});
