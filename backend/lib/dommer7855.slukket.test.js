// DOMMER #7855, regel R1: MED SLUKKET KONTAKT ER ALT PRAECIS SOM FOER.
//   Ejer 7/11: "Slukket = motoren kender ikke opgaverne, og alt er bit-identisk med i dag."
//   Ejer 13/11: de tre valg "bygges ... bag den slukkede kontakt jersey_hunt_7855. Intet taendes
//   uden ejerens 'koer'."
//   Ejer 13/11 (valg 1): "Hent point" i spurterne fra feltet bliver, som det er (R4).
//
// Facit (__fixtures__/dommer7855Facit.json) er frosset af dommeren paa origin/main 8a02593dd,
// FOER de tre valg blev bygget. Proeven maa ikke rettes til, og facit maa ikke genskabes med ny
// kode: flytter et aftryk sig, har byggeriet aendret noget, der skulle staa stille.
// Decimaltal er afrundet foer hash (#8113).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { slukketAftryk, hentPointAftryk } from "./dommer7855.facit-scenarier.mjs";

const FACIT = JSON.parse(readFileSync(new URL("./__fixtures__/dommer7855Facit.json", import.meta.url), "utf8"));
const nu = await slukketAftryk();

const afvigelser = (faktisk, frosset) => Object.keys(frosset).filter((k) => JSON.stringify(faktisk[k]) !== JSON.stringify(frosset[k]));

test("R1 facit er dommerens: frosset foer byggeriet, og stort nok til at maale noget", () => {
  assert.match(FACIT.kilde, /^[0-9a-f]{40}$/);
  assert.equal(FACIT.kilde, "8a02593dda3bf23de73e4de3e2a8a51b306a7869", "facit skal vaere det, dommeren froes paa main foer byggeriet");
  assert.ok(Object.keys(FACIT.slukket).length >= 80, "for faa slukkede scenarier");
  assert.ok(Object.keys(FACIT.taendtUdenJagt).length >= 40, "for faa scenarier med taendt kontakt uden jagt");
});

test("R1 slukket: hele loebet og alle rytteres traethed er praecis som foer (ogsaa med gemte jagt-planer)", () => {
  assert.deepEqual(Object.keys(nu.slukket).sort(), Object.keys(FACIT.slukket).sort(), "samme scenarier som facit");
  const flyttet = afvigelser(nu.slukket, FACIT.slukket);
  assert.deepEqual(flyttet, [], `${flyttet.length} af ${Object.keys(FACIT.slukket).length} slukkede scenarier har flyttet sig`);
});

test("R1 taendt uden valgt jagt: praecis som slukket", () => {
  assert.deepEqual(Object.keys(nu.taendtUdenJagt).sort(), Object.keys(FACIT.taendtUdenJagt).sort(), "samme scenarier som facit");
  const flyttet = afvigelser(nu.taendtUdenJagt, FACIT.taendtUdenJagt);
  assert.deepEqual(flyttet, [], `${flyttet.length} scenarier med taendt kontakt uden jagt har flyttet sig`);
  for (const k of Object.keys(nu.taendtUdenJagt)) assert.deepEqual(nu.taendtUdenJagt[k], nu.slukket[k], `${k}: taendt uden jagt er ikke som slukket`);
});

test("R1 scenarierne maaler noget: gemte jagt-planer og planer uden jagt giver forskellige loeb", () => {
  let forskellige = 0;
  for (const k of Object.keys(FACIT.slukket)) {
    if (!k.endsWith(":med-gemt-jagt")) continue;
    if (FACIT.slukket[k].loeb !== FACIT.slukket[k.replace(":med-gemt-jagt", ":uden-jagt")].loeb) forskellige++;
  }
  assert.ok(forskellige >= 30, `kun ${forskellige} scenarier adskiller sig; facit ville vaere tomt`);
});

test("R4 (ejer 13/11): 'Hent point' fra feltet bliver, som det er: samme loeb, samme point, samme jaegere", async () => {
  const hp = await hentPointAftryk();
  assert.ok(FACIT.hentPointJagedePassager >= 10, "facit skal indeholde passager, der blev jaget");
  assert.equal(hp.jagedePassager, FACIT.hentPointJagedePassager, "antal passager med jaegere");
  const flyttet = afvigelser(hp.aftryk, FACIT.hentPoint);
  assert.deepEqual(flyttet, [], `${flyttet.length} af ${Object.keys(FACIT.hentPoint).length} loeb med 'Hent point' har flyttet sig (prisen er ikke med; den aendres af valg 2)`);
});
