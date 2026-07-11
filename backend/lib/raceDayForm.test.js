// Race Engine v3 (#2224), slice S2 (#2353) — dagsform + jour sans (spec §7).
import test from "node:test";
import assert from "node:assert/strict";

import { dayFormComponent, jourSansComponent, jourSansProbability } from "./raceDayForm.js";
import { RACE_V3_TUNING } from "./raceRoles.js";
import { simulateStage, ABILITY_KEYS } from "./raceSimulator.js";
import { RACE_V3_TUNING as T } from "./raceRoles.js";

// ── dayFormComponent ──────────────────────────────────────────────────────────

test("dagsform: deterministisk — samme (rytter, stageSeed) → samme værdi", () => {
  const a = dayFormComponent({ riderId: "r1", stageSeed: 12345 });
  const b = dayFormComponent({ riderId: "r1", stageSeed: 12345 });
  assert.equal(a, b);
});

test("dagsform: per-rytter-hashet — uafhængig af andre ryttere, varierer over rytter OG seed", () => {
  const r1s1 = dayFormComponent({ riderId: "r1", stageSeed: 1 });
  const r2s1 = dayFormComponent({ riderId: "r2", stageSeed: 1 });
  const r1s2 = dayFormComponent({ riderId: "r1", stageSeed: 2 });
  assert.notEqual(r1s1, r2s1, "to ryttere samme etape skal have forskellig dagsform");
  assert.notEqual(r1s1, r1s2, "samme rytter to etaper skal have forskellig dagsform");
});

test("dagsform: fordelingen har ~0 middelværdi og ~sd som konfigureret (5.000 træk)", () => {
  const sd = 0.015;
  const xs = [];
  for (let i = 0; i < 5000; i++) xs.push(dayFormComponent({ riderId: `r${i}`, stageSeed: 42, sd }));
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  assert.ok(Math.abs(mean) < 0.001, `mean ${mean} skal være ~0`);
  assert.ok(Math.abs(Math.sqrt(variance) - sd) < 0.002, `sd ${Math.sqrt(variance)} skal være ~${sd}`);
});

test("dagsform: sd=0 → altid 0 (kill via tuning)", () => {
  assert.equal(dayFormComponent({ riderId: "r1", stageSeed: 1, sd: 0 }), 0);
});

// ── jourSansProbability (form-kobling) ────────────────────────────────────────

test("jour sans p: base ved manglende form; 5/3×base ved lav form; 2/3×base ved høj form; lineær imellem", () => {
  const base = RACE_V3_TUNING.JOUR_SANS_P_BASE;
  assert.equal(jourSansProbability(null), base);
  assert.equal(jourSansProbability(undefined), base);
  assert.equal(jourSansProbability("garbage"), base);
  assert.ok(Math.abs(jourSansProbability(40) - base * 5 / 3) < 1e-12, "form=40 → base×5/3");
  assert.ok(Math.abs(jourSansProbability(10) - base * 5 / 3) < 1e-12, "form<40 clamper til lav-form-raten");
  assert.ok(Math.abs(jourSansProbability(70) - base * 2 / 3) < 1e-12, "form=70 → base×2/3");
  assert.ok(Math.abs(jourSansProbability(95) - base * 2 / 3) < 1e-12, "form>70 clamper til høj-form-raten");
  // Multiplikator 1.0 (p = base) rammes ved form 60: 5/3 + (60-40)/30 × (2/3 − 5/3) = 1.
  const p60 = jourSansProbability(60);
  assert.ok(Math.abs(p60 - base) < 1e-12, `form=60 → base, fik ${p60}`);
  assert.ok(jourSansProbability(45) > jourSansProbability(65), "monotont faldende i form");
});

test("jour sans p: ved spec-basen 3% er ekstremerne præcis 5% og 2% (spec §7 ordret)", () => {
  const t = { ...RACE_V3_TUNING, JOUR_SANS_P_BASE: 0.03 };
  assert.ok(Math.abs(jourSansProbability(30, t) - 0.05) < 1e-12);
  assert.ok(Math.abs(jourSansProbability(80, t) - 0.02) < 1e-12);
});

// ── jourSansComponent ─────────────────────────────────────────────────────────

test("jour sans: deterministisk; udfald er 0 ELLER i [-MAX, -MIN]", () => {
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    const v = jourSansComponent({ riderId: `r${i}`, stageSeed: 7 });
    assert.equal(v, jourSansComponent({ riderId: `r${i}`, stageSeed: 7 }), "deterministisk");
    if (v !== 0) {
      hits++;
      assert.ok(v <= -RACE_V3_TUNING.JOUR_SANS_MAGNITUDE_MIN && v >= -RACE_V3_TUNING.JOUR_SANS_MAGNITUDE_MAX,
        `udfald ${v} udenfor [-${RACE_V3_TUNING.JOUR_SANS_MAGNITUDE_MAX}, -${RACE_V3_TUNING.JOUR_SANS_MAGNITUDE_MIN}]`);
    }
  }
  // Rate-sanity (base-p uden form): binomial 2000×p → bredt bånd, fanger kun grove fejl.
  const p = RACE_V3_TUNING.JOUR_SANS_P_BASE;
  assert.ok(hits > 2000 * p * 0.5 && hits < 2000 * p * 1.8, `realiseret rate ${hits}/2000 langt fra p=${p}`);
});

test("jour sans: lav form rammes oftere end høj form (form-koblingen virker i udfaldet)", () => {
  let lowHits = 0, highHits = 0;
  for (let i = 0; i < 4000; i++) {
    if (jourSansComponent({ riderId: `r${i}`, stageSeed: 9, form: 30 }) !== 0) lowHits++;
    if (jourSansComponent({ riderId: `r${i}`, stageSeed: 9, form: 85 }) !== 0) highHits++;
  }
  assert.ok(lowHits > highHits * 1.5, `lav form (${lowHits}) skal kollapse markant oftere end høj form (${highHits})`);
});

test("jour sans: p=0 (tuning-kill) → altid 0", () => {
  const tuning = { ...RACE_V3_TUNING, JOUR_SANS_P_BASE: 0 };
  for (let i = 0; i < 200; i++) {
    assert.equal(jourSansComponent({ riderId: `r${i}`, stageSeed: 3, tuning }), 0);
  }
});

// ── Integration i simulateStage (v3) ──────────────────────────────────────────

function abil(v) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = v;
  return a;
}

test("simulateStage v3: dayform/jour_sans i components; v3-off → begge 0; finalScore = komponentsum", () => {
  const entrants = Array.from({ length: 30 }, (_, i) => ({ rider_id: `r${i}`, abilities: abil(50 + (i % 20)) }));
  const stage = { profile_type: "mountain", demand_vector: { climbing: 0.7, endurance: 0.3, randomness: 0.3 } };

  const off = simulateStage({ entrants, stageProfile: stage, seed: 77, v3: false });
  for (const r of off.ranked) {
    assert.equal(r.components.dayform, 0);
    assert.equal(r.components.jour_sans, 0);
  }

  const on = simulateStage({ entrants, stageProfile: stage, seed: 77, v3: true });
  assert.ok(on.ranked.some((r) => r.components.dayform !== 0), "v3: dagsform skal være aktiv");
  for (const r of on.ranked) {
    const c = r.components;
    const sum = c.terrain + c.noise + c.form - c.fatigue + c.team + c.breakaway + c.finale + c.work_cost + c.dayform + c.jour_sans;
    assert.ok(Math.abs(sum - r.finalScore) < 1e-12, "finalScore matcher ikke komponenterne (v3)");
    assert.ok(c.jour_sans <= 0, "jour_sans er altid ≤ 0");
  }
});

test("simulateStage v3: S2-streams forskyder IKKE noise (bit-identisk noise on/off)", () => {
  const entrants = Array.from({ length: 10 }, (_, i) => ({ rider_id: `x${i}`, abilities: abil(60) }));
  const stage = { profile_type: "hilly", demand_vector: { punch: 0.6, endurance: 0.4, randomness: 1 } };
  const off = simulateStage({ entrants, stageProfile: stage, seed: 555, v3: false });
  const on = simulateStage({ entrants, stageProfile: stage, seed: 555, v3: true });
  for (const id of entrants.map((e) => e.rider_id)) {
    assert.equal(
      off.ranked.find((r) => r.rider_id === id).components.noise,
      on.ranked.find((r) => r.rider_id === id).components.noise,
      `noise for ${id} må ikke flytte sig når v3 aktiveres`
    );
  }
});

test("simulateStage v3: en rytters dagsform er UAFHÆNGIG af feltets sammensætning (per-rytter-hash, spec §5)", () => {
  const stage = { profile_type: "mountain", demand_vector: { climbing: 0.7, endurance: 0.3, randomness: 0 } };
  const subject = { rider_id: "subject", abilities: abil(60) };
  const smallField = [subject, { rider_id: "a", abilities: abil(55) }, { rider_id: "b", abilities: abil(50) }, { rider_id: "c", abilities: abil(45) }];
  const bigField = [...smallField, ...Array.from({ length: 20 }, (_, i) => ({ rider_id: `extra${i}`, abilities: abil(40 + i) }))];
  const small = simulateStage({ entrants: smallField, stageProfile: stage, seed: 31, v3: true });
  const big = simulateStage({ entrants: bigField, stageProfile: stage, seed: 31, v3: true });
  assert.equal(
    small.ranked.find((r) => r.rider_id === "subject").components.dayform,
    big.ranked.find((r) => r.rider_id === "subject").components.dayform,
    "20 ekstra tilmeldinger må ikke flytte subjects dagsform"
  );
  assert.equal(
    small.ranked.find((r) => r.rider_id === "subject").components.jour_sans,
    big.ranked.find((r) => r.rider_id === "subject").components.jour_sans,
  );
});

test("simulateStage v3: form-vægten er FORM_RACE_WEIGHT_V3 (form=100 → +vægt; v1 uændret 0.012)", () => {
  const stage = { profile_type: "itt", demand_vector: { time_trial: 1.0, randomness: 0 } };
  const entrants = [{ rider_id: "r1", abilities: abil(60), form: 100 }];
  const v1 = simulateStage({ entrants, stageProfile: stage, seed: 4, v3: false });
  const v3 = simulateStage({ entrants, stageProfile: stage, seed: 4, v3: true });
  assert.ok(Math.abs(v1.ranked[0].components.form - 0.012) < 1e-12, "v1: FORM_RACE_WEIGHT=0.012 uændret");
  assert.ok(Math.abs(v3.ranked[0].components.form - T.FORM_RACE_WEIGHT_V3) < 1e-12, `v3: form=100 → +${T.FORM_RACE_WEIGHT_V3}`);
});
