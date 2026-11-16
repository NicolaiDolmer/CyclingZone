// DOMMER #7855, ejerens S2 (16/11): BJERGJAGTEN SLUTTER, NAAR HAN IKKE KOMMER MED I UDBRUDDET.
//   Ejer 16/11 (issue #7855, "Ejervalg 16/11", valg 2): "S2: jagten slutter, naar rytteren ikke
//   kommer med i udbruddet; ingen bjergjagt fra feltet (foelger valg 1 af 13/11). Nye dommerproever;
//   pas paa hul 1 (sent dannet udbrud)."
//   Ejer 13/11 (valg 1): "Kun sammen med udbrud". "Hent point" i spurterne fra feltet bliver, som det er.
//   Ejer 14/11 (hul 1): kom han med i et sent dannet udbrud, betaler han som rent udbrud plus det,
//   han faktisk koerte efter.
//
// DOMMERENS FORSIGTIGE LAESNING:
//   - "Kom ikke med": han var ikke i dagens udbrud (deltagelseshistorikken, samme kilde som
//     produktionen). Saa koerer han ikke om en eneste top, betaler intet for en top, og dagen er
//     praecis som et rent udbrud (samme loeb, samme passager, samme pris).
//   - "Ingen bjergjagt fra feltet": ogsaa naar han var med og er hentet, koerer han aldrig om en top
//     fra feltet. Hvor han laa, laeses paa motorens gruppebilleder lige foer og lige efter toppen.
//   - Hul 1: dannes udbruddet foerst sent, og kommer han med, gaelder jagten paa de toppe, han
//     ligger i udbruddet ved. Jagten slutter altsaa ikke, fordi udbruddet endnu ikke var dannet.
//   - Pointjagten ("Gaa i udbrud + Hent point") er uaendret: misser han udbruddet, koerer han
//     stadig om spurterne fra feltet (valg 3 af 13/11).
//
// Proeven kender ingen tal fra motoren. Den sammenligner kun motorens egne svar.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, fladMedSpurter, pris, jagede, betalte, passager, medIUdbrud, loebet, hash, HJAELPERE } from "./dommer7855.fixtures.mjs";

// Dommerens egne dage: bjerg- og kuperede etapeformer med flere toppe undervejs.
const ETAPER = [13, 5, 17];
const FROE = ["s2-a", "s2-b", "s2-c"];
const JAEGERE = [...HJAELPERE, "t0r4", "t1r4"]; // hjaelpere, jaeger og fri rolle (ejer 7/11: alle der maa jage bjerg)

const FORAN = new Set(["breakaway", "solo"]);
const liggerForan = (billede, id) => (billede.groups ?? []).some((g) => FORAN.has(g.kind) && g.rider_ids.includes(id));
/** Hvor laa han ved en top? Laest paa motorens gruppebilleder lige foer og lige efter. */
function stedVed(koersel, id, km) {
  const billeder = koersel.output.groupSnapshots ?? [];
  const foer = billeder.filter((b) => b.km <= km).at(-1);
  const efter = billeder.find((b) => b.km >= km);
  const svar = [foer, efter].filter(Boolean).map((b) => liggerForan(b, id));
  if (svar.length === 0) return "uklar";
  return svar.every(Boolean) ? "foran" : svar.some(Boolean) ? "uklar" : "felt";
}

// Hul 1: en etapeform, hvor udbruddet af og til foerst dannes sent, og hvor der ligger toppe efter
// (dommerens soegning over alle proeve-etaper med mindst to toppe undervejs).
const SENT_ETAPE = 107;

const cache = new Map();
/** For hver etape, rytter og froe: udbrud + Hent bjergpoint og rent udbrud, samme dag. */
async function alleDage(etaper = ETAPER, ryttere = JAEGERE) {
  const noegle = `${etaper}|${ryttere}`;
  if (cache.has(noegle)) return cache.get(noegle);
  const dage = [];
  cache.set(noegle, dage);
  for (const nr of etaper) for (const id of ryttere) for (const froe of FROE) {
    const begge = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_kom" }] } });
    const rent = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway" }] } });
    const billeder = begge.output.groupSnapshots ?? [];
    const toppe = passager(begge, "kom");
    dage.push({
      navn: `etape ${nr} ${id} ${froe}`, id,
      komMed: await medIUdbrud(begge, id),
      sent: billeder.length > 1 && !liggerForan(billeder[0], id) && billeder.slice(1).some((b) => liggerForan(b, id)),
      jaget: toppe.filter((p) => (p.hunters ?? []).includes(id)).map((p) => stedVed(begge, id, p.km)),
      foranVedTop: toppe.filter((p) => stedVed(begge, id, p.km) === "foran").map((p) => (p.hunters ?? []).includes(id)),
      jagede: jagede(begge, id, "kom"),
      betalte: betalte(begge, id, "kom"),
      sammeLoeb: hash(loebet(begge)) === hash(loebet(rent)),
      sammeTider: JSON.stringify(begge.output.results.map((r) => [r.rider_id, r.rank])) === JSON.stringify(rent.output.results.map((r) => [r.rider_id, r.rank])),
      pris: { begge: await pris(begge, id), rent: await pris(rent, id) },
    });
  }
  return dage;
}

test("S2: kom han ikke med i udbruddet, koerer han ikke om en eneste top, og dagen er som rent udbrud", async () => {
  const ikkeMed = (await alleDage()).filter((d) => !d.komMed);
  assert.ok(ikkeMed.length >= 3, "proeven skal ramme dage, hvor han ikke kom med");
  for (const d of ikkeMed) {
    assert.equal(d.jagede, 0, `${d.navn}: bjergjagt uden udbrud`);
    assert.equal(d.betalte, 0, `${d.navn}: betalte for en top uden udbrud`);
    assert.ok(d.sammeLoeb, `${d.navn}: loebet og toppene skal vaere som rent udbrud`);
    assert.equal(d.pris.begge, d.pris.rent, `${d.navn}: prisen skal vaere som rent udbrud`);
  }
});

test("S2: ingen bjergjagt fra feltet, heller ikke efter han er hentet", async () => {
  const dage = await alleDage();
  let toppe = 0;
  for (const d of dage) {
    for (const sted of d.jaget) {
      assert.notEqual(sted, "felt", `${d.navn}: koerte om en top fra feltet`);
      toppe++;
    }
  }
  assert.ok(toppe > 0, "proeven skal ramme toppe, han koerte om");
});

test("S2: i udbruddet gaelder jagten stadig (valg 1 af 13/11 staar)", async () => {
  const med = (await alleDage()).filter((d) => d.komMed && d.foranVedTop.length > 0);
  assert.ok(med.length >= 3, "proeven skal ramme dage, hvor han laa i udbruddet ved en top");
  for (const d of med) {
    assert.ok(d.jagede > 0, `${d.navn}: med i udbruddet ved en top, men koerte ikke om den`);
    assert.ok(d.sammeTider, `${d.navn}: jagten aendrer ikke udbrudsforsoeget eller placeringerne`);
    assert.ok(d.pris.begge >= d.pris.rent, `${d.navn}: jagten er aldrig billigere end rent udbrud`);
  }
});

test("S2 + hul 1: dannes udbruddet foerst sent, og kommer han med, gaelder jagten paa hver top, han ligger foran ved", async () => {
  // Motoren afgoer toppen sidst i segmentet paa gruppebilledet dér, ogsaa naar udbruddet dannes midt
  // i segmentet. Jagten maa derfor ikke vaere slut, fordi han sad i feltet ved segmentets start.
  const dage = await alleDage([SENT_ETAPE], HJAELPERE);
  const sene = dage.filter((d) => d.komMed && d.sent && d.foranVedTop.length > 0);
  assert.ok(sene.length >= 1, "proeven skal ramme et sent dannet udbrud med en top bagefter");
  for (const d of sene) {
    assert.ok(d.foranVedTop.every(Boolean), `${d.navn}: sent udbrud, laa foran ved en top, men koerte ikke om den`);
    assert.ok(d.jaget.every((sted) => sted !== "felt"), `${d.navn}: koerte om en top fra feltet`);
  }
  // Og samme etape siger det samme som resten: uden udbrud ingen bjergjagt.
  for (const d of dage.filter((x) => !x.komMed)) assert.equal(d.jagede, 0, `${d.navn}: bjergjagt uden udbrud`);
});

test("S2 roerer ikke pointjagten: misser han udbruddet med 'Gaa i udbrud + Hent point', koerer han stadig om spurterne", async () => {
  let fraFeltet = 0;
  for (const id of HJAELPERE) for (const froe of FROE) {
    const k = await koerEtape(fladMedSpurter(2), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }] } });
    if (await medIUdbrud(k, id)) continue;
    assert.ok(jagede(k, id, "sprint") > 0, `${id} ${froe}: pointjagten fra feltet er vaek`);
    fraFeltet++;
  }
  assert.ok(fraFeltet > 0, "proeven skal ramme en dag, hvor han missede udbruddet");
});

test("S2 slukket: kontakten slukket, er 'Gaa i udbrud + Hent bjergpoint' et rent udbrud (bit for bit)", async () => {
  for (const froe of FROE.slice(0, 2)) {
    const id = HJAELPERE[0];
    const raekke = { rider_id: id, effort: "normal", try_break: true, leadout: false, plan: [{ task: "breakaway", hunt: "hunt_kom" }], plan_no_hunt: [{ task: "breakaway" }] };
    const slukket = await koerEtape(etape(13), froe, { raekker: { [id]: raekke }, taendt: false });
    const rent = await koerEtape(etape(13), froe, { planer: { [id]: [{ task: "breakaway" }] }, taendt: false });
    assert.equal(hash(slukket.output.results), hash(rent.output.results), `${froe}: resultater`);
    assert.equal(hash(slukket.output.passages ?? []), hash(rent.output.passages ?? []), `${froe}: passager`);
  }
});
