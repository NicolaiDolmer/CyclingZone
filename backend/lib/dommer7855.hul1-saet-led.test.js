// #7855 HUL 1 MED "NAAR HAN ER SAT"-LED (Fable-dom PR #8218 16/11, ejer 16/11: "Vi kan foelge din anbefaling").
//   Fable 16/11: planen skifter led ved "kom ikke med", foer det udbrud han ender i er dannet, saa
//   jagten forsvinder, selv om han senere kommer med. Preview-rytteren har netop den plan:
//   "Gaa i udbrud + Hent bjergpoint", derefter "Koer ind, naar han er sat".
//   Ejer 16/11 (S2): jagten slutter, naar han ikke kommer med i udbruddet; ingen bjergjagt fra feltet.
//   Ejer 14/11 (hul 1): kom han med i et sent dannet udbrud, betaler han som rent udbrud plus det,
//   han faktisk koerte efter.
//
// LAESNING (maalt paa proeve-etaperne 17/11): det sene udbrud er et NYT udbrud efter en tidlig
// indhentning. Planen gaar videre til "naar han er sat" som et rent udbrud (samme indsats og pris),
// men jagten venter paa udbruddet: kommer han med i det nye udbrud, gaelder jagten igen, mens han
// ligger i det. Kommer han aldrig med, er dagen praecis som samme plan uden jagt.
//
// Proeven kender ingen tal fra motoren. Den sammenligner kun motorens egne svar.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, passager, medIUdbrud, jagede, betalte, pris, loebet, hash, HJAELPERE } from "./dommer7855.fixtures.mjs";

const MED_JAGT = [{ task: "breakaway", hunt: "hunt_kom" }, { task: "ride_in", from: { at: "dropped" } }];
const UDEN_JAGT = [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }];
// Etape 107 (ejerens ord) og to etapeformer, hvor et nyt udbrud efter en tidlig indhentning tager hjaelperen med.
const ETAPER = [107, 53, 17];
const FROE = ["s2-a", "s2-b", "s2-c", "h-5"];

// Gruppebillederne baerer kun gruppens art (som S2-proeven laeser dem).
const liggerIUdbrud = (b, id) => (b.groups ?? []).some((g) => (g.kind === "breakaway" || g.kind === "solo") && g.rider_ids.includes(id));
/** Laa han i udbruddet ved toppen? Gruppebilledet lige foer og lige efter, og intet "hentet" med ham imellem. */
function iUdbruddetVed(k, id, km) {
  const bs = k.output.groupSnapshots ?? [];
  const foer = bs.filter((b) => b.km < km).at(-1);
  const efter = bs.find((b) => b.km >= km);
  if (!foer || !efter || !liggerIUdbrud(foer, id) || !liggerIUdbrud(efter, id)) return false;
  return !(k.output.timeline?.events ?? []).some((e) => e.type === "breakaway_caught" && e.km > foer.km && e.km <= km && (e.params?.rider_ids ?? []).includes(id));
}
const skiftede = (k, id) => (k.output.timeline?.events ?? []).find((e) => e.type === "stage_plan_leg" && e.params?.rider_id === id && (e.params.reason === "missed_break" || e.params.reason === "caught"));

const cache = new Map();
async function dage() {
  if (cache.has("d")) return cache.get("d");
  const ud = [];
  cache.set("d", ud);
  for (const nr of ETAPER) for (const id of HJAELPERE) for (const froe of FROE) {
    const k = await koerEtape(etape(nr), froe, { planer: { [id]: MED_JAGT } });
    const rent = await koerEtape(etape(nr), froe, { planer: { [id]: UDEN_JAGT } });
    const skift = skiftede(k, id);
    const toppe = passager(k, "kom").map((p) => ({ km: p.km, jaget: (p.hunters ?? []).includes(id), foran: iUdbruddetVed(k, id, p.km) }));
    ud.push({
      navn: `etape ${nr} ${id} ${froe}`, id, k, rent,
      komMed: await medIUdbrud(k, id),
      efterSkift: skift ? toppe.filter((t) => t.km > skift.km) : [],
      toppe,
    });
  }
  return ud;
}

test("hul 1 + saet-led: kom han med i et senere udbrud efter skiftet, gaelder jagten paa hver top, han ligger i udbruddet ved", async () => {
  const sene = (await dage()).filter((d) => d.efterSkift.some((t) => t.foran));
  assert.ok(sene.length >= 2, "proeven skal ramme dage, hvor han kom med i et senere udbrud efter skiftet");
  for (const d of sene) {
    for (const t of d.efterSkift.filter((x) => x.foran)) assert.ok(t.jaget, `${d.navn}: laa i udbruddet ved toppen km ${t.km}, men jagten var vaek`);
  }
});

test("hul 1 + saet-led: ingen bjergjagt fra feltet, ogsaa efter skiftet", async () => {
  for (const d of await dage()) {
    for (const t of d.toppe) if (t.jaget) assert.ok(t.foran || d.k.output.groupSnapshots === undefined, `${d.navn}: koerte om toppen km ${t.km} uden at ligge i udbruddet`);
  }
});

test("hul 1 + saet-led: kom han aldrig med, er dagen praecis som samme plan uden jagt (loeb og pris)", async () => {
  const ikkeMed = (await dage()).filter((d) => !d.komMed);
  assert.ok(ikkeMed.length >= 3, "proeven skal ramme dage, hvor han ikke kom med");
  for (const d of ikkeMed) {
    assert.equal(jagede(d.k, d.id, "kom"), 0, `${d.navn}: bjergjagt uden udbrud`);
    assert.equal(betalte(d.k, d.id, "kom"), 0, `${d.navn}: betalte for en top uden udbrud`);
    assert.equal(hash(loebet(d.k)), hash(loebet(d.rent)), `${d.navn}: loebet skal vaere som uden jagt`);
    assert.equal(await pris(d.k, d.id), await pris(d.rent, d.id), `${d.navn}: prisen skal vaere som uden jagt`);
  }
});

test("hul 1 + saet-led: jagten er aldrig billigere end samme plan uden jagt", async () => {
  for (const d of await dage()) assert.ok((await pris(d.k, d.id)) >= (await pris(d.rent, d.id)), `${d.navn}: billigere med jagt`);
});
