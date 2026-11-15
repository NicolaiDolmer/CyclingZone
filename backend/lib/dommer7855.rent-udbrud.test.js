// DOMMER #7855: TAENDT KONTAKT UDEN JAGT AENDRER ALDRIG PRISEN FOR ET RENT UDBRUD.
//   Ejer 7/11: "Slukket = motoren kender ikke opgaverne, og alt er bit-identisk med i dag."
//   Ejer 13/11 (valg 3): "Samme pris" handler om JAGTEN fra feltet. En rytter uden jagt-opgave
//   har ingen jagt at betale for.
//   Dommerens regel R1: taendt kontakt uden valgt jagt er som slukket.
//
// Hvorfor proeven findes: dommerens foerste proever fangede ikke en indsat fejl, hvor "samme
// pris" ogsaa ramte hjaelpere med et rent udbrud, naar kontakten var taendt (prisen steg for
// ham, der missede udbruddet uden nogen jagt-opgave). Denne proeve lukker det hul i proeverne.
//
// Proeven koerer samme dag to gange, taendt og slukket, med et rent udbrud i planen (ingen
// jagt-opgave noget sted i feltet), og kraever: samme loeb, samme pris for alle ryttere, og samme
// trin for alle ryttere. Den daekker baade dage, hvor han kommer med, og dage, hvor han misser
// udbruddet, med og uden et led bagefter.
//
// Sidste proeve gaelder den slukkede kontakt paa hullernes egne dage (en tidlig spurt med et led
// "naar han er sat", og et sent dannet udbrud): slukket koeres "Gaa i udbrud + Hent point" praecis
// som rent udbrud. At slukket er uaendret mod i dag, baerer dommerens frosne facit (R1).
//
// "Koster" er traetheden efter etapen. Proeven kender ingen tal fra motoren. Den sammenligner
// kun motorens egne svar, afrundet, og skriver ingen priser eller forhold ud, naar den fejler.
// Skrevet FOER rettelsen. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { motor, koerEtape, etape, fladMedSpurter, medSpurter, planRute, belastninger, medIUdbrud, loebet, hash, afrund, rolleAf, HJAELPERE } from "./dommer7855.fixtures.mjs";

const M = await motor();

const FROE = ["ru-a", "ru-b", "ru-c"];
const r6 = (x) => afrund(x, 6);
// Hjaelperne (dem "samme pris" handler om) og de to andre roller, der maa faa udbrud og jagt.
const RYTTERE = [...HJAELPERE, "t0r4", "t0r5"];
const ETAPER = [
  ["flad", () => etape(20)],
  ["flad, 3 spurter", () => fladMedSpurter(3)],
  ["rullende", () => etape(37)],
  ["bjerg", () => etape(13)],
];
const PLANER = [
  ["Gaa i udbrud", [{ task: "breakaway" }]],
  ["Gaa i udbrud, og koer roligt i maal, naar han er sat", [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }]],
];

let cache = null;
/** For hver etape, plan, rytter og froe: samme dag taendt og slukket, med et rent udbrud. */
async function alleDage() {
  if (cache) return cache;
  cache = [];
  for (const [navn, row] of ETAPER) for (const [planNavn, legs] of PLANER) {
    for (const id of RYTTERE) for (const froe of FROE) {
      const taendt = await koerEtape(row(), froe, { planer: { [id]: legs }, taendt: true });
      const slukket = await koerEtape(row(), froe, { planer: { [id]: legs }, taendt: false });
      const prisT = await belastninger(taendt);
      const prisS = await belastninger(slukket);
      cache.push({
        navn, planNavn, id, froe,
        rolle: rolleAf(id),
        komMed: await medIUdbrud(taendt, id),
        sammeLoeb: hash(loebet(taendt)) === hash(loebet(slukket)),
        andenPris: [...prisT.keys()].filter((r) => r6(prisT.get(r)) !== r6(prisS.get(r))),
        andetTrin: [...taendt.efforts.keys()].filter((r) => taendt.efforts.get(r) !== slukket.efforts.get(r)),
        egenPris: { taendt: prisT.get(id), slukket: prisS.get(id) },
      });
    }
  }
  return cache;
}
const hvor = (d) => `${d.navn}, '${d.planNavn}', ${d.id} (${d.rolle}) ${d.froe}, ${d.komMed ? "kom med" : "kom ikke med"}`;

test("rent udbrud, forudsaetning: planerne er gyldige taendt og slukket, og dagene daekker baade dem, der kom med, og dem, der missede udbruddet", async () => {
  for (const [navn, row] of ETAPER) for (const taendt of [true, false]) {
    const rute = await planRute(row(), taendt);
    for (const [planNavn, legs] of PLANER) for (const id of RYTTERE) {
      assert.equal(M.sp.validateStagePlanLegs(legs, rolleAf(id), rute), null, `${navn}, '${planNavn}', ${rolleAf(id)}, ${taendt ? "taendt" : "slukket"}: planen skal vaere gyldig`);
      assert.equal(M.sp.planHasJerseyHunt(legs), false, `'${planNavn}' har ingen jagt-opgave`);
    }
  }
  const dage = await alleDage();
  const hjaelpere = dage.filter((d) => d.rolle === "helper");
  assert.ok(hjaelpere.filter((d) => !d.komMed).length >= 30, `for faa dage, hvor en hjaelper missede udbruddet (${hjaelpere.filter((d) => !d.komMed).length})`);
  assert.ok(hjaelpere.filter((d) => d.komMed).length >= 15, `for faa dage, hvor en hjaelper kom med (${hjaelpere.filter((d) => d.komMed).length})`);
  for (const [planNavn] of PLANER) assert.ok(hjaelpere.filter((d) => d.planNavn === planNavn && !d.komMed).length >= 12, `'${planNavn}': for faa dage, hvor en hjaelper missede udbruddet`);
  assert.ok(dage.filter((d) => d.rolle !== "helper" && !d.komMed).length >= 4, "for faa dage, hvor en jaeger eller fri rolle missede udbruddet");
});

test("rent udbrud (ejer 7/11, dommerens R1): taendt uden jagt er samme loeb som slukket", async () => {
  const fejl = (await alleDage()).filter((d) => !d.sammeLoeb).map((d) => `${hvor(d)}: loebet er ikke det samme taendt og slukket`);
  assert.deepEqual(fejl, [], "taendt kontakt uden jagt aendrede loebet");
});

test("rent udbrud (ejer 7/11 og 13/11): taendt uden jagt aendrer ikke prisen for et rent udbrud, hverken for ham, der kom med, eller ham, der missede det", async () => {
  const fejl = [];
  for (const d of await alleDage()) {
    if (r6(d.egenPris.taendt) !== r6(d.egenPris.slukket)) fejl.push(`${hvor(d)}: rent udbrud er ${d.egenPris.taendt > d.egenPris.slukket ? "dyrere" : "billigere"} taendt end slukket`);
    else if (d.andenPris.length > 0) fejl.push(`${hvor(d)}: prisen aendrede sig for ${d.andenPris.length} andre ryttere`);
    if (d.andetTrin.length > 0) fejl.push(`${hvor(d)}: dagen taeller paa et andet trin taendt end slukket for ${d.andetTrin.join(", ")}`);
  }
  assert.deepEqual(fejl, [], "taendt kontakt uden jagt aendrede prisen for et rent udbrud");
});

// Hullernes egne dage (se hul 1- og hul 2-proeverne), her med slukket kontakt.
const NAAR_SAT = { task: "ride_in", from: { at: "dropped" } };
const HULDAGE = [
  ["tidlig spurt, flad", () => medSpurter(etape(20), [10]), ["hul2-a", "hul2-b"], [NAAR_SAT]],
  ["tidlig spurt, bjerg", () => medSpurter(etape(13), [10]), ["hul2-a", "hul2-b"], [NAAR_SAT]],
  ["sent dannet udbrud", () => etape(53), ["h1-a", "h1-b"], []],
  ["sent dannet udbrud (b)", () => etape(72), ["h1-b", "h1-c"], []],
];

test("slukket (ejer 7/11): paa hullernes dage koeres 'Gaa i udbrud + Hent point' praecis som rent udbrud, naar kontakten er slukket", async () => {
  const fejl = [];
  let dage = 0;
  for (const [navn, row, froe, hale] of HULDAGE) for (const id of HJAELPERE) for (const f of froe) {
    const jagt = await koerEtape(row(), f, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }, ...hale] }, taendt: false });
    const rent = await koerEtape(row(), f, { planer: { [id]: [{ task: "breakaway" }, ...hale] }, taendt: false });
    dage++;
    const prisJ = await belastninger(jagt);
    const prisR = await belastninger(rent);
    if (hash(loebet(jagt)) !== hash(loebet(rent))) fejl.push(`${navn}, ${id} ${f}: slukket er loebet ikke det samme som rent udbrud`);
    if ((jagt.output.passages ?? []).some((p) => (p.hunters ?? []).length > 0 || (p.hunt_work_7855 ?? []).length > 0)) fejl.push(`${navn}, ${id} ${f}: slukket kender motoren alligevel jagten`);
    const andre = [...prisJ.keys()].filter((r) => r6(prisJ.get(r)) !== r6(prisR.get(r)));
    if (andre.length > 0) fejl.push(`${navn}, ${id} ${f}: slukket er prisen en anden end for rent udbrud (${andre.join(", ")})`);
    const trin = [...jagt.efforts.keys()].filter((r) => jagt.efforts.get(r) !== rent.efforts.get(r));
    if (trin.length > 0) fejl.push(`${navn}, ${id} ${f}: slukket taeller dagen paa et andet trin end rent udbrud (${trin.join(", ")})`);
  }
  assert.ok(dage >= 30, `kun ${dage} dage`);
  assert.deepEqual(fejl, [], "slukket kontakt: planen med jagt koeres ikke som rent udbrud");
});
