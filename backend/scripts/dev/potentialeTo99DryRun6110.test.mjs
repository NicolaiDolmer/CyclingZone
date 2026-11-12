// #3564: tests for dry-run-scriptet. Syntetiske params og ryttere, ingen DB.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ageOn,
  buildDryRunReport,
  parseParams,
  renderMarkdown,
  resolveOutDir,
  toRiderInputs,
} from "./potentialeTo99DryRun6110.mjs";

const SYNTH = {
  tierStep: 9,
  tierHalfWidth: 4,
  tierDecay: 0.6,
  compressFromPotentiale: 4,
  tailAnchors: [69.5, 79.5, 89.5],
  floors: [
    { potentiale: 5.5, floor: 72, hardCap: 78 },
    { potentiale: 6, floor: 78, hardCap: 85 },
  ],
  ageBands: [
    { key: "young", lo: 15, hi: 20 },
    { key: "old", lo: 21, hi: 45 },
  ],
};

const SCRIPT = path.join(import.meta.dirname, "potentialeTo99DryRun6110.mjs");

function rows(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `r${i}`, age: 15 + (i % 25), potentiale: 1 + (i % 11) * 0.5 });
  }
  return out;
}

test("scriptet skriver aldrig til databasen: ingen skrive-kald i kilden", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  for (const call of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
    assert.ok(!src.includes(call), `forbudt kald ${call}`);
  }
  // Den eneste tabel der læses er riders, og kun via select.
  assert.deepEqual([...src.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]), ["riders"]);
  assert.ok(!/base_talent/.test(src.replace(/^\s*\/\/.*$/gm, "")), "base_talent må ikke optræde i koden");
});

test("OUT_DIR skal ligge under balance-internals", () => {
  const root = path.resolve("/tmp/repo");
  assert.equal(resolveOutDir(undefined, root), path.join(root, "balance-internals", "6110"));
  assert.equal(resolveOutDir(path.join(root, "balance-internals", "6110", "x")), path.join(root, "balance-internals", "6110", "x"));
  // Navnet her må ikke være en rigtig topmappe i repoet: CI's backend-klassifikator
  // (scripts/ci/backend-test-shards.mjs) ville ellers læse det som en afhængighed.
  assert.throws(() => resolveOutDir(path.join(root, "offentlig-mappe")), /balance-internals/);
  assert.throws(() => resolveOutDir(path.join(root, "balance-internals-public")), /balance-internals/);
});

test("params uden standardtal: tom eller ugyldig fil afvises, indlejret nøgle accepteres", () => {
  assert.throws(() => parseParams({}), /tierStep/);
  assert.throws(() => parseParams(null), /params mangler/);
  assert.deepEqual(parseParams(SYNTH), SYNTH);
  assert.deepEqual(parseParams({ potentialeScale99: SYNTH, note: "x" }), SYNTH);
});

test("ageOn regner hele år og tåler manglende dato", () => {
  const asOf = new Date("2026-11-12T00:00:00Z");
  assert.equal(ageOn("2000-11-12", asOf), 26);
  assert.equal(ageOn("2000-11-13", asOf), 25);
  assert.equal(ageOn(null, asOf), null);
  assert.equal(ageOn("ikke-en-dato", asOf), null);
});

test("toRiderInputs bruger snapshot-alder eller fødselsdato og tæller manglende potentiale", () => {
  const asOf = new Date("2026-11-12T00:00:00Z");
  const { riders, missingPotentiale } = toRiderInputs(
    [
      { id: "a", age: 22, potentiale: 3 },
      { id: "b", birthdate: "2004-01-01", potentiale: "4.5" },
      { id: "c", birthdate: "2004-01-01", potentiale: null },
    ],
    asOf,
  );
  assert.equal(missingPotentiale, 1);
  assert.deepEqual(riders, [
    { id: "a", potentiale: 3, age: 22 },
    { id: "b", potentiale: 4.5, age: 22 },
  ]);
});

test("rapporten: alle omregnet, ingen rang- eller gulv-brud, writes=none, deterministisk", () => {
  const asOf = new Date("2026-11-12T00:00:00Z");
  const input = rows(2000);
  const a = buildDryRunReport(input, SYNTH, { asOf, source: "syntetisk" });
  const b = buildDryRunReport([...input].reverse(), SYNTH, { asOf, source: "syntetisk" });
  assert.equal(a.writes, "none");
  assert.equal(a.counts.scaled, 2000);
  assert.equal(a.counts.skipped, 0);
  assert.equal(a.rankViolations, 0);
  assert.ok(a.floorBreaches.every((f) => f.below === 0));
  assert.ok(a.counts.topClass > 0);
  const byIdA = new Map(a.riders.map((r) => [r.id, r.pot99]));
  for (const r of b.riders) assert.equal(r.pot99, byIdA.get(r.id));
  const md = renderMarkdown(a);
  assert.match(md, /Rang-brud: 0/);
  assert.match(md, /### young/);
});

test("rapporten tæller ryttere der springes over", () => {
  const asOf = new Date("2026-11-12T00:00:00Z");
  const report = buildDryRunReport(
    [
      { id: "ok", age: 20, potentiale: 2 },
      { id: "kid", age: 10, potentiale: 2 },
      { id: "odd", age: 20, potentiale: 2.2 },
    ],
    SYNTH,
    { asOf, source: "syntetisk" },
  );
  assert.equal(report.counts.scaled, 1);
  assert.deepEqual(report.counts.skippedByReason, { no_age_band: 1, invalid_potentiale: 1 });
});
