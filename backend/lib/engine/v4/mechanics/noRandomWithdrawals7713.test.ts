// backend/lib/engine/v4/mechanics/noRandomWithdrawals7713.test.ts
// #7713 (ejer 5/11): ryttere stiger ikke tilfaeldigt af. Motoren trak foer lod efter
// maalstregen (#6938 U3/U4); nu udgaar en rytter kun af en aegte aarsag.
//
// Facit er FROSSET fra merge-basen, foer rettelsen (noRandomWithdrawals7713Base.json,
// hashes fra __fixtures__/noRandomWithdrawals7713Scenarios.js). Den maa aldrig
// genereres med den nye kode: saa flytter facit med, og testen beviser intet (#7587).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digest7713, scenarios7713 } from "../../../__fixtures__/noRandomWithdrawals7713Scenarios.js";
import { simulateStageV4 } from "../index.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "fixtures");
const frozen = JSON.parse(readFileSync(path.join(HERE, "..", "..", "..", "__fixtures__", "noRandomWithdrawals7713Base.json"), "utf8"));

test("#7713: den frosne reference ramte lodtraekningen i baade endagsloeb og etapeloeb", () => {
  const hit = Object.entries<{ had_withdrawal: boolean }>(frozen.digests).filter(([, digest]) => digest.had_withdrawal).map(([id]) => id);
  for (const context of ["one_day", "first_stage", "standings"]) {
    assert.ok(hit.some((id) => id.includes(`/${context}/`)), `${context}: testen skal kunne fejle paa den gamle kode`);
  }
});

test("#7713: ingen rytter stiger af efter maalstregen i noget scenarie", () => {
  for (const { id, input } of scenarios7713(FIXTURES)) {
    const output = simulateStageV4(input);
    assert.ok(!(output.incidents ?? []).some((incident) => (incident.kind as string) === "withdrawal"), id);
    const abandoned = output.results.filter((row) => row.status === "abandoned").map((row) => row.rider_id).sort();
    const named = (output.incidents ?? []).filter((incident) => incident.outcome === "abandoned").map((incident) => incident.rider_id).sort();
    assert.deepEqual(abandoned, named, `${id}: hver udgaaet rytter har en navngivet aarsag`);
  }
});

test("#7713: styrt, tider, grupper, belastning og tidsgraense er uaendrede mod merge-basen", () => {
  const now = digest7713(simulateStageV4, FIXTURES) as Record<string, { projection: string }>;
  assert.deepEqual(Object.keys(now), Object.keys(frozen.digests));
  for (const [id, digest] of Object.entries<{ projection: string }>(frozen.digests)) {
    assert.equal(now[id].projection, digest.projection, id);
  }
});
