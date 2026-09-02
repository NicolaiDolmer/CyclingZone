// Race Engine v3 (#2224), slice S2 (#2353) — dagsform + jour sans (spec §7).
import test from "node:test";
import assert from "node:assert/strict";

import { dayFormComponent, dayformBand, jourSansComponent, jourSansProbability } from "./raceDayForm.js";
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

// ── dayformBand (#4598, ejer-design 2/9) ───────────────────────────────────────

test("dayformBand: 0 → trin 0", () => {
  assert.equal(dayformBand(0, 0.018), 0);
});

test("dayformBand: monoton + symmetrisk om 0 — samme |dayform| giver samme |trin|, modsat fortegn", () => {
  const sd = 0.018;
  for (const mult of [0, 0.3, 0.6, 1, 1.5, 2.4, 3, 4.6, 5, 9]) {
    const pos = dayformBand(sd * mult, sd);
    const neg = dayformBand(-sd * mult, sd);
    assert.equal(pos, -neg, `dayformBand(+${mult}sd) og dayformBand(-${mult}sd) skal være modsatte, fik ${pos}/${neg}`);
  }
  // Monotoni: stigende dayform giver aldrig et LAVERE trin.
  const xs = [-5, -3, -1.4, -0.6, -0.2, 0, 0.2, 0.6, 1.4, 3, 5].map((m) => sd * m);
  let prev = -Infinity;
  for (const x of xs) {
    const b = dayformBand(x, sd);
    assert.ok(b >= prev, `dayformBand skal være monoton stigende, ${x} gav ${b} < forrige ${prev}`);
    prev = b;
  }
});

test("dayformBand: clamper til [-5, 5] uanset hvor ekstremt (men finite) input", () => {
  const sd = 0.018;
  assert.equal(dayformBand(sd * 100, sd), 5);
  assert.equal(dayformBand(-sd * 100, sd), -5);
  // Infinity er IKKE finite → rammer samme ærlig-degraderings-gren som NaN, trin 0.
  assert.equal(dayformBand(Infinity, sd), 0);
  assert.equal(dayformBand(-Infinity, sd), 0);
});

test("dayformBand: nøjagtige trin-grænser (afrunding til nærmeste heltal antal sd'er)", () => {
  const sd = 0.02;
  assert.equal(dayformBand(sd * 0.49, sd), 0, "under 0.5 sd runder til trin 0");
  assert.equal(dayformBand(sd * 0.51, sd), 1, "over 0.5 sd runder til trin 1");
  assert.equal(dayformBand(sd * 1.49, sd), 1);
  assert.equal(dayformBand(sd * 1.51, sd), 2);
  assert.equal(dayformBand(sd * 4.49, sd), 4);
  assert.equal(dayformBand(sd * 4.51, sd), 5);
});

test("dayformBand: sd=0 (kill-switch) → altid trin 0, uanset dayform", () => {
  assert.equal(dayformBand(0.5, 0), 0);
  assert.equal(dayformBand(-0.5, 0), 0);
  assert.equal(dayformBand(0, 0), 0);
});

test("dayformBand: ikke-finite dayform (NaN/undefined) → trin 0 (ærlig degradering)", () => {
  assert.equal(dayformBand(NaN, 0.018), 0);
  assert.equal(dayformBand(undefined, 0.018), 0);
});

test("dayformBand: default sd = RACE_V3_TUNING.DAYFORM_SD (samme tuning motoren bruger)", () => {
  assert.equal(dayformBand(RACE_V3_TUNING.DAYFORM_SD * 3), 3);
  assert.equal(dayformBand(-RACE_V3_TUNING.DAYFORM_SD * 3), -3);
});

test("dayformBand: fordelingen over 20.000 dayFormComponent-træk er klokkeformet + symmetrisk om 0 (spec: trin 0 35-45%, ±1 ~20%, ±5 <1%)", () => {
  const sd = 0.018;
  const N = 20000;
  const counts = {};
  for (let m = -5; m <= 5; m++) counts[m] = 0;
  for (let i = 0; i < N; i++) {
    const v = dayFormComponent({ riderId: `r${i}`, stageSeed: 4242, sd });
    counts[dayformBand(v, sd)] += 1;
  }
  const pct = (m) => (counts[m] / N) * 100;

  // Klokkeform: trin 0 er strengt det hyppigste, og hyppigheden falder
  // monotont ud mod begge haler.
  for (let m = 1; m <= 4; m++) {
    assert.ok(counts[m - 1] > counts[m], `trin ${m - 1} (${counts[m - 1]}) skal være hyppigere end trin ${m} (${counts[m]})`);
    assert.ok(counts[-(m - 1)] > counts[-m], `trin ${-(m - 1)} (${counts[-(m - 1)]}) skal være hyppigere end trin ${-m} (${counts[-m]})`);
  }

  // Symmetri om 0: hvert positivt trin skal ligge tæt på sit spejlbillede
  // (bred tolerance — 20.000 træk giver statistisk støj, ikke eksakt lighed).
  for (let m = 1; m <= 5; m++) {
    assert.ok(Math.abs(pct(m) - pct(-m)) < 2, `trin ±${m} skal være ~symmetriske, fik +${pct(m).toFixed(2)}% / -${pct(-m).toFixed(2)}%`);
  }

  // Ejerens mål-intervaller.
  assert.ok(pct(0) >= 30 && pct(0) <= 48, `trin 0 skal ramme ca. 35-45% (bred tolerance for støj), fik ${pct(0).toFixed(2)}%`);
  assert.ok(pct(1) >= 15 && pct(1) <= 30, `trin +1 skal ramme ca. 20%, fik ${pct(1).toFixed(2)}%`);
  assert.ok(pct(-1) >= 15 && pct(-1) <= 30, `trin -1 skal ramme ca. 20%, fik ${pct(-1).toFixed(2)}%`);
  assert.ok(pct(5) < 1, `trin +5 skal være under 1%, fik ${pct(5).toFixed(3)}%`);
  assert.ok(pct(-5) < 1, `trin -5 skal være under 1%, fik ${pct(-5).toFixed(3)}%`);

  // Alle 11 trin summerer til 100% (ingen træk tabt).
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, N);
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
