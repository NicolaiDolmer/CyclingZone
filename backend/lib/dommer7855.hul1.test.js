// DOMMER #7855, HUL 1 i ejerens valg 3: UDBRUDDET DANNES FOERST SENT, OG HAN KOMMER MED.
//   Ejer natten til 14/11, svar paa kort (issue #7855): "Som rent udbrud". Kortet beskrev valget
//   saadan: "han betaler som et rent udbrud plus de spurter, han faktisk koerte efter. Ingen
//   ekstra pris, naar han ikke jagede fra feltet."
//   Ejer 13/11 (valg 3): "Samme pris" gaelder ham, der IKKE kommer med i udbruddet.
//
// Hullet (dommerens dom over de tre valg, 13/11): dannes dagens udbrud foerst et stykke inde paa
// etapen, og kommer hjaelperen med, saa taeller dagen alligevel, som om han havde jaget fra
// feltet. Han betaler mere end for et rent udbrud uden at have koert efter en eneste spurt fra
// feltet.
//
// Proeven finder de dage paa rigtige etapeformer og kraever ejerens ord:
//   - dagen taeller paa samme trin som et rent udbrud (ingen ekstra pris),
//   - dagen er aldrig billigere end et rent udbrud (spurterne kommer oveni, ikke fra),
//   - koerte han slet ikke efter en spurt, koster dagen praecis som et rent udbrud.
//
// DOMMERENS FORSIGTIGE LAESNING:
//   - "Koster" er traetheden efter etapen.
//   - "Kom med": han var i dagens udbrud. "Dannet sent": paa motorens foerste gruppebillede sad
//     han endnu i feltet, og senere laa han foran.
//   - "Ikke jagede fra feltet": hver spurt, han koerte efter, laa han foran feltet ved. Dage,
//     hvor han OGSAA koerte efter en spurt fra feltet (foer udbruddet blev dannet, eller efter det
//     blev hentet), doemmes ikke her: ejerens ord daekker dem ikke entydigt (spoergsmaal S7 og
//     dommerens nye spoergsmaal til ejeren).
//   - Hvilke spurter der koster noget, mens han ligger i udbruddet, er uaendret og doemmes ikke her.
//   - Kun hjaelpere og "Hent point", som i valg 3-proeven.
//
// Proeven kender ingen tal fra motoren. Den sammenligner kun motorens egne svar, afrundet, og
// skriver ingen priser eller forhold ud, naar den fejler.
// Skrevet FOER rettelsen. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, pris, prisPaaTrin, jagede, passager, medIUdbrud, tider, afrund, HJAELPERE } from "./dommer7855.fixtures.mjs";

// Dommerens egne dage: flade etapeformer og froe, hvor udbruddet af og til foerst dannes sent.
const ETAPER = [20, 53, 72, 78, 88, 106, 114, 117];
const FROE = ["h1-a", "h1-b", "h1-c"];
const r6 = (x) => afrund(x, 6);

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
/** For hver etape, hjaelper og froe: udbrud + Hent point og rent udbrud, samme dag. */
async function alleDage() {
  if (cache) return cache;
  cache = [];
  for (const nr of ETAPER) for (const id of HJAELPERE) for (const froe of FROE) {
    const begge = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }] } });
    const rent = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway" }] } });
    const billeder = begge.output.groupSnapshots ?? [];
    const komMed = await medIUdbrud(begge, id);
    cache.push({
      navn: `etape ${nr}`, id, froe, komMed,
      komMedRent: await medIUdbrud(rent, id),
      sent: komMed && billeder.length > 1 && !liggerForan(billeder[0], id) && billeder.slice(1).some((b) => liggerForan(b, id)),
      steder: spurtSteder(begge, id),
      jagede: jagede(begge, id, "sprint"),
      sammeLoebSomRent: JSON.stringify(tider(begge)) === JSON.stringify(tider(rent)),
      pris: { begge: await pris(begge, id), rent: await pris(rent, id), paaRentTrin: await prisPaaTrin(begge, id, rent.efforts.get(id)) },
    });
  }
  return cache;
}
/** De dage, hullet handler om: udbruddet blev dannet sent, han kom med, og han jagede ikke fra feltet. */
const seneDage = async () => (await alleDage()).filter((d) => d.sent && d.steder.every((s) => s === "foran"));

test("hul 1, forudsaetning: paa dommerens dage dannes udbruddet af og til foerst sent, og hjaelperen kommer med uden at jage fra feltet", async () => {
  const dage = await seneDage();
  assert.ok(dage.length >= 10, `kun ${dage.length} dage med et sent dannet udbrud, han kom med i; proeven ville vaere tom`);
  assert.ok(new Set(dage.map((d) => d.navn)).size >= 4, "de sene dage skal ligge paa flere etapeformer");
  for (const d of dage) {
    assert.equal(d.komMedRent, true, `${d.navn} ${d.id} ${d.froe}: jagten aendrede, om han kom med i udbruddet`);
    assert.ok(d.sammeLoebSomRent, `${d.navn} ${d.id} ${d.froe}: kom han med, er loebet det samme som rent udbrud`);
  }
});

test("hul 1 (ejer 14/11, 'Som rent udbrud'): dannes udbruddet sent, og kommer han med, taeller dagen paa samme trin som et rent udbrud", async () => {
  const fejl = [];
  for (const d of await seneDage()) {
    if (r6(d.pris.begge) !== r6(d.pris.paaRentTrin)) fejl.push(`${d.navn} ${d.id} ${d.froe}: dagen er ${d.pris.begge > d.pris.paaRentTrin ? "dyrere" : "billigere"} end samme dag paa rent udbruds trin, selv om han kom med og ikke jagede fra feltet`);
  }
  assert.deepEqual(fejl, [], "ekstra pris for en hjaelper, der kom med i udbruddet og ikke jagede fra feltet");
});

test("hul 1 (ejer 14/11): spurterne kommer oveni et rent udbrud, aldrig fra; uden en eneste spurt koster dagen praecis som et rent udbrud", async () => {
  const fejl = [];
  for (const d of await seneDage()) {
    if (r6(d.pris.begge) < r6(d.pris.rent)) fejl.push(`${d.navn} ${d.id} ${d.froe}: udbrud + Hent point er billigere end rent udbrud`);
    if (d.jagede === 0 && r6(d.pris.begge) !== r6(d.pris.rent)) fejl.push(`${d.navn} ${d.id} ${d.froe}: han koerte ikke efter en eneste spurt, men dagen koster ikke det samme som rent udbrud`);
  }
  assert.deepEqual(fejl, [], "prisen foelger ikke 'rent udbrud plus de spurter, han koerte efter'");
});
