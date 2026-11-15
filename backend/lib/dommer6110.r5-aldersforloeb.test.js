// DOMMER #6110 R5: proeven af aldersforloebs-reglen (Fable-dom 15/11, fund 5). Uden private tal.
//
// Reglen (dommer6110.r5aldersforloeb.mjs) skal godtage ejerens form (fuld til 26, et fald
// hvert aar fra 27, ca. en fjerdedel ved 31) og afvise en kurve med naesten fuld udvikling
// til 30 og et brat fald ved 31, som den foerste udgave af proeven lod gaa igennem.

import test from "node:test";
import assert from "node:assert/strict";

import { aldersforloebBrud } from "./dommer6110.r5aldersforloeb.mjs";

/** Lineaer interpolation mellem (alder, andel)-punkter; foer foerste punkt = 1, efter sidste = sidste. */
const kurve = (punkter) => (alder) => {
  if (alder <= punkter[0][0]) return punkter[0][1];
  for (let i = 1; i < punkter.length; i++) {
    const [a1, v1] = punkter[i];
    if (alder <= a1) {
      const [a0, v0] = punkter[i - 1];
      return v0 + ((v1 - v0) * (alder - a0)) / (a1 - a0);
    }
  }
  return punkter.at(-1)[1];
};

test("R5-reglen: ejerens form med et jaevnt fald hvert aar fra 27 til ca. en fjerdedel ved 31 holder", () => {
  const ejer = kurve([[26, 1], [27, 0.85], [28, 0.7], [29, 0.55], [30, 0.4], [31, 0.25], [40, 0.2]]);
  assert.deepEqual(aldersforloebBrud(ejer), []);
  // En blid kurve (mindre fald i starten, mere senere) er stadig et jaevnt fald.
  const blid = kurve([[26, 1], [27, 0.9], [28, 0.78], [29, 0.62], [30, 0.44], [31, 0.25], [40, 0.2]]);
  assert.deepEqual(aldersforloebBrud(blid), []);
});

test("R5-reglen: naesten fuld udvikling til 30 og et brat fald ved 31 er roed", () => {
  // Hvert aar et haar lavere ("mindre for hvert aar" i den gamle proeve), saa et brat fald.
  const brat = kurve([[26, 1], [27, 0.99], [28, 0.98], [29, 0.97], [30, 0.96], [31, 0.25], [40, 0.2]]);
  const fejl = aldersforloebBrud(brat);
  assert.ok(fejl.some((f) => /fra 26 til 27/.test(f)), fejl.join("; "));
  assert.ok(fejl.some((f) => /fra 29 til 30/.test(f)), "hvert aar fra 27 til 30 skal vaere for lille et fald");
  assert.ok(!fejl.some((f) => /fra 30 til 31/.test(f)), "det brate fald ved 31 er i sig selv et stort fald");
  // Den gamle proeves betingelse ("hvert aar under aaret foer") godtog kurven.
  for (let alder = 27; alder <= 31; alder++) assert.ok(brat(alder) < brat(alder - 1));
});

test("R5-reglen: de oevrige dele af ejerens regel er uaendrede", () => {
  assert.ok(aldersforloebBrud(kurve([[25, 1], [26, 0.9], [31, 0.25]])).some((f) => /26 aar skal have fuld/.test(f)));
  assert.ok(aldersforloebBrud(kurve([[26, 1], [27, 0.85], [28, 0.7], [29, 0.55], [30, 0.4], [31, 0.1]])).some((f) => /en fjerdedel/.test(f)));
  assert.ok(aldersforloebBrud(kurve([[26, 1], [27, 0.85], [28, 0.7], [29, 0.55], [30, 0.4], [31, 0.25], [35, 0]])).some((f) => /aldrig nul/.test(f)));
});
