// Beviser at splittet af den ene vægt-tabel i fire er en REN refaktorering
// (#3665, spec §D3 + gates R2/R3).
//
// Hele sikkerheden i #3665 er påstanden "intet flytter sig". De tre tabeller der
// styrer eksisterende rytterdata — klassifikation, loft-formning og markedsværdi
// — skal ved ikrafttræden være bit-identiske med den ENE tabel de blev udskilt
// fra. Er de det, kan ingen rytters type, loft, potentiale eller markedsværdi
// bevæge sig, uanset hvad #3665 ellers rører.
//
// NÅR EN AF DEM SKAL DIVERGERE (og det skal de, hver for sig):
//   - capsShapingWeights ændres i trinnet efter #3592 (positioning formes op).
//     Fjern den fra IDENTICAL_AT_SPLIT nedenfor og skriv hvorfor. Den ændring
//     kræver en prod-mutation og dermed ejer-go, jf. spec §5.
//   - valuationWeights hører til #3448/#3353-sporet og kræver bevis for R3.
//   - classifierWeights er FROSSET i rytter-pakken — se dens egen test nedenfor.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { CLASSIFIER_WEIGHTS } from "./weights/classifierWeights.js";
import { CAPS_SHAPING_WEIGHTS } from "./weights/capsShapingWeights.js";
import { VALUATION_WEIGHTS } from "./weights/valuationWeights.js";
import { RIDER_TYPES, RIDER_TYPE_KEYS } from "./riderTypes.js";

// Tabellerne der stadig skal være identiske. Fjern en post herfra NÅR den
// bevidst divergerer — aldrig for at få en rød test grøn.
const IDENTICAL_AT_SPLIT = [
  ["classifierWeights", CLASSIFIER_WEIGHTS],
  ["capsShapingWeights", CAPS_SHAPING_WEIGHTS],
  ["valuationWeights", VALUATION_WEIGHTS],
];

// Hash af tabellen som den så ud FØR splittet (backend/lib/riderTypes.js på
// main @ 0b1a1f4c). Pinner både vægte OG array-rækkefølge — rækkefølgen er
// tie-break-prioritet i klassifikatoren, så en omarrangering er en adfærds-
// ændring selvom vægtene er ens.
const PRE_SPLIT_SHAPE = [
  { key: "sprinter", weights: { acceleration: 3, sprint: 2, flat: 1, durability: 1, climbing: -2, endurance: -1 } },
  { key: "tt", weights: { time_trial: 3, climbing: -2, sprint: -1, punch: -1 } },
  { key: "climber", weights: { climbing: 3, tempo: 2, punch: 1, endurance: 1, sprint: -1 } },
  { key: "puncheur", weights: { punch: 3, tempo: 2, endurance: 1, time_trial: -1, sprint: -1 } },
  { key: "brostensrytter", weights: { cobblestone: 6, flat: 2, endurance: 1, punch: 1, climbing: -1 } },
  { key: "baroudeur", weights: { aggression: 3, flat: 1, punch: 1, endurance: 1, descending: 1, recovery: 1, time_trial: -1 } },
  { key: "rouleur", weights: { flat: 4, endurance: 1, climbing: -1, sprint: -1 } },
  { key: "gc", weights: { climbing: 3, time_trial: 3, recovery: 2, tempo: 2, endurance: 1, durability: 1, sprint: -2 } },
];

const shapeOf = (table) => table.map((t) => ({ key: t.key, weights: { ...t.weights } }));
const hashOf = (table) => createHash("sha256").update(JSON.stringify(shapeOf(table))).digest("hex");

test("#3665: de tre data-styrende vægt-tabeller er bit-identiske ved splittet (R2/R3)", () => {
  for (const [name, table] of IDENTICAL_AT_SPLIT) {
    assert.deepEqual(
      shapeOf(table), PRE_SPLIT_SHAPE,
      `${name} afviger fra tabellen FØR splittet. #3665 lover at intet flytter sig — `
      + "en ændring her ville flytte typer, lofter eller markedsværdier på eksisterende ryttere."
    );
  }
});

test("#3665: tabellerne deler ikke literal — en mutation af én smitter ikke af", () => {
  // Duplikeringen ER funktionen. Delte de en literal, ville en fremtidig
  // vægt-rettelse i ét formål stille ændre de tre andre — præcis den rod-årsag
  // splittet fjerner. Verificeret via objekt-identitet, ikke via værdi.
  const seen = new Set();
  for (const [name, table] of IDENTICAL_AT_SPLIT) {
    assert.ok(!seen.has(table), `${name} peger på samme array-objekt som en anden tabel`);
    seen.add(table);
    for (const row of table) {
      assert.ok(Object.isFrozen(row.weights), `${name}.${row.key}.weights skal være frosset`);
    }
  }
});

test("#3665: classifierWeights er FROSSET i rytter-pakken (ejer 13/8)", () => {
  // Målt read-only mod prod 13/8: alle 8.731 levende ryttere har et
  // archetype_draw, og primary_type matcher trækket i 100 % af tilfældene. Denne
  // tabel klassificerer altså nul eksisterende ryttere — men efter en uge hvor
  // spillerne så typer flakke, er "ingen rytters type kan bevæge sig" den
  // vigtigste egenskab pakken har. Hash'en gør et uheld umuligt.
  assert.equal(
    hashOf(CLASSIFIER_WEIGHTS),
    createHash("sha256").update(JSON.stringify(PRE_SPLIT_SHAPE)).digest("hex"),
    "classifierWeights er ændret. Den er frosset i #3664-pakken — ophæv frysningen "
    + "eksplicit med ejeren før du opdaterer denne test."
  );
});

test("#3665: riderTypes.RIDER_TYPES er nu classifierWeights, uændret udadtil", () => {
  assert.equal(RIDER_TYPES, CLASSIFIER_WEIGHTS, "RIDER_TYPES skal re-eksportere classifierWeights");
  assert.deepEqual(
    [...RIDER_TYPE_KEYS],
    ["sprinter", "tt", "climber", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"],
    "type-rækkefølgen er tie-break-prioritet + dropdown-orden og må ikke ændres"
  );
});
