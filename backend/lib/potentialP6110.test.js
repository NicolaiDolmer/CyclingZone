// #8521: potentiale P (1-99). Alle tal her er OPDIGTEDE testfixtures, ikke kalibrering
// (de rigtige ankre og faktorer er private, hard rule 17).
import test from "node:test";
import assert from "node:assert/strict";

import {
  STAR_STEPS, P_MIN, P_MAX, POTENTIAL_P_PARAMS_KEY,
  validatePotentialPParams, convertStarsToP, findRankViolations, summarizeP,
  drawAcademyStars, academyStarWeights, drawPForStars, anchorFor,
} from "./potentialP6110.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { clearPrivateConfigCache } from "./privateConfig.ts";
import { loadAcademyPotentialP } from "./potentialP6110Load.js";

// Opdigtet fixture: lige brede trin forneden, smallere (presset) trin foroven.
const FIXTURE = Object.freeze({
  anchors: {
    "1": [5, 14], "1.5": [15, 22], "2": [23, 30], "2.5": [31, 38], "3": [39, 46], "3.5": [47, 54],
    "4": [55, 62], "4.5": [63, 69], "5": [70, 75], "5.5": [76, 80], "6": [81, 84],
  },
  academyDecay: 0.6,
});

/** Opdigtet bestand: stjerner trukket med fixturens form, rating uafhængig af stjernerne. */
function makePopulation(n, seed = 8521) {
  const rng = makeRng(seed);
  const weights = academyStarWeights(FIXTURE);
  const riders = [];
  for (let i = 0; i < n; i++) {
    let roll = rng() * weights.reduce((a, b) => a + b, 0);
    let stars = STAR_STEPS[STAR_STEPS.length - 1];
    for (let k = 0; k < weights.length; k++) {
      roll -= weights[k];
      if (roll <= 0) { stars = STAR_STEPS[k]; break; }
    }
    riders.push({ id: `r-${i}-${Math.floor(rng() * 1e9)}`, potentiale: stars, rating: Math.round(rng() * 70) + 0.25 });
  }
  return riders;
}

// ── Params ──────────────────────────────────────────────────────────────────

test("validatePotentialPParams: fixturen er gyldig", () => {
  assert.equal(validatePotentialPParams(FIXTURE), FIXTURE);
});

test("validatePotentialPParams: afviser overlap, manglende trin, ikke-heltal og uden for skalaen", () => {
  const bad = (anchors) => ({ ...FIXTURE, anchors: { ...FIXTURE.anchors, ...anchors } });
  assert.throws(() => validatePotentialPParams(bad({ "2": [20, 30] })), /overlap/);
  assert.throws(() => validatePotentialPParams({ anchors: { ...FIXTURE.anchors, "6": undefined } }), /missing step 6/);
  assert.throws(() => validatePotentialPParams(bad({ "1": [5.5, 14] })), /integers/);
  assert.throws(() => validatePotentialPParams(bad({ "6": [81, 100] })), /integers/);
  assert.throws(() => validatePotentialPParams(bad({ "1": [0, 14] })), /integers/);
  assert.throws(() => validatePotentialPParams(bad({ "3": [46, 39] })), /integers/);
  assert.throws(() => validatePotentialPParams(null), /params missing/);
  for (const academyDecay of [0, -0.5, 1.2, Number.NaN, "0.6"]) {
    assert.throws(() => validatePotentialPParams({ ...FIXTURE, academyDecay }), /academyDecay/);
  }
  // Grænser: delte endepunkter mellem to trin er tilladt (rækkefølgen holder stadig).
  assert.doesNotThrow(() => validatePotentialPParams(bad({ "1.5": [14, 22] })));
  // Uden academyDecay er params stadig gyldige til omregningen.
  assert.doesNotThrow(() => validatePotentialPParams({ anchors: FIXTURE.anchors }));
});

// ── Omregning ───────────────────────────────────────────────────────────────

test("rangbevarelse: flere stjerner giver aldrig lavere P fra ankrene", () => {
  const riders = makePopulation(3000);
  const { byId, skipped } = convertStarsToP(riders, FIXTURE);
  assert.equal(skipped.length, 0);
  assert.equal(byId.size, riders.length);
  assert.deepEqual(findRankViolations(byId), []);
  for (let k = 1; k < STAR_STEPS.length; k++) {
    const below = riders.filter((r) => r.potentiale === STAR_STEPS[k - 1]).map((r) => byId.get(r.id).pBase);
    const above = riders.filter((r) => r.potentiale === STAR_STEPS[k]).map((r) => byId.get(r.id).pBase);
    if (below.length && above.length) {
      assert.ok(Math.min(...above) >= Math.max(...below), `trin ${STAR_STEPS[k]} under trin ${STAR_STEPS[k - 1]}`);
    }
  }
});

test("rangbevarelse: resultatet afhænger ikke af rækkernes rækkefølge", () => {
  const riders = makePopulation(500, 3);
  const a = convertStarsToP(riders, FIXTURE).byId;
  const b = convertStarsToP([...riders].reverse(), FIXTURE).byId;
  for (const r of riders) assert.deepEqual(a.get(r.id), b.get(r.id));
});

test("P fra ankrene ligger altid i trinnets ankerinterval og bruger hele intervallet", () => {
  const riders = makePopulation(5000, 11);
  const { byId } = convertStarsToP(riders, FIXTURE);
  for (const step of STAR_STEPS) {
    const [lo, hi] = anchorFor(FIXTURE, step);
    const vals = riders.filter((r) => r.potentiale === step).map((r) => byId.get(r.id).pBase);
    for (const v of vals) assert.ok(v >= lo && v <= hi, `${v} uden for [${lo}, ${hi}]`);
    if (vals.length >= 50) {
      assert.equal(Math.min(...vals), lo);
      assert.equal(Math.max(...vals), hi);
    }
  }
});

test("hævning til rating: står rytteren over sit nye P, hæves P til ratingen", () => {
  const riders = [
    { id: "a", potentiale: 2, rating: 64.4 }, // langt over trinnet -> hæves
    { id: "b", potentiale: 2, rating: 10 },   // under -> P fra ankrene
    { id: "c", potentiale: 6, rating: 99.7 }, // over skalaen -> klippes til 99
    { id: "d", potentiale: 3, rating: null }, // ingen rating -> P fra ankrene
  ];
  const { byId } = convertStarsToP(riders, FIXTURE);
  assert.equal(byId.get("a").p, 64);
  assert.equal(byId.get("a").lifted, true);
  assert.ok(byId.get("a").pBase <= anchorFor(FIXTURE, 2)[1]);
  assert.equal(byId.get("b").lifted, false);
  assert.equal(byId.get("b").p, byId.get("b").pBase);
  assert.equal(byId.get("c").p, P_MAX);
  assert.equal(byId.get("c").lifted, true);
  assert.equal(byId.get("d").lifted, false);
  for (const v of byId.values()) assert.ok(v.p >= v.pBase && v.p >= P_MIN && v.p <= P_MAX);
});

test("hævning: P er aldrig under ratingen (afrundet), og kun de hævede ændres", () => {
  const riders = makePopulation(2000, 5);
  const { byId } = convertStarsToP(riders, FIXTURE);
  for (const r of riders) {
    const v = byId.get(r.id);
    assert.ok(v.p >= Math.min(P_MAX, Math.round(r.rating)));
    assert.equal(v.lifted, v.p !== v.pBase);
  }
});

test("ingen rating ændres: inputtet muteres ikke", () => {
  const riders = makePopulation(300, 9);
  const before = JSON.parse(JSON.stringify(riders));
  const { byId } = convertStarsToP(riders, FIXTURE);
  assert.deepEqual(riders, before);
  for (const r of riders) assert.equal(byId.get(r.id).rating, r.rating);
});

test("ugyldige stjerner springes over, dubletter afvises", () => {
  const { byId, skipped } = convertStarsToP([
    { id: "x", potentiale: null }, { id: "y", potentiale: 2.25 }, { id: "z", potentiale: 7 }, { id: "ok", potentiale: 1 },
  ], FIXTURE);
  assert.deepEqual(skipped.map((s) => s.id).sort(), ["x", "y", "z"]);
  assert.equal(byId.size, 1);
  assert.throws(() => convertStarsToP([{ id: "d", potentiale: 1 }, { id: "d", potentiale: 2 }], FIXTURE), /duplicate/);
});

// ── Fordeling ───────────────────────────────────────────────────────────────

test("summarizeP: median, p90, p99, tærskeltal og histogram", () => {
  const s = summarizeP([1, 10, 20, 50, 79, 80, 85, 90, 95, 99]);
  assert.equal(s.n, 10);
  assert.equal(s.median, 80);
  assert.equal(s.p90, 99);
  assert.equal(s.p99, 99);
  assert.equal(s.atOrAbove80, 5);
  assert.equal(s.atOrAbove90, 3);
  assert.equal(Object.values(s.histogram).reduce((a, b) => a + b, 0), 10);
  assert.equal(s.histogram["1-9"], 1);
  assert.equal(s.histogram["90-99"], 3);
  assert.equal(summarizeP([]).median, null);
});

test("fordelingstest med fixture: høje P er sjældne, og toppen ligger under den gamle top", () => {
  const riders = makePopulation(10000, 21).map((r) => ({ ...r, rating: null }));
  const { byId } = convertStarsToP(riders, FIXTURE);
  const s = summarizeP([...byId.values()].map((v) => v.p));
  assert.ok(s.median < s.p90 && s.p90 <= s.p99);
  assert.ok(s.atOrAbove80 < s.n * 0.02, "høje P skal være sjældne");
  assert.ok(s.p99 <= anchorFor(FIXTURE, 6)[1]);
});

// ── Akademiet ───────────────────────────────────────────────────────────────

test("drawAcademyStars: følger den geometriske form med akademiets faktor", () => {
  const rng = makeRng(77);
  const n = 40000;
  const counts = new Map(STAR_STEPS.map((s) => [s, 0]));
  for (let i = 0; i < n; i++) {
    const s = drawAcademyStars(rng, FIXTURE);
    counts.set(s, counts.get(s) + 1);
  }
  const weights = academyStarWeights(FIXTURE);
  const sum = weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < STAR_STEPS.length; k++) {
    assert.ok(Math.abs(counts.get(STAR_STEPS[k]) / n - weights[k] / sum) < 0.01, `trin ${STAR_STEPS[k]}`);
  }
  // Hvert halve trin er sjældnere end det forrige, når faktoren er under 1.
  for (let k = 1; k < weights.length; k++) assert.ok(weights[k] < weights[k - 1]);
  // Faktor 1 = alle trin lige sandsynlige.
  assert.deepEqual(academyStarWeights({ ...FIXTURE, academyDecay: 1 }), STAR_STEPS.map(() => 1));
});

test("drawAcademyStars: minStars betinger trækket, manglende faktor afvises", () => {
  const rng = makeRng(5);
  for (let i = 0; i < 2000; i++) assert.ok(drawAcademyStars(rng, FIXTURE, 4.5) >= 4.5);
  assert.equal(drawAcademyStars(rng, FIXTURE, 7), 6);
  assert.throws(() => drawAcademyStars(rng, { anchors: FIXTURE.anchors }), /academyDecay missing/);
});

test("drawPForStars: P ligger i trinnets ankerinterval og rammer begge ender", () => {
  const rng = makeRng(13);
  for (const step of STAR_STEPS) {
    const [lo, hi] = anchorFor(FIXTURE, step);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const p = drawPForStars(rng, FIXTURE, step);
      assert.ok(Number.isInteger(p) && p >= lo && p <= hi);
      seen.add(p);
    }
    assert.ok(seen.has(lo) && seen.has(hi), `trin ${step}`);
  }
});

test("tilgangen matcher bestanden: en bestand med samme form som faktoren får samme P-fordeling som akademiet", () => {
  // Opdigtet bestand, hvis stjerner har præcis den form, akademiets faktor giver.
  const params = FIXTURE;
  const weights = academyStarWeights(params);
  const sum = weights.reduce((a, b) => a + b, 0);
  const rng = makeRng(2026);
  const n = 30000;
  const stock = [];
  for (let k = 0; k < STAR_STEPS.length; k++) {
    for (let i = 0; i < Math.round((weights[k] / sum) * n); i++) stock.push({ id: `s${k}-${i}`, potentiale: STAR_STEPS[k] });
  }
  const stockP = summarizeP([...convertStarsToP(stock, params).byId.values()].map((v) => v.p));
  const inflow = [];
  for (let i = 0; i < n; i++) {
    const stars = drawAcademyStars(rng, params);
    inflow.push(drawPForStars(rng, params, stars));
  }
  const inflowP = summarizeP(inflow);
  for (const q of ["median", "p90", "p99"]) {
    assert.ok(Math.abs(inflowP[q] - stockP[q]) <= 2, `${q}: tilgang ${inflowP[q]} mod bestand ${stockP[q]}`);
  }
  assert.ok(Math.abs(inflowP.atOrAbove80 / n - stockP.atOrAbove80 / stockP.n) < 0.005);
});

// ── Kontakten ───────────────────────────────────────────────────────────────

function fakeClient({ flag = null, privateValue = null } = {}) {
  return {
    from(table) {
      const q = { key: null };
      const chain = {
        select() { return chain; },
        eq(_col, key) { q.key = key; return chain; },
        async maybeSingle() {
          if (table === "app_config") return { data: q.key === "development_xp_model" && flag != null ? { value: flag } : null, error: null };
          if (table === "private_config") return { data: q.key === POTENTIAL_P_PARAMS_KEY && privateValue ? { value: privateValue } : null, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
}

const quietLog = () => {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(String(m)) };
};

test("loadAcademyPotentialP: XP-kontakten slukket = null (dagens akademi)", async () => {
  clearPrivateConfigCache();
  assert.equal(await loadAcademyPotentialP({ supabase: fakeClient({ flag: "off", privateValue: FIXTURE }), log: quietLog() }), null);
  assert.equal(await loadAcademyPotentialP({ supabase: fakeClient({ privateValue: FIXTURE }), log: quietLog() }), null);
});

test("loadAcademyPotentialP: tændt med gyldige params giver params; mangler de, null + advarsel uden tal", async () => {
  clearPrivateConfigCache();
  const got = await loadAcademyPotentialP({ supabase: fakeClient({ flag: "on", privateValue: FIXTURE }), log: quietLog() });
  assert.deepEqual(got, FIXTURE);
  clearPrivateConfigCache();
  const log = quietLog();
  assert.equal(await loadAcademyPotentialP({ supabase: fakeClient({ flag: "on" }), log }), null);
  assert.ok(log.warnings.some((w) => w.includes("missing")));
  clearPrivateConfigCache();
  const log2 = quietLog();
  assert.equal(await loadAcademyPotentialP({ supabase: fakeClient({ flag: "on", privateValue: { anchors: FIXTURE.anchors } }), log: log2 }), null);
  assert.ok(log2.warnings.every((w) => !/\d{2}, \d{2}/.test(w)), "advarslen må ikke indeholde tallene");
});
