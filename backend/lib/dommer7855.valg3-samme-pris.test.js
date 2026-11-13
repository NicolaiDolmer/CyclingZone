// DOMMER #7855, ejerens valg 3 (13/11): SAMME PRIS FOR SAMME JAGT.
//   Ejer 13/11: "Samme pris". Kommer hjaelperen ikke med i udbruddet, koster jagten fra feltet det
//   samme som "Hent point" alene.
//   Ejer 12/11 (valg 1): udbrud og jagt sammen (han proever udbruddet som ellers).
//   Dom 2 og 3: jagten maa aldrig vaere en billigere vej til samme loeb.
//
// Regler (se dommerens regler.md): R9 (samme pris, naar han ikke kommer med), R10 (udbrudsforsoeget
// er det samme som uden jagten), R11 (jagten goer aldrig planen billigere).
//
// DOMMERENS FORSIGTIGE LAESNING (meldt til ejeren som spoergsmaal):
//   - "Koster" er traetheden efter etapen (det var den, ejeren fik vist som en sjettedel billigere).
//   - Proeven gaelder hjaelpere og "Hent point", som ejerens ord naevner. Bjergjagt, jaeger og fri
//     rolle er ikke afgjort af ejerens ord og proeves ikke her.
//   - At 'Hent point' alene aldrig er billigere end Haard, staar i valg 2-proeven (R8). Sammen med R9
//     betyder det, at jagten fra feltet efter et misset udbrud heller ikke er det.
//   - Prisen sammenlignes kun paa dage, der kan sammenlignes: samme etape, samme froe, han kom ikke
//     med i udbruddet, han koerte efter lige mange spurter fra feltet paa begge planer, og hans
//     oevrige arbejde (andel i front og i grupetto) var det samme.
//
// Skrevet FOER koden. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, fladMedSpurter, pris, betalte, jagede, arbejde, medIUdbrud, tider, afrund, HJAELPERE } from "./dommer7855.fixtures.mjs";

const FROE = ["v3-a", "v3-b", "v3-c", "v3-d"];
const r6 = (x) => afrund(x, 6);
const ETAPER = [["flad, 1 spurt", () => etape(20)], ["flad, 1 spurt (b)", () => etape(4)], ["flad, 2 spurter", () => fladMedSpurter(2)], ["flad, 3 spurter", () => fladMedSpurter(3)]];

let cache = null;
/** For hver etape, hjaelper og froe: udbrud + Hent point, Hent point alene og rent udbrud. */
async function alleDage() {
  if (cache) return cache;
  cache = [];
  for (const [navn, row] of ETAPER) {
    for (const id of HJAELPERE) for (const froe of FROE) {
      const begge = await koerEtape(row(), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }] } });
      const alene = await koerEtape(row(), froe, { planer: { [id]: [{ task: "hunt_points" }] } });
      const rent = await koerEtape(row(), froe, { planer: { [id]: [{ task: "breakaway" }] } });
      cache.push({
        navn, id, froe,
        kom: { begge: await medIUdbrud(begge, id), rent: await medIUdbrud(rent, id) },
        pris: { begge: await pris(begge, id), alene: await pris(alene, id), rent: await pris(rent, id) },
        jagede: { begge: jagede(begge, id, "sprint"), alene: jagede(alene, id, "sprint") },
        betalte: { begge: betalte(begge, id, "sprint"), alene: betalte(alene, id, "sprint") },
        arbejde: { begge: await arbejde(begge, id), alene: await arbejde(alene, id) },
        sammeLoebSomRent: JSON.stringify(tider(begge)) === JSON.stringify(tider(rent)),
      });
    }
  }
  return cache;
}

test("R9 valg 3 (ejer 13/11): kommer hjaelperen ikke med i udbruddet, koster jagten fra feltet det samme som 'Hent point' alene", async () => {
  const fejl = [];
  let sammenlignet = 0;
  const pr = new Map();
  for (const d of await alleDage()) {
    if (d.kom.begge) continue; // han kom med: ikke dette valg
    if (d.jagede.begge === 0 || d.jagede.begge !== d.jagede.alene || d.betalte.begge !== d.betalte.alene) continue;
    if (JSON.stringify(d.arbejde.begge) !== JSON.stringify(d.arbejde.alene)) continue;
    sammenlignet++;
    pr.set(d.navn, (pr.get(d.navn) ?? 0) + 1);
    if (r6(d.pris.begge) !== r6(d.pris.alene)) fejl.push(`${d.navn} ${d.id} ${d.froe}: udbrud + Hent point koster ${afrund(d.pris.begge / d.pris.alene, 3)} af 'Hent point' alene (${d.jagede.begge} spurt(er) fra feltet)`);
  }
  assert.ok(sammenlignet >= 20, `kun ${sammenlignet} dage kunne sammenlignes; proeven ville vaere tom`);
  for (const [navn] of ETAPER) assert.ok((pr.get(navn) ?? 0) >= 3, `${navn}: for faa dage kunne sammenlignes (${pr.get(navn) ?? 0})`);
  assert.deepEqual(fejl, [], "to priser for samme jagt fra feltet");
});

test("R10 valg 3 (ejer 12/11): udbrudsforsoeget er det samme med og uden jagten", async () => {
  let med = 0;
  let ikke = 0;
  for (const d of await alleDage()) {
    assert.equal(d.kom.begge, d.kom.rent, `${d.navn} ${d.id} ${d.froe}: jagten aendrede, om han kom med i udbruddet`);
    if (d.kom.begge) {
      med++;
      assert.ok(d.sammeLoebSomRent, `${d.navn} ${d.id} ${d.froe}: kom han med, er loebet det samme som rent udbrud`);
    } else ikke++;
  }
  assert.ok(med >= 5 && ikke >= 20, `froeene skal daekke begge udfald (med ${med}, ikke med ${ikke})`);
});

test("R11 (dom 2 og 3): jagten paa udbrudsleddet goer aldrig dagen billigere end rent udbrud", async () => {
  for (const d of await alleDage()) {
    assert.ok(r6(d.pris.begge) >= r6(d.pris.rent), `${d.navn} ${d.id} ${d.froe}: udbrud + Hent point er billigere end rent udbrud`);
  }
});
