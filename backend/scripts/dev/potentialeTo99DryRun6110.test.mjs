// #3564: tests for dry-run-scriptet. Syntetiske params og ryttere, ingen DB.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ageForSeason } from "../../lib/riderSeasonAge.js";
import {
  buildDryRunReport,
  parseParams,
  renderMarkdown,
  resolveOutDir,
  snapshotSeasonNumber,
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

// Sæson 1: sæson-alder = 2026 - fødselsår (riderSeasonAge.ageForSeason).
const SEASON = 1;
const born = (age) => `${2026 - age}-06-01`;

function rows(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `r${i}`, birthdate: born(15 + (i % 25)), potentiale: 1 + (i % 11) * 0.5 });
  }
  return out;
}

test("scriptet skriver aldrig til databasen: ingen skrive-kald i kilden", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  for (const call of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
    assert.ok(!src.includes(call), `forbudt kald ${call}`);
  }
  // Kun seasons (aktivt sæsonnummer) og riders læses, og kun via select.
  assert.deepEqual([...src.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]).sort(), ["riders", "seasons"]);
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

test("toRiderInputs bruger sæson-alder (ikke kalenderalder) og tæller manglende potentiale", () => {
  const season = 4;
  const { riders, missingPotentiale } = toRiderInputs(
    [
      { id: "b", birthdate: "2008-12-01", potentiale: "4.5" },
      { id: "c", birthdate: "2004-01-01", potentiale: null },
      { id: "d", birthdate: null, potentiale: 2 },
    ],
    season,
  );
  assert.equal(missingPotentiale, 1);
  assert.deepEqual(riders, [
    // Samme tal som spillets egen SSOT, uanset fødselsdag i året.
    { id: "b", potentiale: 4.5, age: ageForSeason("2008-12-01", season) },
    { id: "d", potentiale: 2, age: null },
  ]);
});

test("Codex-fund PR #8046: et snapshots kalenderalder vinder aldrig over sæson-alderen", () => {
  // Snapshot-række (snapshot-6110-potential-estimate.mjs): age er kalenderalder.
  const snap = { id: "s", age: 19, birthdate: "2006-12-31", potentiale: 3 };
  const live = { id: "s", birthdate: "2006-12-31", potentiale: 3 };
  for (const season of [1, 3]) {
    const fromSnap = toRiderInputs([snap], season).riders[0];
    assert.equal(fromSnap.age, ageForSeason("2006-12-31", season));
    assert.deepEqual(fromSnap, toRiderInputs([live], season).riders[0], "snapshot og live giver samme input");
  }
  // Og dermed samme aldersbånd og samme omregning i begge tilstande.
  const asOf = new Date("2026-11-12T00:00:00Z");
  const snapRows = rows(400).map((r, i) => ({ ...r, age: 99 - (i % 30) }));
  const a = buildDryRunReport(snapRows, SYNTH, { asOf, source: "snapshot", seasonNumber: SEASON });
  const b = buildDryRunReport(rows(400), SYNTH, { asOf, source: "live", seasonNumber: SEASON });
  assert.deepEqual(a.riders, b.riders);
  assert.deepEqual(a.perBand, b.perBand);
});

test("Codex-fund PR #8046: snapshots uden birthdate eller sæsonnummer afvises med klar fejl", () => {
  assert.throws(() => toRiderInputs([{ id: "old", age: 22, potentiale: 3 }], 1), /mangler birthdate.*nyt snapshot/);
  assert.throws(() => toRiderInputs([{ id: "b", birthdate: "2004-01-01", potentiale: 3 }], undefined), /Sæsonnummer mangler/);
  // Rytter uden potentiale tælles stadig, selv uden birthdate.
  assert.equal(toRiderInputs([{ id: "c", age: 22, potentiale: null }], 1).missingPotentiale, 1);
  // Sæsonnummeret: SEASON vinder, ellers meta.json, ellers stop.
  assert.equal(snapshotSeasonNumber(5, { season_number: 2 }), 5);
  assert.equal(snapshotSeasonNumber(undefined, { season_number: 2 }), 2);
  assert.throws(() => snapshotSeasonNumber(undefined, null), /season_number/);
  assert.throws(() => snapshotSeasonNumber(undefined, { season_number: null }), /season_number/);
});

test("rapporten: alle omregnet, ingen rang- eller gulv-brud, writes=none, deterministisk", () => {
  const asOf = new Date("2026-11-12T00:00:00Z");
  const input = rows(2000);
  const a = buildDryRunReport(input, SYNTH, { asOf, source: "syntetisk", seasonNumber: SEASON });
  const b = buildDryRunReport([...input].reverse(), SYNTH, { asOf, source: "syntetisk", seasonNumber: SEASON });
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
      { id: "ok", birthdate: born(20), potentiale: 2 },
      { id: "kid", birthdate: born(10), potentiale: 2 },
      { id: "odd", birthdate: born(20), potentiale: 2.2 },
    ],
    SYNTH,
    { asOf, source: "syntetisk", seasonNumber: SEASON },
  );
  assert.equal(report.counts.scaled, 1);
  assert.deepEqual(report.counts.skippedByReason, { no_age_band: 1, invalid_potentiale: 1 });
});
