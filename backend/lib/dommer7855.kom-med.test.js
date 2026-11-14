// DOMMER #7855, ejerens valg 3: "SAMME PRIS" MAA ALDRIG RAMME HAM, DER KOM MED I UDBRUDDET.
//   Ejer 13/11 (valg 3): "Samme pris". Kommer hjaelperen IKKE med i udbruddet, koster jagten fra
//   feltet det samme som "Hent point" alene.
//   Ejer natten til 14/11 (hul 1, svar paa kort): "Som rent udbrud". "han betaler som et rent
//   udbrud plus de spurter, han faktisk koerte efter. Ingen ekstra pris, naar han ikke jagede fra
//   feltet."
//   Ejer 12/11 (valg 1): udbrud og jagt sammen (kommer han med, er loebet det samme).
//
// Hvorfor proeven findes: dommerens foerste proever fangede ikke en indsat fejl, hvor "samme
// pris" ogsaa ramte ham, der kom med i udbruddet (prisen steg for udbrudsrytteren). Denne proeve
// lukker det hul i proeverne: paa ALLE dage, hvor hjaelperen kom med, tidligt eller sent dannet
// udbrud, med og uden et led bagefter, skal dagen taelle paa samme trin som rent udbrud.
//
// DOMMERENS FORSIGTIGE LAESNING:
//   - "Koster" er traetheden efter etapen.
//   - "Kom med": han var i dagens udbrud.
//   - Dage, hvor han ogsaa koerte efter en spurt fra feltet (foer udbruddet blev dannet, eller
//     efter det blev hentet), doemmes ikke her: ejerens ord daekker dem ikke entydigt (spoergsmaal
//     S7 og dommerens nye spoergsmaal til ejeren).
//   - Hvilke spurter der koster noget, mens han ligger i udbruddet, er uaendret og doemmes ikke her.
//   - Kun hjaelpere og "Hent point", som i valg 3-proeven.
//
// Proeven kender ingen tal fra motoren. Den sammenligner kun motorens egne svar, afrundet, og
// skriver ingen priser eller forhold ud, naar den fejler.
// Skrevet FOER rettelsen. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, pris, prisPaaTrin, jagede, passager, medIUdbrud, tider, afrund, HJAELPERE } from "./dommer7855.fixtures.mjs";

const FROE = ["h1-a", "h1-b", "h1-c"];
const r6 = (x) => afrund(x, 6);
// Rigtige etapeformer. Paa den flade dannes udbruddet af og til foerst sent (hul 1).
const ETAPER = [
  ["flad", () => etape(53)],
  ["rullende", () => etape(37)],
  ["kuperet", () => etape(5)],
  ["bjerg", () => etape(13)],
];
// Leddet efter udbrudsleddet (ens paa begge planer).
const HALER = [
  ["et led", null],
  ["Koer roligt i maal, naar han er sat", { task: "ride_in", from: { at: "dropped" } }],
  ["Koer roligt i maal, de sidste km", { task: "ride_in", from: { at: "final_km" } }],
];

const FORAN = new Set(["breakaway", "solo"]);
const liggerForan = (billede, id) => (billede.groups ?? []).some((g) => FORAN.has(g.kind) && g.rider_ids.includes(id));
/** Hvor laa han ved et punkt paa ruten? Laest paa motorens gruppebilleder lige foer og lige efter. */
function stedVed(koersel, id, km) {
  const billeder = koersel.output.groupSnapshots ?? [];
  const foer = billeder.filter((b) => b.km <= km).at(-1);
  const efter = billeder.find((b) => b.km >= km);
  const svar = [foer, efter].filter(Boolean).map((b) => liggerForan(b, id));
  if (svar.length === 0) return "uklar";
  return svar.every(Boolean) ? "foran" : svar.some(Boolean) ? "uklar" : "felt";
}
/** Hver spurt, han koerte efter: laa han foran feltet ved den? */
const spurtSteder = (koersel, id) => passager(koersel, "sprint").filter((p) => (p.hunters ?? []).includes(id)).map((p) => stedVed(koersel, id, p.km));

let cache = null;
/** For hver etape, hale, hjaelper og froe: udbrud + Hent point og rent udbrud, samme dag og samme led bagefter. */
async function alleDage() {
  if (cache) return cache;
  cache = [];
  for (const [navn, row] of ETAPER) for (const [haleNavn, hale] of HALER) {
    for (const id of HJAELPERE) for (const froe of FROE) {
      const begge = await koerEtape(row(), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }, ...(hale ? [hale] : [])] } });
      const rent = await koerEtape(row(), froe, { planer: { [id]: [{ task: "breakaway" }, ...(hale ? [hale] : [])] } });
      const billeder = begge.output.groupSnapshots ?? [];
      const komMed = await medIUdbrud(begge, id);
      cache.push({
        navn, haleNavn, id, froe, komMed,
        komMedRent: await medIUdbrud(rent, id),
        sent: komMed && billeder.length > 1 && !liggerForan(billeder[0], id),
        steder: spurtSteder(begge, id),
        jagede: jagede(begge, id, "sprint"),
        sammeLoebSomRent: JSON.stringify(tider(begge)) === JSON.stringify(tider(rent)),
        pris: { begge: await pris(begge, id), rent: await pris(rent, id), paaRentTrin: await prisPaaTrin(begge, id, rent.efforts.get(id)) },
      });
    }
  }
  return cache;
}
/** Dage, hvor han kom med i udbruddet og ikke koerte efter nogen spurt fra feltet. */
const medDage = async () => (await alleDage()).filter((d) => d.komMed && d.steder.every((s) => s === "foran"));
const hvor = (d) => `${d.navn}, ${d.haleNavn}, ${d.id} ${d.froe}${d.sent ? " (udbruddet dannet sent)" : ""}`;

test("kom med, forudsaetning: dagene daekker mange hjaelpere, der kom med, paa alle etapeformer og med alle led bagefter", async () => {
  const dage = await medDage();
  assert.ok(dage.length >= 60, `kun ${dage.length} dage, hvor han kom med uden at jage fra feltet; proeven ville vaere tom`);
  for (const [navn] of ETAPER) assert.ok(dage.filter((d) => d.navn === navn).length >= 4, `${navn}: for faa dage, hvor han kom med`);
  for (const [haleNavn] of HALER) assert.ok(dage.filter((d) => d.haleNavn === haleNavn).length >= 12, `${haleNavn}: for faa dage, hvor han kom med`);
  assert.ok(dage.filter((d) => !d.sent).length >= 40, "for faa dage med et udbrud dannet fra start");
  assert.ok(dage.filter((d) => d.sent).length >= 4, "for faa dage med et sent dannet udbrud");
  assert.ok(dage.filter((d) => d.jagede > 0).length >= 20, "for faa dage, hvor han koerte efter en spurt fra udbruddet");
  for (const d of dage) {
    assert.equal(d.komMedRent, true, `${hvor(d)}: jagten aendrede, om han kom med i udbruddet`);
    assert.ok(d.sammeLoebSomRent, `${hvor(d)}: kom han med, er loebet det samme som rent udbrud`);
  }
});

test("kom med (ejer 13/11 og 14/11): 'samme pris' rammer aldrig ham, der kom med; dagen taeller paa samme trin som rent udbrud", async () => {
  const fejl = [];
  for (const d of await medDage()) {
    if (r6(d.pris.begge) !== r6(d.pris.paaRentTrin)) fejl.push(`${hvor(d)}: dagen er ${d.pris.begge > d.pris.paaRentTrin ? "dyrere" : "billigere"} end samme dag paa rent udbruds trin, selv om han kom med og ikke jagede fra feltet`);
  }
  assert.deepEqual(fejl, [], "ekstra pris for en hjaelper, der kom med i udbruddet");
});

test("kom med (ejer 14/11): spurterne kommer oveni et rent udbrud, aldrig fra; uden en eneste spurt koster dagen praecis som et rent udbrud", async () => {
  const fejl = [];
  for (const d of await medDage()) {
    if (r6(d.pris.begge) < r6(d.pris.rent)) fejl.push(`${hvor(d)}: udbrud + Hent point er billigere end rent udbrud`);
    if (d.jagede === 0 && r6(d.pris.begge) !== r6(d.pris.rent)) fejl.push(`${hvor(d)}: han koerte ikke efter en eneste spurt, men dagen koster ikke det samme som rent udbrud`);
  }
  assert.deepEqual(fejl, [], "prisen foelger ikke 'rent udbrud plus de spurter, han koerte efter'");
});
