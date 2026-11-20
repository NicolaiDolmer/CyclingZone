// #7855 HUL 1 MED "NAAR HAN ER SAT"-LED (Fable-dom PR #8218 16/11; ejerbeslutning 16/11, 17/11 og 19/11).
//   Ejer 17/11: "Planen venter, til udbruddet er dannet. Kommer rytteren ikke med, ... gaar han videre
//   til naeste led."
//   Ejer 19/11 (aendrer 17/11): en rytter, der misser morgenudbruddet, maa tage point, hvis han kommer
//   med i et senere udbrud paa samme etape, uanset planens opbygning. "Naar han er sat"-leddet styrer
//   kun, hvad han goer uden for et udbrud. Proeven er skrevet om til den regel (ejer 19/11).
//   Ejer 16/11 (S2): ingen bjergjagt fra feltet.
//   Fable-dom 17/11 fund 2: pointjagt med sat-led og "hentet" skal ogsaa have en pris- og loebsproeve.
//
// DOMMERENS LAESNING:
//   - "Planen venter": "kom ikke med" afgoeres kun ved en graense, hvor dagens udbrud ligger paa vejen.
//   - Efter skiftet (kom ikke med, eller hentet) koerer han ikke om en eneste top eller spurt uden for
//     et udbrud. Ligger han i et senere udbrud ved passagen, koerer han om den (ejer 19/11).
//   - Kom han aldrig med, eller koerte han aldrig om en passage, faar han samme point og samme pris som
//     samme plan uden jagt. Jagten er aldrig billigere. Planen med jagt kan vente et segment laengere
//     paa udbruddet end samme plan uden jagt; sker skiftet ved samme graense, er hele loebet det samme
//     (Fable-dom 20/11).
//   Etape 107 (ejerens ord) og to etapeformer, hvor et nyt udbrud efter en tidlig indhentning tager
//   hjaelperen med; pointjagten paa flade dage med spurter og paa etape 107 med spurter. Froeet "f-5"
//   paa de flade etaper danner udbruddet foerst efter foerste graense (proever ventereglen).
//
// Proeven kender ingen tal fra motoren. Den sammenligner kun motorens egne svar.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, medSpurter, fladMedSpurter, passager, medIUdbrud, jagede, betalte, pris, loebet, hash, HJAELPERE } from "./dommer7855.fixtures.mjs";

const SAT = { task: "ride_in", from: { at: "dropped" } };
const UDEN_JAGT = [{ task: "breakaway" }, SAT];
// "f-5" (Fable-dom 20/11): paa den flade etape dannes udbruddet foerst efter foerste graense, saa
// "planen venter"-proeven har taender (den bliver roed, hvis ventereglen fjernes).
const FROE = ["s2-a", "s2-b", "s2-c", "h-5", "f-5"];

/** Etape 107 med dommerens egne spurter undervejs (andele af distancen, saa de altid ligger foer maal). */
function etape107MedSpurter() {
  const row = etape(107);
  return medSpurter(row, [0.3, 0.55, 0.8].map((f) => Math.round(row.distance_km * f)));
}

const ARTER = {
  kom: { jagt: "hunt_kom", passage: "kom", etaper: () => [107, 53, 17, 20].map((nr) => [`etape ${nr}`, etape(nr)]) },
  sprint: { jagt: "hunt_points", passage: "sprint", etaper: () => [["flad 3 spurter", fladMedSpurter(3)], ["flad 2 spurter", fladMedSpurter(2)], ["etape 107 med spurter", etape107MedSpurter()]] },
};

const foran = (b, id) => (b?.groups ?? []).some((g) => (g.kind === "breakaway" || g.kind === "solo") && g.rider_ids.includes(id));
const udbrudPaaVejen = (b) => (b?.groups ?? []).some((g) => (g.kind === "breakaway" || g.kind === "solo") && g.rider_ids.length > 0);
/** Gruppebilledet ved km (det seneste foer eller paa km). */
const billedeVed = (k, km) => (k.output.groupSnapshots ?? []).filter((b) => b.km <= km).at(-1);
/** Gruppebilledet ved etapens foerste segmentgraense. */
const foersteBillede = (k) => (k.output.groupSnapshots ?? [])[0];
/** Passagernes point (loebets point uden tiderne). */
const pointene = (k) => loebet(k).passager;
/** Skifter planen med jagt og samme plan uden jagt ved samme graense (eller ingen af dem)? */
const sammeGraense = (d) => (d.skift?.km ?? null) === (d.rentSkift?.km ?? null);
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
      navn: `${art} ${navn} ${id} ${froe}`, id, k, rent, skift, rentSkift: skiftet(rent, id),
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
    // Taender (Fable-dom 20/11): proeven skal ramme dage, hvor udbruddet dannes EFTER foerste graense.
    // Kun dér kan "planen venter" skelnes fra en plan, der gaar videre ved foerste graense.
    const sene = missede.filter((d) => !udbrudPaaVejen(foersteBillede(d.k)));
    assert.ok(sene.length >= 1, "proeven skal ramme dage, hvor udbruddet dannes efter foerste graense");
    for (const d of missede) {
      const b = billedeVed(d.k, d.skift.km);
      assert.ok(udbrudPaaVejen(b), `${d.navn}: planen gik videre ved km ${d.skift.km}, foer udbruddet var dannet`);
      assert.ok(!foran(b, d.id), `${d.navn}: "kom ikke med", men han laa i udbruddet`);
    }
    for (const d of sene) assert.ok(d.skift.km > foersteBillede(d.k).km, `${d.navn}: planen ventede ikke paa udbruddet`);
  });

  test(`hul 1 + saet-led (${art}): kom han ikke med, eller er han hentet, jager han kun videre i et senere udbrud (ejer 19/11)`, async () => {
    const alle = await dage(art);
    assert.ok(alle.some((d) => d.skift?.params.reason === "caught"), "proeven skal ramme dage, hvor han er hentet");
    assert.ok(alle.some((d) => d.skift?.params.reason === "missed_break"), "proeven skal ramme dage, hvor han ikke kom med");
    for (const d of alle) {
      for (const p of d.efterSkift) assert.ok(!p.jaget || p.foran, `${d.navn}: koerte om en passage km ${p.km} efter skiftet (${d.skift.params.reason}) uden at ligge i et udbrud`);
    }
  });

  test(`hul 1 + saet-led (${art}): proeven rammer et senere udbrud efter skiftet, og dér koerer han om passagen (ejer 19/11)`, async () => {
    // Ejer 19/11: misser han morgenudbruddet (eller er han hentet) og kommer med i et senere udbrud,
    // koerer han om pointene dér, uanset planens opbygning. Uden saadanne dage har proeven ingen taender.
    const sene = (await dage(art)).filter((d) => d.efterSkift.some((p) => p.foran));
    assert.ok(sene.length >= 1, "proeven skal ramme dage, hvor han kom med i et senere udbrud efter skiftet");
    for (const d of sene) {
      for (const p of d.efterSkift) if (p.foran) assert.ok(p.jaget, `${d.navn}: laa i et senere udbrud ved km ${p.km} efter skiftet (${d.skift.params.reason}), men koerte ikke om passagen`);
    }
  });

  // Fable-dom 20/11 (ejer: "Behold, skaerp proeverne"): planen med jagt venter paa udbruddet, samme plan
  // uden jagt goer ikke. Dannes udbruddet sent, kan han derfor skifte et segment senere, og tiderne kan
  // flytte sig en anelse (ejeren har accepteret den bivirkning). Point og pris er altid de samme; hele
  // loebet er det samme paa de dage, hvor skiftet sker ved samme graense i begge planer.
  test(`hul 1 + saet-led (${art}): kom han aldrig med, er point og pris som samme plan uden jagt (loebet, naar skiftet sker ved samme graense)`, async () => {
    const ikkeMed = (await dage(art)).filter((d) => !d.komMed);
    assert.ok(ikkeMed.length >= 3, "proeven skal ramme dage, hvor han ikke kom med");
    assert.ok(ikkeMed.filter(sammeGraense).length >= 3, "proeven skal ramme dage, hvor skiftet sker ved samme graense");
    for (const d of ikkeMed) {
      assert.equal(d.jagede, 0, `${d.navn}: jagt uden udbrud paa et udbrudsled med saet-led`);
      assert.equal(betalte(d.k, d.id, ARTER[art].passage), 0, `${d.navn}: betalte for en passage uden udbrud`);
      assert.equal(hash(pointene(d.k)), hash(pointene(d.rent)), `${d.navn}: pointene skal vaere som uden jagt`);
      assert.equal(await pris(d.k, d.id), await pris(d.rent, d.id), `${d.navn}: prisen skal vaere som uden jagt`);
      if (sammeGraense(d)) assert.equal(hash(loebet(d.k)), hash(loebet(d.rent)), `${d.navn}: skiftet sker ved samme graense, saa loebet skal vaere som uden jagt`);
    }
  });

  test(`hul 1 + saet-led (${art}): koerte han aldrig om en passage, er point og pris som uden jagt; jagten er aldrig billigere`, async () => {
    const alle = await dage(art);
    const uden = alle.filter((d) => d.jagede === 0);
    assert.ok(uden.length >= 3, "proeven skal ramme dage uden jagt");
    assert.ok(uden.filter(sammeGraense).length >= 3, "proeven skal ramme dage uden jagt, hvor skiftet sker ved samme graense");
    for (const d of uden) {
      assert.equal(hash(pointene(d.k)), hash(pointene(d.rent)), `${d.navn}: pointene skal vaere som uden jagt`);
      assert.equal(await pris(d.k, d.id), await pris(d.rent, d.id), `${d.navn}: prisen skal vaere som uden jagt`);
      if (sammeGraense(d)) assert.equal(hash(loebet(d.k)), hash(loebet(d.rent)), `${d.navn}: skiftet sker ved samme graense, saa loebet skal vaere som uden jagt`);
    }
    for (const d of alle) assert.ok((await pris(d.k, d.id)) >= (await pris(d.rent, d.id)), `${d.navn}: billigere med jagt`);
  });
}

test("hul 1 + saet-led (kom): bjergjagten rammer flere senere udbrud efter skiftet", async () => {
  // Bjergproeven skal ramme mere end en enkelt dag med et senere udbrud, saa reglen fra 19/11 er bevist
  // paa flere etaper og froe, ikke kun paa et tilfaelde.
  const sene = (await dage("kom")).filter((d) => d.efterSkift.some((p) => p.foran && p.jaget));
  assert.ok(sene.length >= 2, "proeven skal ramme dage, hvor han koerte om en top i et senere udbrud efter skiftet");
});

test("hul 1 + saet-led (kom): ingen bjergjagt fra feltet", async () => {
  for (const d of await dage("kom")) {
    for (const p of d.ps) if (p.jaget) assert.ok(p.foran || d.k.output.groupSnapshots === undefined, `${d.navn}: koerte om toppen km ${p.km} uden at ligge i udbruddet`);
  }
});
