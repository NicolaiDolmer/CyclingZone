// Tests for balance-snapshot-harnessen (#1197).
//
// Kernen er determinisme: samme options → bit-identisk snapshot. Det er hele
// kontrakten bag committede baselines (enhver diff = reel balance-ændring).

import test from "node:test";
import assert from "node:assert/strict";

import {
  BALANCE_SNAPSHOT_DEFAULTS,
  SNAPSHOT_FORMAT_VERSION,
  buildBalanceSnapshot,
  diffSnapshots,
  flattenSnapshot,
  renderDiffMarkdown,
  renderSnapshotMarkdown,
} from "./balanceSnapshot.js";

// Lille men repræsentativ konfiguration — holder testen hurtig.
const SMALL = { seed: 42, count: 120, races: 10, fieldSize: 40, gtField: 48, seasons: 2 };

const snapshot = buildBalanceSnapshot(SMALL);

test("buildBalanceSnapshot er deterministisk: samme options → identisk snapshot", () => {
  const again = buildBalanceSnapshot(SMALL);
  assert.deepEqual(again, snapshot);
});

test("buildBalanceSnapshot reagerer på seed (forskellig population → forskelligt snapshot)", () => {
  const other = buildBalanceSnapshot({ ...SMALL, seed: 7 });
  assert.notDeepEqual(other, snapshot);
  assert.ok(diffSnapshots(snapshot, other).length > 0);
});

test("snapshot har de tre balance-sektioner + meta uden timestamps", () => {
  assert.equal(snapshot.formatVersion, SNAPSHOT_FORMAT_VERSION);
  assert.equal(snapshot.meta.seed, SMALL.seed);
  for (const section of ["population", "race", "progression"]) {
    assert.ok(snapshot[section], `mangler sektion: ${section}`);
  }
  // Ingen volatile felter: serialiseret snapshot må ikke indeholde ISO-timestamps
  // (valuationModelFittedAt er bevidst med — den ÆNDRES kun ved re-fit og SKAL diffe).
  const { valuationModelFittedAt: _ignored, ...meta } = snapshot.meta;
  assert.ok(!JSON.stringify({ ...snapshot, meta }).match(/\d{4}-\d{2}-\d{2}T\d{2}:/), "fandt tids-stempel i snapshot");
});

test("population-sektionen dækker værdimodellen (type-mix + base_value-percentiler)", () => {
  assert.equal(snapshot.population.n, SMALL.count);
  const mixSum = Object.values(snapshot.population.typeMix).reduce((a, b) => a + b, 0);
  assert.equal(mixSum, SMALL.count);
  assert.ok(snapshot.population.baseValue.p50 > 0);
  for (const [type, row] of Object.entries(snapshot.population.baseValueByType)) {
    assert.ok(row.n > 0, `tom type-række: ${type}`);
    assert.ok(row.p50 <= row.max, `p50 > max for ${type}`);
  }
});

test("race-sektionen dækker alle terræner + GT-top-10", () => {
  const terrains = Object.keys(snapshot.race.terrains);
  for (const t of ["flat", "mountain", "itt", "cobbles", "hilly", "high_mountain", "rolling", "classic"]) {
    assert.ok(terrains.includes(t), `mangler terræn: ${t}`);
    const wins = Object.values(snapshot.race.terrains[t].winnersBornAs).reduce((a, b) => a + b, 0);
    assert.equal(wins, SMALL.races, `vinder-histogram ≠ antal løb for ${t}`);
  }
  assert.equal(snapshot.race.grandTour.gcTop10.length, 10);
  assert.equal(snapshot.race.grandTour.gcTop10[0].rank, 1);
});

test("progression-sektionen simulerer N sæsoner", () => {
  assert.equal(snapshot.progression.seasons, SMALL.seasons);
  assert.equal(snapshot.progression.retiredPerSeason.length, SMALL.seasons);
  assert.ok(snapshot.progression.simulatedRiders > 0);
  assert.ok(snapshot.progression.u25AbilitySumDeltaPerSeason.p50 != null);
});

test("diffSnapshots: identiske snapshots → tom diff", () => {
  assert.deepEqual(diffSnapshots(snapshot, buildBalanceSnapshot(SMALL)), []);
});

test("diffSnapshots opdager changed/added/removed med præcise stier", () => {
  const mutated = structuredClone(snapshot);
  mutated.population.baseValue.p50 = (mutated.population.baseValue.p50 ?? 0) + 1000;
  delete mutated.race.terrains.flat;
  mutated.meta.newKnob = 1;

  const diffs = diffSnapshots(snapshot, mutated);
  const changed = diffs.find((d) => d.path === "population.baseValue.p50");
  assert.equal(changed?.kind, "changed");
  assert.equal(changed.after - changed.before, 1000);
  assert.ok(diffs.some((d) => d.kind === "removed" && d.path.startsWith("race.terrains.flat")));
  assert.ok(diffs.some((d) => d.kind === "added" && d.path === "meta.newKnob"));
});

test("flattenSnapshot giver leaf-paths inkl. array-indeks", () => {
  const flat = flattenSnapshot({ a: { b: [1, { c: 2 }] }, d: null });
  assert.equal(flat.get("a.b[0]"), 1);
  assert.equal(flat.get("a.b[1].c"), 2);
  assert.equal(flat.get("d"), null);
});

test("markdown-rendering: tom diff = grøn, ikke-tom = bump-instruktion", () => {
  assert.match(renderDiffMarkdown([]), /✅ Tom diff/);
  const md = renderDiffMarkdown(diffSnapshots(snapshot, buildBalanceSnapshot({ ...SMALL, seed: 7 })));
  assert.match(md, /npm run balance:baseline/);
  assert.match(md, /\| Sti \| Baseline \| Ny \| Δ \|/);
});

test("snapshot-markdown indeholder alle sektioner", () => {
  const md = renderSnapshotMarkdown(snapshot);
  for (const heading of ["## Population", "## Race-motor", "### Grand Tour", "## Progression"]) {
    assert.ok(md.includes(heading), `mangler overskrift: ${heading}`);
  }
});

test("defaults matcher race:gate-kalibreringen (seed 2026, 800 ryttere)", () => {
  assert.equal(BALANCE_SNAPSHOT_DEFAULTS.seed, 2026);
  assert.equal(BALANCE_SNAPSHOT_DEFAULTS.count, 800);
});
