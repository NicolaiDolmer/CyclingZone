// backend/lib/engine/v4/segmentLoop.groupTempo.test.ts
// #4914 (kalibreringspakken, punkt 3): grupetto-tempo-KONTAKTEN.
//
// Modellen er et EJER-VALG (tuning.ts's GROUP_TEMPO_EFFORT_EXTRA_TUNING). Disse
// tests laaser to ting uafhaengigt af hvilken model ejeren vaelger:
//   1. DEFAULT-modellen ("cp_only") er praecis den gamle regel — en worker kan
//      ikke komme til at flippe den uden at en test braekker.
//   2. Den alternative model ("effort_weighted") goer det den lover, og
//      bryder hverken monotoni (styrke straffes aldrig) eller giver nogen en
//      bonus over egen CP.
// Udsagnene er skala-uafhaengige; faktorens stoerrelse er en kalibrering.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { groupEffortTempo, groupStrengthSpeedFactor, riderTempoEffortFactor } from "./segmentLoop.ts";
import { grupettoDropBackForced } from "./mechanics/climbSelection.ts";
import { GROUP_TEMPO_EFFORT_EXTRA_TUNING, RACE_V4_TUNING } from "./tuning.ts";
import type { EffortLevel, SegmentKind } from "./types.ts";

const EFFORTS: EffortLevel[] = ["grupetto", "save", "normal", "protect", "all_out"];
const CP_ONLY = { model: "cp_only" as const, grupettoTempoFactor: 0.8 };
const EFFORT_WEIGHTED = { model: "effort_weighted" as const, grupettoTempoFactor: 0.8 };

test("#4914 EJER-GATE: default-modellen er 'cp_only' (b) — en flip kraever ejer-go og en bevidst testaendring", () => {
  assert.equal(GROUP_TEMPO_EFFORT_EXTRA_TUNING.model, "cp_only");
});

test("cp_only: indsats-faktoren er 1 for alle fem trin", () => {
  for (const effort of EFFORTS) assert.equal(riderTempoEffortFactor(effort, CP_ONLY), 1, effort);
  assert.equal(riderTempoEffortFactor(undefined, CP_ONLY), 1);
});

test("effort_weighted: kun grupetto faar en faktor under 1; all_out giver ALDRIG mere end CP", () => {
  for (const effort of EFFORTS) {
    const f = riderTempoEffortFactor(effort, EFFORT_WEIGHTED);
    if (effort === "grupetto") assert.equal(f, EFFORT_WEIGHTED.grupettoTempoFactor);
    else assert.equal(f, 1, effort);
    assert.ok(f <= 1, `${effort}: faktor ${f} ville vaere en bonus over egen CP`);
  }
});

test("effort_weighted: en ugyldig faktor (0, negativ, over 1, NaN) falder tilbage paa 'ingen term'", () => {
  for (const bad of [0, -0.3, 1.4, Number.NaN]) {
    assert.equal(riderTempoEffortFactor("grupetto", { model: "effort_weighted", grupettoTempoFactor: bad }), 1, String(bad));
  }
});

function cpMap(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries);
}

test("cp_only: groupEffortTempo er den gamle regel — front efter CP (rider_id som tie-break), indsats-led 1", () => {
  const cps = cpMap([["r1", 0.3], ["r2", 0.5], ["r3", 0.5], ["r4", 0.2], ["r5", 0.1]]);
  const efforts: Record<string, EffortLevel> = { r1: "normal", r2: "grupetto", r3: "normal", r4: "normal", r5: "grupetto" };
  const out = groupEffortTempo(cps, (id) => efforts[id], 0.4, CP_ONLY);
  assert.deepEqual([...out.frontRiderIds].sort(), ["r2", "r3"]);
  assert.equal(out.collectiveCp, 0.5);
  assert.equal(out.effortTempoFactor, 1);
});

test("effort_weighted: i en blandet gruppe saetter de ikke-grupetto-ryttere tempoet (grupetto sidder paa hjul)", () => {
  // r2 er staerkest paa CP, men hans tempo-bidrag (CP x grupetto-faktor) er
  // under r1's — saa r1 overtager hans plads i fronten.
  const cps = cpMap([["r1", 0.45], ["r2", 0.5], ["r3", 0.5], ["r4", 0.2], ["r5", 0.1]]);
  const efforts: Record<string, EffortLevel> = { r1: "normal", r2: "grupetto", r3: "normal", r4: "normal", r5: "grupetto" };
  const out = groupEffortTempo(cps, (id) => efforts[id], 0.4, EFFORT_WEIGHTED);
  assert.ok(!out.frontRiderIds.has("r2"), "grupetto-rytteren skal ud af fronten naar andre kan koere");
  assert.deepEqual([...out.frontRiderIds].sort(), ["r1", "r3"]);
  assert.equal(out.effortTempoFactor, 1);
});

test("effort_weighted: en gruppe KUN af grupetto-ryttere koerer grupetto-tempo", () => {
  const cps = cpMap([["g1", 0.4], ["g2", 0.3], ["g3", 0.2]]);
  const out = groupEffortTempo(cps, () => "grupetto", 0.2, EFFORT_WEIGHTED);
  assert.equal(out.collectiveCp, 0.4);
  assert.ok(Math.abs(out.effortTempoFactor - EFFORT_WEIGHTED.grupettoTempoFactor) < 1e-12);
});

test("effort_weighted: en gruppe uden grupetto-ryttere er bit-identisk med cp_only", () => {
  const cps = cpMap([["r1", 0.31], ["r2", 0.52], ["r3", 0.47], ["r4", 0.2]]);
  const efforts = (id: string): EffortLevel => (id === "r1" ? "all_out" : id === "r4" ? "save" : "normal");
  assert.deepEqual(groupEffortTempo(cps, efforts, 0.5, EFFORT_WEIGHTED), groupEffortTempo(cps, efforts, 0.5, CP_ONLY));
});

test("groupStrengthSpeedFactor: default indsats-led = uaendret adfaerd; led < 1 koerer langsommere, aldrig hurtigere", () => {
  const kinds: SegmentKind[] = ["flat", "rolling", "climb", "descent", "cobbles"];
  for (const kind of kinds) {
    const base = groupStrengthSpeedFactor(0.25, 0.3, kind, RACE_V4_TUNING);
    assert.equal(groupStrengthSpeedFactor(0.25, 0.3, kind, RACE_V4_TUNING, 1), base, kind);
    assert.ok(groupStrengthSpeedFactor(0.25, 0.3, kind, RACE_V4_TUNING, 0.8) < base, kind);
    // Et led over 1 clampes: indsats kan aldrig give fart over egen CP.
    assert.equal(groupStrengthSpeedFactor(0.25, 0.3, kind, RACE_V4_TUNING, 1.5), base, kind);
  }
});

test("tilbagefald paa stigninger: aldrig i cp_only; i effort_weighted kun grupetto-ryttere i en gruppe hvor andre koerer", () => {
  for (const effort of EFFORTS) {
    assert.equal(grupettoDropBackForced(effort, true, CP_ONLY), false, `cp_only/${effort}`);
    assert.equal(grupettoDropBackForced(effort, true, EFFORT_WEIGHTED), effort === "grupetto", `effort_weighted/${effort}`);
  }
  // En gruppe der KUN er grupetto-ryttere ER den sidste gruppe — den splittes ikke op.
  assert.equal(grupettoDropBackForced("grupetto", false, EFFORT_WEIGHTED), false);
  // Default-tuningen (cp_only) tvinger aldrig nogen tilbage.
  assert.equal(grupettoDropBackForced("grupetto", true), false);
});

test("INVARIANT 3 (fast-check): med SAMME indsats-led er farten monotont ikke-faldende i gruppens CP", () => {
  fc.assert(
    fc.property(
      fc.float({ min: 0, max: 1, noNaN: true }),
      fc.float({ min: 0, max: 1, noNaN: true }),
      fc.float({ min: Math.fround(0.05), max: 1, noNaN: true }),
      fc.float({ min: Math.fround(0.05), max: 1, noNaN: true }),
      (a, b, ref, effort) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const slow = groupStrengthSpeedFactor(lo, ref, "climb", RACE_V4_TUNING, effort);
        const fast = groupStrengthSpeedFactor(hi, ref, "climb", RACE_V4_TUNING, effort);
        assert.ok(fast >= slow - 1e-12, `CP ${hi} (${fast}) < CP ${lo} (${slow}) ved led ${effort}`);
      },
    ),
    { numRuns: 200, seed: 4914 },
  );
});
