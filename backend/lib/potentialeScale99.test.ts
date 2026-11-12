// #3564: tests for den rene omregning af potentiale 1-6 til 1-99.
// Alle params her er SYNTETISKE og med vilje forskellige fra de private
// kalibreringstal; testene beviser egenskaber (rang, monotoni, gulve,
// determinisme), ikke et bestemt tal.
import test from "node:test";
import assert from "node:assert/strict";

import {
  POTENTIALE_STEPS,
  SCALE_MAX,
  SCALE_MIN,
  findRankViolations,
  idHashUnit,
  scalePotentialeTo99,
  targetShareAtOrAbove,
  tierInterval,
  validateParams,
  type PotentialeScale99Params,
  type RiderPotentialeInput,
} from "./potentialeScale99.ts";

const SYNTH: PotentialeScale99Params = {
  tierStep: 9,
  tierHalfWidth: 4,
  tierDecay: 0.6,
  compressFromPotentiale: 4,
  // Halve værdier, så afrundingen til heltal aldrig lægger en rytter præcis på et anker.
  tailAnchors: [69.5, 79.5, 89.5],
  floors: [
    { potentiale: 5.5, floor: 72, hardCap: 78 },
    { potentiale: 6, floor: 78, hardCap: 85 },
  ],
  ageBands: [
    { key: "young", lo: 15, hi: 20 },
    { key: "mid", lo: 21, hi: 27 },
    { key: "old", lo: 28, hi: 45 },
  ],
};

/** Lille deterministisk LCG, så populationerne er ens i hver kørsel. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Syntetisk population. `skew` styrer hvor mange der når de høje trin. */
function population(seed: number, n: number, skew: number): RiderPotentialeInput[] {
  const rand = makeRng(seed);
  const out: RiderPotentialeInput[] = [];
  for (let i = 0; i < n; i++) {
    let k = 0;
    while (k < POTENTIALE_STEPS.length - 1 && rand() < skew) k++;
    out.push({ id: `rider-${seed}-${i}`, potentiale: POTENTIALE_STEPS[k], age: 15 + Math.floor(rand() * 31) });
  }
  return out;
}

const rankOrder = (a: RiderPotentialeInput, b: RiderPotentialeInput) =>
  a.potentiale - b.potentiale || idHashUnit(a.id) - idHashUnit(b.id) || (a.id < b.id ? -1 : 1);

const SEEDS = [1, 2, 3, 7, 42];

test("rangbevarelse: ingen rang-brud i nogen population, heller ikke en top-tung", () => {
  for (const seed of SEEDS) {
    for (const skew of [0.3, 0.6, 0.85]) {
      const riders = population(seed, 3000, skew);
      const { byId, rankViolations } = scalePotentialeTo99(riders, SYNTH);
      assert.equal(rankViolations.length, 0, `seed ${seed} skew ${skew}`);
      // Uafhængig kontrol af samme egenskab, ikke kun funktionens egen rapport.
      for (const band of SYNTH.ageBands) {
        const sorted = riders.filter((r) => byId.get(r.id)?.band === band.key).sort(rankOrder);
        for (let i = 1; i < sorted.length; i++) {
          assert.ok(byId.get(sorted[i].id)!.pot99 >= byId.get(sorted[i - 1].id)!.pot99);
        }
      }
    }
  }
});

test("monotoni: højere gammelt potentiale giver aldrig en lavere værdi i samme aldersbånd", () => {
  for (const seed of SEEDS) {
    const riders = population(seed, 2500, 0.7);
    const { byId } = scalePotentialeTo99(riders, SYNTH);
    for (const band of SYNTH.ageBands) {
      const inBand = riders.filter((r) => byId.get(r.id)?.band === band.key);
      for (let k = 1; k < POTENTIALE_STEPS.length; k++) {
        const lower = inBand.filter((r) => r.potentiale === POTENTIALE_STEPS[k - 1]).map((r) => byId.get(r.id)!.pot99);
        const higher = inBand.filter((r) => r.potentiale >= POTENTIALE_STEPS[k]).map((r) => byId.get(r.id)!.pot99);
        if (!lower.length || !higher.length) continue;
        assert.ok(Math.min(...higher) >= Math.max(...lower), `seed ${seed} band ${band.key} trin ${POTENTIALE_STEPS[k]}`);
      }
    }
  }
});

test("alle værdier er heltal på 1-99", () => {
  const { byId } = scalePotentialeTo99(population(5, 4000, 0.8), SYNTH);
  for (const { pot99 } of byId.values()) {
    assert.ok(Number.isInteger(pot99));
    assert.ok(pot99 >= SCALE_MIN && pot99 <= SCALE_MAX);
  }
});

test("kun toptalent-overskuddet presses: trin under klassen bliver i deres eget stykke", () => {
  const riders = population(11, 4000, 0.75);
  const { byId } = scalePotentialeTo99(riders, SYNTH);
  for (const r of riders) {
    if (r.potentiale >= SYNTH.compressFromPotentiale) continue;
    const k = POTENTIALE_STEPS.indexOf(r.potentiale);
    const [lo, hi] = tierInterval(SYNTH, k);
    const v = byId.get(r.id)!.pot99;
    assert.ok(v >= Math.round(lo) && v <= Math.round(hi), `trin ${r.potentiale} fik ${v}`);
  }
});

test("toptalent-klassen: antallet over hvert hale-anker følger målfordelingen, gulve fraregnet", () => {
  const noFloors: PotentialeScale99Params = { ...SYNTH, floors: [] };
  const riders = population(13, 6000, 0.8);
  const { byId } = scalePotentialeTo99(riders, noFloors);
  for (const band of SYNTH.ageBands) {
    const inBand = riders.filter((r) => byId.get(r.id)?.band === band.key);
    const nHigh = inBand.filter((r) => r.potentiale >= SYNTH.compressFromPotentiale).length;
    let cap = nHigh;
    for (const anchor of SYNTH.tailAnchors) {
      const expected = Math.min(cap, Math.round(inBand.length * targetShareAtOrAbove(SYNTH, anchor)));
      const actual = inBand.filter((r) => byId.get(r.id)!.pot99 >= anchor).length;
      assert.equal(actual, expected, `band ${band.key} anker ${anchor}`);
      cap = expected;
    }
  }
});

test("fredningsgulve: et fredet trin lander aldrig under sit gulv, og rangen holder", () => {
  // Top-tung population, så mange fredede ryttere ellers ville presses under gulvet.
  for (const seed of SEEDS) {
    const riders = population(seed, 3000, 0.9);
    const { byId, rankViolations } = scalePotentialeTo99(riders, SYNTH);
    assert.equal(rankViolations.length, 0);
    for (const { potentiale, floor } of SYNTH.floors) {
      const vals = riders.filter((r) => r.potentiale === potentiale && byId.has(r.id)).map((r) => byId.get(r.id)!.pot99);
      assert.ok(vals.length > 0, `syntetisk population skal ramme trin ${potentiale}`);
      assert.ok(Math.min(...vals) >= floor, `trin ${potentiale} under gulv`);
    }
  }
});

test("hale-kvoter holder efter afrunding, også med hele og skæve ankre", () => {
  for (const tailAnchors of [[69, 79, 89], [69.2, 79.7, 88.1]]) {
    const params: PotentialeScale99Params = { ...SYNTH, tailAnchors, floors: [] };
    const riders: RiderPotentialeInput[] = [];
    for (let i = 0; i < 10000; i++) riders.push({ id: `q${i}`, potentiale: 4, age: 20 });
    const { byId } = scalePotentialeTo99(riders, params);
    let cap = riders.length;
    for (const anchor of tailAnchors) {
      const expected = Math.min(cap, Math.round(riders.length * targetShareAtOrAbove(params, anchor)));
      const actual = riders.filter((r) => byId.get(r.id)!.pot99 >= anchor).length;
      assert.equal(actual, expected, `ankre ${tailAnchors.join("/")} anker ${anchor}`);
      cap = expected;
    }
  }
});

test("et gulv med decimaler holder efter afrunding", () => {
  const params: PotentialeScale99Params = {
    ...SYNTH,
    floors: [
      { potentiale: 5.5, floor: 72.4, hardCap: 78.1 },
      { potentiale: 6, floor: 78.1, hardCap: 85 },
    ],
  };
  const riders: RiderPotentialeInput[] = [];
  for (let i = 0; i < 1000; i++) riders.push({ id: `f${i}`, potentiale: 6, age: 20 });
  for (let i = 0; i < 1000; i++) riders.push({ id: `g${i}`, potentiale: 5.5, age: 20 });
  const { byId, rankViolations } = scalePotentialeTo99(riders, params);
  assert.equal(rankViolations.length, 0);
  for (const r of riders) {
    const { floor } = params.floors.find((f) => f.potentiale === r.potentiale)!;
    assert.ok(byId.get(r.id)!.pot99 >= floor, `${r.id} under gulv`);
  }
});

test("fredningsgulve gør en forskel: uden gulve lander nogen under, med gulve ingen", () => {
  const riders = population(17, 3000, 0.9);
  const without = scalePotentialeTo99(riders, { ...SYNTH, floors: [] });
  const withFloors = scalePotentialeTo99(riders, SYNTH);
  const top = SYNTH.floors.find((f) => f.potentiale === 6)!;
  const below = (res: typeof without) =>
    riders.filter((r) => r.potentiale === 6 && res.byId.get(r.id)!.pot99 < top.floor).length;
  assert.ok(below(without) > 0, "populationen skal udfordre gulvet");
  assert.equal(below(withFloors), 0);
});

test("determinisme: samme input giver samme output, uanset rækkefølge", () => {
  const riders = population(23, 3000, 0.7);
  const a = scalePotentialeTo99(riders, SYNTH);
  const b = scalePotentialeTo99(riders, SYNTH);
  const shuffled = [...riders].sort((x, y) => idHashUnit(`${y.id}:shuffle`) - idHashUnit(`${x.id}:shuffle`));
  const c = scalePotentialeTo99(shuffled, SYNTH);
  const reversed = scalePotentialeTo99([...riders].reverse(), SYNTH);
  for (const r of riders) {
    const v = a.byId.get(r.id)!.pot99;
    assert.equal(b.byId.get(r.id)!.pot99, v);
    assert.equal(c.byId.get(r.id)!.pot99, v);
    assert.equal(reversed.byId.get(r.id)!.pot99, v);
  }
});

test("funktionen ændrer ikke input", () => {
  const riders = population(29, 500, 0.7);
  const before = JSON.stringify(riders);
  scalePotentialeTo99(riders, SYNTH);
  assert.equal(JSON.stringify(riders), before);
});

test("ryttere der ikke kan omregnes springes over med en årsag", () => {
  const riders: RiderPotentialeInput[] = [
    { id: "ok", potentiale: 3, age: 22 },
    { id: "off-grid", potentiale: 3.3, age: 22 },
    { id: "no-age", potentiale: 3, age: null },
    { id: "too-young", potentiale: 3, age: 12 },
  ];
  const { byId, skipped } = scalePotentialeTo99(riders, SYNTH);
  assert.deepEqual([...byId.keys()], ["ok"]);
  assert.deepEqual(
    skipped.map((s) => `${s.id}:${s.reason}`).sort(),
    ["no-age:missing_age", "off-grid:invalid_potentiale", "too-young:no_age_band"],
  );
});

test("dobbelt rytter-id afvises", () => {
  assert.throws(() => scalePotentialeTo99([{ id: "x", potentiale: 2, age: 20 }, { id: "x", potentiale: 3, age: 20 }], SYNTH), /to gange/);
});

test("tom population giver tomt resultat", () => {
  const res = scalePotentialeTo99([], SYNTH);
  assert.equal(res.byId.size, 0);
  assert.equal(res.skipped.length, 0);
  assert.equal(res.rankViolations.length, 0);
});

test("ingen standardtal: manglende eller ugyldige params afvises", () => {
  // @ts-expect-error: params er påkrævet
  assert.throws(() => validateParams(undefined), /params mangler/);
  // @ts-expect-error: tomt objekt mangler alle felter
  assert.throws(() => validateParams({}), /tierStep/);
  assert.throws(() => validateParams({ ...SYNTH, tierDecay: 0 }), /tierDecay/);
  assert.throws(() => validateParams({ ...SYNTH, tierHalfWidth: SYNTH.tierStep }), /overlappe/);
  assert.throws(() => validateParams({ ...SYNTH, compressFromPotentiale: 4.2 }), /compressFromPotentiale/);
  assert.throws(() => validateParams({ ...SYNTH, tailAnchors: [80, 70] }), /tailAnchors/);
  assert.throws(() => validateParams({ ...SYNTH, tailAnchors: [69.2, 69.8, 89.5] }), /heltal mellem to tailAnchors/);
  assert.throws(
    () => validateParams({ ...SYNTH, floors: [{ potentiale: 5.5, floor: 72.2, hardCap: 72.8 }, SYNTH.floors[1]] }),
    /heltal mellem et gulv/,
  );
  assert.throws(() => validateParams({ ...SYNTH, ageBands: [] }), /ageBands/);
  assert.throws(
    () => validateParams({ ...SYNTH, ageBands: [{ key: "a", lo: 15, hi: 25 }, { key: "b", lo: 25, hi: 40 }] }),
    /overlappe/,
  );
});

test("gulve der ikke er rang-sikre afvises", () => {
  // Fredet 5,5 men ikke 6: en løftet 5,5'er kunne overhale en 6'er.
  assert.throws(() => validateParams({ ...SYNTH, floors: [{ potentiale: 5.5, floor: 72, hardCap: 78 }] }), /alle trin over/);
  // hardCap over gulvet for trinnet over.
  assert.throws(
    () => validateParams({ ...SYNTH, floors: [{ potentiale: 5.5, floor: 72, hardCap: 80 }, { potentiale: 6, floor: 78, hardCap: 85 }] }),
    /hardCap/,
  );
  // Gulv på et trin under toptalent-klassen.
  assert.throws(
    () => validateParams({ ...SYNTH, floors: [...SYNTH.floors, { potentiale: 3, floor: 40, hardCap: 45 }] }),
    /toptalent-klassen/,
  );
});

test("findRankViolations fanger et manipuleret resultat", () => {
  const riders = population(31, 800, 0.7);
  const { byId } = scalePotentialeTo99(riders, SYNTH);
  const top = [...riders].filter((r) => byId.get(r.id)!.band === "mid").sort(rankOrder).at(-1)!;
  byId.set(top.id, { ...byId.get(top.id)!, pot99: SCALE_MIN });
  assert.ok(findRankViolations(riders, byId, SYNTH).length > 0);
});

test("targetShareAtOrAbove er en aftagende andel fra 1 til 0", () => {
  assert.equal(targetShareAtOrAbove(SYNTH, SCALE_MIN), 1);
  assert.equal(targetShareAtOrAbove(SYNTH, SCALE_MAX), 0);
  let prev = 1;
  for (let x = SCALE_MIN; x <= SCALE_MAX; x += 0.5) {
    const s = targetShareAtOrAbove(SYNTH, x);
    assert.ok(s <= prev + 1e-12);
    prev = s;
  }
});

// ── Codex-fund PR #8046: rang efter afrunding ved første hale-anker ──────────

function twoTierBand(lowerPot: number, upperPot: number, n: number): RiderPotentialeInput[] {
  const out: RiderPotentialeInput[] = [];
  for (let i = 0; i < n; i++) out.push({ id: `lo-${i}`, potentiale: lowerPot, age: 20 });
  for (let i = 0; i < n; i++) out.push({ id: `hi-${i}`, potentiale: upperPot, age: 20 });
  return out;
}

test("Codex-fund: første anker tæt på en klassegrænse med decimaler afvises (fundets eksempel)", () => {
  const params: PotentialeScale99Params = {
    tierStep: 9.2,
    tierHalfWidth: 4.6,
    tierDecay: 0.6,
    compressFromPotentiale: 4,
    tailAnchors: [51.7, 80, 90],
    floors: [],
    ageBands: [{ key: "all", lo: 15, hi: 45 }],
  };
  assert.throws(() => validateParams(params), /første tailAnchor.*rangen ville vendes/);
  assert.throws(() => scalePotentialeTo99(twoTierBand(3.5, 4, 1000), params), /første tailAnchor/);
  // Det første anker et heltal højere er rang-sikkert og giver ingen brud.
  const ok = { ...params, tailAnchors: [52.7, 80, 90] };
  validateParams(ok);
  assert.equal(scalePotentialeTo99(twoTierBand(3.5, 4, 1000), ok).rankViolations.length, 0);
});

test("egenskab: accepterede params vender aldrig rangen efter afrunding (net af params)", () => {
  let accepted = 0;
  let rejected = 0;
  let tight = 0;
  for (const tierStep of [7, 8.3, 9.2, 9.7]) {
    for (const halfFrac of [0.3, 0.45, 0.5]) {
      const tierHalfWidth = Math.round(tierStep * halfFrac * 1000) / 1000;
      for (const tierDecay of [0.5, 0.6, 0.85]) {
        for (const compressFromPotentiale of [3.5, 4, 4.5, 5]) {
          const compressIdx = POTENTIALE_STEPS.indexOf(compressFromPotentiale);
          const tailStart = SCALE_MIN + compressIdx * tierStep - tierHalfWidth;
          for (const d of [0.05, 0.1, 0.4, 0.6, 0.95, 1.3, 2.5]) {
            const a1 = Math.round((tailStart + d) * 100) / 100;
            const params: PotentialeScale99Params = {
              tierStep, tierHalfWidth, tierDecay, compressFromPotentiale,
              tailAnchors: [a1, Math.min(97.5, a1 + 8), Math.min(98.5, a1 + 14)],
              floors: [],
              ageBands: [{ key: "all", lo: 15, hi: 45 }],
            };
            try { validateParams(params); } catch { rejected++; continue; }
            accepted++;
            const belowHi = tierInterval(params, compressIdx - 1)[1];
            if (Math.ceil(a1) - 1 === Math.min(SCALE_MAX, Math.ceil(belowHi + 0.5) - 1)) tight++;
            const lower = POTENTIALE_STEPS[compressIdx - 1];
            for (const pop of [twoTierBand(lower, compressFromPotentiale, 1000), population(7, 3000, 0.8)]) {
              const res = scalePotentialeTo99(pop.map((r) => ({ ...r, age: 20 })), params);
              assert.deepEqual(res.rankViolations, [], JSON.stringify({ tierStep, tierHalfWidth, compressFromPotentiale, a1 }));
            }
          }
        }
      }
    }
  }
  assert.ok(accepted > 50, `for få accepterede params (${accepted})`);
  assert.ok(rejected > 0, "nettet skal også ramme afviste params");
  assert.ok(tight > 0, "nettet skal ramme grænsetilfældet, hvor første segment netop er rang-sikkert");
});
