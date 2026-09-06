// backend/lib/engine/v4/rng.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { boundRngFor, gaussian, mulberry32, rngFor, segmentRngFor, segmentStreamKey, stableSeed } from "./rng.ts";

test("stableSeed: deterministisk og uafhaengig af foregaaende kald", () => {
  assert.equal(stableSeed("hello"), stableSeed("hello"));
  assert.notEqual(stableSeed("hello"), stableSeed("world"));
  assert.ok(Number.isInteger(stableSeed("x")) && stableSeed("x") >= 0);
});

test("mulberry32: deterministisk stream, forskellige seeds giver forskellige streams", () => {
  const a1 = mulberry32(42);
  const a2 = mulberry32(42);
  const seqA1 = [a1(), a1(), a1()];
  const seqA2 = [a2(), a2(), a2()];
  assert.deepEqual(seqA1, seqA2);

  const b = mulberry32(43);
  assert.notDeepEqual(seqA1, [b(), b(), b()]);
});

test("mulberry32: uniform i [0,1)", () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `v=${v} uden for [0,1)`);
  }
});

test("gaussian: gennemsnit og sd naermer sig de anmodede vaerdier over mange traek", () => {
  const rng = mulberry32(123);
  const samples: number[] = [];
  for (let i = 0; i < 4000; i++) samples.push(gaussian(rng, 10, 2));
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
  assert.ok(Math.abs(mean - 10) < 0.3, `mean=${mean}`);
  assert.ok(Math.abs(Math.sqrt(variance) - 2) < 0.3, `sd=${Math.sqrt(variance)}`);
});

test("rngFor: dedikerede streams pr. (seed, mechanic, riderId) - ingen krydskontaminering", () => {
  const a = rngFor("stage-1", "dayform", "rider-a")();
  const b = rngFor("stage-1", "dayform", "rider-b")();
  const c = rngFor("stage-1", "joursans", "rider-a")();
  assert.notEqual(a, b, "to ryttere i samme mekanik skal have forskellige streams");
  assert.notEqual(a, c, "samme rytter i to mekanikker skal have forskellige streams");
  assert.equal(rngFor("stage-1", "dayform", "rider-a")(), a, "samme (seed,mechanic,riderId) er deterministisk");
});

test("rngFor: mekanik-stream uden riderId er stabil og adskilt fra per-rytter-streams", () => {
  const global1 = rngFor("stage-1", "route")();
  const global2 = rngFor("stage-1", "route")();
  assert.equal(global1, global2);
  const perRider = rngFor("stage-1", "route", "rider-a")();
  assert.notEqual(global1, perRider);
});

test("rngFor: en ekstra rytter i feltet flytter ALDRIG en andens per-rytter-stream", () => {
  // Simulerer "én tilmelding mere" — streamen for rider-a er uafhaengig af
  // hvilke andre riderIds der nogensinde forespoerges.
  const before = rngFor("stage-9", "dayform", "rider-a")();
  // "Tilmeld" ti nye ryttere ved at forbruge deres streams foerst.
  for (let i = 0; i < 10; i++) rngFor("stage-9", "dayform", `extra-${i}`)();
  const after = rngFor("stage-9", "dayform", "rider-a")();
  assert.equal(before, after);
});

// ── #4886: segment-noeglen er kernens default, ikke hver mekaniks disciplin ──

test("segmentRngFor: samme (mekanik, rytter) paa TO segmenter giver forskellige lodtraekninger", () => {
  const stage = boundRngFor("stage-4886");
  // Gammel form (den fejlen bestod i): hooksene fik `stage` direkte, saa begge
  // segmenter kaldte samme (seed, mekanik, rider_id) og fik samme foerste tal.
  assert.equal(stage("breakaway_join", "r1")(), stage("breakaway_join", "r1")());

  const s0 = segmentRngFor(stage, 0);
  const s1 = segmentRngFor(stage, 1);
  assert.notEqual(
    s0("breakaway_join", "r1")(),
    s1("breakaway_join", "r1")(),
    "samme rytter fik samme foerste lodtraekning paa to segmenter — streamen er ikke segment-noeglet (#4886)",
  );
});

test("segmentRngFor: SAMME segment er fuldt deterministisk", () => {
  const stage = boundRngFor("stage-4886");
  assert.equal(segmentRngFor(stage, 3)("descent_incident", "r1")(), segmentRngFor(stage, 3)("descent_incident", "r1")());
});

test("segmentRngFor: en ekstra rytter i feltet flytter ALDRIG en andens segment-stream (invariant 1)", () => {
  const stage = boundRngFor("stage-4886");
  const before = segmentRngFor(stage, 5)("climbSelection", "rider-a")();
  for (let i = 0; i < 10; i++) segmentRngFor(stage, 5)("climbSelection", `extra-${i}`)();
  assert.equal(segmentRngFor(stage, 5)("climbSelection", "rider-a")(), before);
});

test("segmentRngFor: noeglen er `<mekanik>:s<n>` — mekanikker maa ikke selv laegge suffikset paa", () => {
  const stage = boundRngFor("stage-4886");
  assert.equal(segmentStreamKey("incident", 3), "incident:s3");
  // Praecis den form incidents.ts/cobbles.ts selv bar indtil 6/9: laegger en
  // mekanik suffikset paa OVEN i kernens, bliver streamen dobbelt-noeglet.
  assert.equal(segmentRngFor(stage, 3)("incident", "r1")(), stage("incident:s3", "r1")());
  assert.notEqual(segmentRngFor(stage, 3)("incident:s3", "r1")(), stage("incident:s3", "r1")());
});

test("boundRngFor: seed-bundet variant matcher rngFor 1:1", () => {
  const bound = boundRngFor("stage-42");
  assert.equal(bound("descent", "r1")(), rngFor("stage-42", "descent", "r1")());
});
