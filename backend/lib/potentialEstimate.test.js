// #6110: potentiale-skønnet. Tallene i PARAMS er syntetiske testværdier, ikke
// kalibreringen (den er privat, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimatePotential, uncertaintyFor, certaintyWord, deviation, CERTAINTY_WORDS,
} from "./potentialEstimate.js";

const PARAMS = Object.freeze({
  salt: "test",
  weights: { shared: 0.6, pair: 0.6, level: 0.53 },
  clip: 2,
  minU: 1,
  words: { sureAtOrBelow: 3, fairAtOrBelow: 6 },
  scout: { maxLooks: 3, defaultTier: 1, uByLooks: [8, 5, 3], tierFactor: [1, 0.9, 0.8, 0.7, 0.6] },
  own: { firstEstimateDates: 5, staffSpeedWeight: 0.5, steps: [{ fromDates: 0, u: 7 }, { fromDates: 12, u: 4 }, { fromDates: 20, u: 2 }] },
});

const scoutKnow = (looks, tier = 3) => ({ own: false, looks, bestScoutTier: tier });

test("intet tal uden viden: fremmed uden kig og egen ung under grænsen", () => {
  assert.deepEqual(estimatePotential({ truePot: 70, currentRating: 40, riderId: "r1", teamId: "t1", knowledge: scoutKnow(0) }, PARAMS), { hidden: true });
  assert.deepEqual(estimatePotential({ truePot: 70, currentRating: 40, riderId: "r1", teamId: "t1", knowledge: { own: true, trainingDates: 4 } }, PARAMS), { hidden: true });
  assert.equal(estimatePotential({ truePot: 70, currentRating: 40, riderId: "r1", teamId: "t1", knowledge: { own: true, trainingDates: 5 } }, PARAMS).hidden, false);
});

test("stabilt: samme (rytter, hold, viden) giver altid samme tal", () => {
  const a = estimatePotential({ truePot: 72, currentRating: 50, riderId: "r9", teamId: "t3", knowledge: scoutKnow(1) }, PARAMS);
  const b = estimatePotential({ truePot: 72, currentRating: 50, riderId: "r9", teamId: "t3", knowledge: scoutKnow(1) }, PARAMS);
  assert.deepEqual(a, b);
});

test("afvigelsen er klippet, og to hold får forskellige afvigelser", () => {
  for (let i = 0; i < 2000; i++) {
    const z = deviation(`r${i}`, "t1", "s1t1", PARAMS);
    assert.ok(z >= -2 && z <= 2);
  }
  let differ = 0;
  for (let i = 0; i < 200; i++) if (deviation(`r${i}`, "tA", "s1t1", PARAMS) !== deviation(`r${i}`, "tB", "s1t1", PARAMS)) differ++;
  assert.ok(differ > 190);
});

test("skønnet glider: den faste del dominerer, så niveauerne følges ad", () => {
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < 3000; i++) {
    const a = deviation(`r${i}`, "t1", "s1t3", PARAMS), b = deviation(`r${i}`, "t1", "s2t3", PARAMS);
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  const corr = sxy / Math.sqrt(sxx * syy);
  assert.ok(corr > 0.5, `korrelation ${corr}`);
});

test("monotoni i forventning: mere viden giver mindre gennemsnitlig fejl", () => {
  const meanErr = (looks) => {
    let s = 0;
    for (let i = 0; i < 4000; i++) {
      const e = estimatePotential({ truePot: 60, currentRating: 1, riderId: `r${i}`, teamId: `t${i % 7}`, knowledge: scoutKnow(looks) }, PARAMS);
      s += Math.abs(e.value - 60);
    }
    return s / 4000;
  };
  const e1 = meanErr(1), e2 = meanErr(2), e3 = meanErr(3);
  assert.ok(e1 > e2 && e2 > e3, `${e1} ${e2} ${e3}`);
});

test("inversion: to aflæsninger på hvert sit niveau kan ikke løses for sandheden", () => {
  // Angrebet fra review på #7107: løs to aflæsninger for sandheden. Med kun en fast
  // afvigelse rammer det (næsten) præcist; med delen pr. niveau må det ikke være
  // bedre end det bedste enkelt-skøn.
  const u1 = uncertaintyFor(scoutKnow(1), PARAMS), u2 = uncertaintyFor(scoutKnow(3), PARAMS);
  let attackErr = 0, bestSingleErr = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const base = { truePot: 60, currentRating: 1, riderId: `r${i}`, teamId: "t1" };
    const e1 = estimatePotential({ ...base, knowledge: scoutKnow(1) }, PARAMS).value;
    const e2 = estimatePotential({ ...base, knowledge: scoutKnow(3) }, PARAMS).value;
    attackErr += Math.abs((e1 * u2 - e2 * u1) / (u2 - u1) - 60);
    bestSingleErr += Math.abs(e2 - 60);
  }
  assert.ok(attackErr / N > bestSingleErr / N, `angreb ${attackErr / N} mod bedste skøn ${bestSingleErr / N}`);
});

test("deling mellem hold hjælper kun lidt: fælles del pr. rytter (ejer-valg 23/10)", () => {
  let pooled = 0, single = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let t = 0; t < 10; t++) {
      sum += estimatePotential({ truePot: 60, currentRating: 1, riderId: `r${i}`, teamId: `t${t}`, knowledge: scoutKnow(1, 1) }, PARAMS).value;
    }
    pooled += Math.abs(sum / 10 - 60);
    single += Math.abs(estimatePotential({ truePot: 60, currentRating: 1, riderId: `r${i}`, teamId: "t0", knowledge: scoutKnow(1, 1) }, PARAMS).value - 60);
  }
  assert.ok(pooled / N >= 0.5 * (single / N), `samlet ${pooled / N} mod enkelt ${single / N}`);
});

test("bedre scout giver mindre usikkerhed; ordet bliver aldrig mindre sikkert", () => {
  const order = (w) => CERTAINTY_WORDS.indexOf(w);
  for (const looks of [1, 2, 3]) {
    let prevU = Infinity, prevWord = -1;
    for (const tier of [1, 2, 3, 4, 5]) {
      const u = uncertaintyFor(scoutKnow(looks, tier), PARAMS);
      assert.ok(u <= prevU);
      assert.ok(order(certaintyWord(u, PARAMS)) >= prevWord);
      prevU = u; prevWord = order(certaintyWord(u, PARAMS));
    }
  }
});

test("scoutens niveau sætter loftet for sikkerheden (K2): svag scout giver aldrig Sikker", () => {
  const P = { ...PARAMS, scout: { ...PARAMS.scout, minUByTier: [3.5, 3.5, 1, 1, 1] } };
  for (const tier of [1, 2]) {
    for (const looks of [1, 2, 3]) assert.notEqual(certaintyWord(uncertaintyFor(scoutKnow(looks, tier), P), P), "sure");
  }
  assert.equal(certaintyWord(uncertaintyFor(scoutKnow(3, 3), P), P), "sure");
});

test("usikkerheden går aldrig under minU (kan altid ramme lidt ved siden af)", () => {
  assert.equal(uncertaintyFor({ own: true, trainingDates: 500, staffSpeed: 10 }, PARAMS), 2);
  assert.ok(uncertaintyFor(scoutKnow(3, 5), PARAMS) >= PARAMS.minU);
});

test("skønnet vises aldrig under nuværende rating og aldrig over 99", () => {
  for (let i = 0; i < 1000; i++) {
    const e = estimatePotential({ truePot: 60, currentRating: 59, riderId: `r${i}`, teamId: "t1", knowledge: scoutKnow(1, 1) }, PARAMS);
    assert.ok(e.value >= 59);
    const hi = estimatePotential({ truePot: 98, currentRating: 50, riderId: `r${i}`, teamId: "t1", knowledge: scoutKnow(1, 1) }, PARAMS);
    assert.ok(hi.value <= 99);
  }
});

test("egen rytter: flere afregnede datoer og bedre stab gør skønnet sikrere", () => {
  assert.equal(certaintyWord(uncertaintyFor({ own: true, trainingDates: 6 }, PARAMS), PARAMS), "unsure");
  assert.equal(certaintyWord(uncertaintyFor({ own: true, trainingDates: 13 }, PARAMS), PARAMS), "fair");
  assert.equal(certaintyWord(uncertaintyFor({ own: true, trainingDates: 21 }, PARAMS), PARAMS), "sure");
  assert.equal(certaintyWord(uncertaintyFor({ own: true, trainingDates: 14, staffSpeed: 1 }, PARAMS), PARAMS), "sure");
});
