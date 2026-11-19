// #7855 HUL 1 MED "NAAR HAN ER SAT"-LED (Fable-dom PR #8218 16/11; ejerbeslutning 16/11 og 17/11).
//   Ejer 17/11: "Planen venter, til udbruddet er dannet. Kommer rytteren ikke med, er jagten slut, og
//   han gaar videre til naeste led." Formen hvor jagten foelger med og kan komme igen i et senere
//   udbrud, er afvist (urealistisk; bryder "alt har en aegte aarsag").
//   Ejer 16/11 (S2): ingen bjergjagt fra feltet.
//   Fable-dom 17/11 fund 2: pointjagt med sat-led og "hentet" skal ogsaa have en pris- og loebsproeve.
//
// DOMMERENS LAESNING:
//   - "Planen venter": "kom ikke med" afgoeres kun ved en graense, hvor dagens udbrud ligger paa vejen.
//   - "Jagten er slut": efter skiftet (kom ikke med, eller hentet) koerer han ikke om en eneste top
//     eller spurt, heller ikke naar han senere ligger i et nyt udbrud.
//   - Kom han aldrig med, eller koerte han aldrig om en passage, er dagen praecis som samme plan uden
//     jagt (samme loeb, samme pris). Jagten er aldrig billigere.
//   Etape 107 (ejerens ord) og to etapeformer, hvor et nyt udbrud efter en tidlig indhentning tager
//   hjaelperen med; pointjagten paa flade dage med spurter og paa etape 107 med spurter.
//
// Proeven kender ingen tal fra motoren. Den sammenligner kun motorens egne svar.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, medSpurter, fladMedSpurter, passager, medIUdbrud, jagede, betalte, pris, loebet, hash, HJAELPERE } from "./dommer7855.fixtures.mjs";

const SAT = { task: "ride_in", from: { at: "dropped" } };
const UDEN_JAGT = [{ task: "breakaway" }, SAT];
const FROE = ["s2-a", "s2-b", "s2-c", "h-5"];

/** Etape 107 med dommerens egne spurter undervejs (andele af distancen, saa de altid ligger foer maal). */
function etape107MedSpurter() {
  const row = etape(107);
  return medSpurter(row, [0.3, 0.55, 0.8].map((f) => Math.round(row.distance_km * f)));
}

const ARTER = {
  kom: { jagt: "hunt_kom", passage: "kom", etaper: () => [107, 53, 17].map((nr) => [`etape ${nr}`, etape(nr)]) },
  sprint: { jagt: "hunt_points", passage: "sprint", etaper: () => [["flad 3 spurter", fladMedSpurter(3)], ["flad 2 spurter", fladMedSpurter(2)], ["etape 107 med spurter", etape107MedSpurter()]] },
};

const foran = (b, id) => (b?.groups ?? []).some((g) => (g.kind === "breakaway" || g.kind === "solo") && g.rider_ids.includes(id));
const udbrudPaaVejen = (b) => (b?.groups ?? []).some((g) => (g.kind === "breakaway" || g.kind === "solo") && g.rider_ids.length > 0);
/** Gruppebilledet ved km (det seneste foer eller paa km). */
const billedeVed = (k, km) => (k.output.groupSnapshots ?? []).filter((b) => b.km <= km).at(-1);
const skiftet = (k, id) => (k.output.timeline?.events ?? []).find((e) => e.type === "stage_plan_leg" && e.params?.rider_id === id && (e.params.reason === "missed_break" || e.params.reason === "caught"));

const cache = new Map();
async function dage(art) {
  if (cache.has(art)) return cache.get(art);
  const a = ARTER[art];
  const ud = [];
  cache.set(art, ud);
  for (const [navn, row] of a.etaper()) for (const id of HJAELPERE) for (const froe of FROE) {
    const k = await koerEtape(row, froe, { planer: { [id]: [{ task: "breakaway", hunt: a.jagt }, SAT] } });
    const rent = await koerEtape(row, froe, { planer: { [id]: UDEN_JAGT } });
    const skift = skiftet(k, id);
    const ps = passager(k, a.passage).map((p) => ({ km: p.km, jaget: (p.hunters ?? []).includes(id), foran: foran(billedeVed(k, p.km), id) }));
    ud.push({
      navn: `${art} ${navn} ${id} ${froe}`, id, k, rent, skift,
      komMed: await medIUdbrud(k, id),
      efterSkift: skift ? ps.filter((p) => p.km > skift.km) : [],
      jagede: jagede(k, id, a.passage),
      ps,
    });
  }
  return ud;
}

for (const art of Object.keys(ARTER)) {
  test(`hul 1 + saet-led (${art}): "kom ikke med" afgoeres foerst, naar udbruddet ligger paa vejen`, async () => {
    const missede = (await dage(art)).filter((d) => d.skift?.params.reason === "missed_break");
    assert.ok(missede.length >= 3, "proeven skal ramme dage, hvor han ikke kom med");
    for (const d of missede) {
      const b = billedeVed(d.k, d.skift.km);
      assert.ok(udbrudPaaVejen(b), `${d.navn}: planen gik videre ved km ${d.skift.km}, foer udbruddet var dannet`);
      assert.ok(!foran(b, d.id), `${d.navn}: "kom ikke med", men han laa i udbruddet`);
    }
  });

  test(`hul 1 + saet-led (${art}): kom han ikke med, eller er han hentet, er jagten slut, ogsaa i et senere udbrud`, async () => {
    const alle = await dage(art);
    assert.ok(alle.some((d) => d.skift?.params.reason === "caught"), "proeven skal ramme dage, hvor han er hentet");
    for (const d of alle) {
      for (const p of d.efterSkift) assert.ok(!p.jaget, `${d.navn}: koerte om en passage km ${p.km} efter skiftet (${d.skift.params.reason})`);
    }
  });

  test(`hul 1 + saet-led (${art}): kom han aldrig med, er dagen praecis som samme plan uden jagt (loeb og pris)`, async () => {
    const ikkeMed = (await dage(art)).filter((d) => !d.komMed);
    assert.ok(ikkeMed.length >= 3, "proeven skal ramme dage, hvor han ikke kom med");
    for (const d of ikkeMed) {
      assert.equal(d.jagede, 0, `${d.navn}: jagt uden udbrud paa et udbrudsled med saet-led`);
      assert.equal(betalte(d.k, d.id, ARTER[art].passage), 0, `${d.navn}: betalte for en passage uden udbrud`);
      assert.equal(hash(loebet(d.k)), hash(loebet(d.rent)), `${d.navn}: loebet skal vaere som uden jagt`);
      assert.equal(await pris(d.k, d.id), await pris(d.rent, d.id), `${d.navn}: prisen skal vaere som uden jagt`);
    }
  });

  test(`hul 1 + saet-led (${art}): koerte han aldrig om en passage, er dagen som uden jagt; jagten er aldrig billigere`, async () => {
    const alle = await dage(art);
    const uden = alle.filter((d) => d.jagede === 0);
    assert.ok(uden.length >= 3, "proeven skal ramme dage uden jagt");
    for (const d of uden) {
      assert.equal(hash(loebet(d.k)), hash(loebet(d.rent)), `${d.navn}: loebet skal vaere som uden jagt`);
      assert.equal(await pris(d.k, d.id), await pris(d.rent, d.id), `${d.navn}: prisen skal vaere som uden jagt`);
    }
    for (const d of alle) assert.ok((await pris(d.k, d.id)) >= (await pris(d.rent, d.id)), `${d.navn}: billigere med jagt`);
  });
}

test("hul 1 + saet-led (kom): proeven rammer et senere udbrud efter skiftet, og han laa foran uden at jage", async () => {
  // Formen ejeren afviste 17/11 lod jagten gaelde her. Uden saadanne dage har proeven ingen taender.
  const sene = (await dage("kom")).filter((d) => d.efterSkift.some((p) => p.foran));
  assert.ok(sene.length >= 2, "proeven skal ramme dage, hvor han kom med i et senere udbrud efter skiftet");
  for (const d of sene) assert.ok(d.efterSkift.every((p) => !p.jaget), `${d.navn}: jagten fulgte med til et senere udbrud`);
});

test("hul 1 + saet-led (kom): ingen bjergjagt fra feltet", async () => {
  for (const d of await dage("kom")) {
    for (const p of d.ps) if (p.jaget) assert.ok(p.foran || d.k.output.groupSnapshots === undefined, `${d.navn}: koerte om toppen km ${p.km} uden at ligge i udbruddet`);
  }
});
