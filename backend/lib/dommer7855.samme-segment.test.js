// DOMMER #7855, RUNDE 1: RESTHULLET I HUL 1. SPURTEN LIGGER I SAMME STYKKE AF ETAPEN, SOM DET
// NYE UDBRUD DANNES I, EFTER DANNELSEN.
//   Ejer natten til 14/11, svar paa kort (issue #7855): "Som rent udbrud". Kortet beskrev valget
//   saadan: "han betaler som et rent udbrud plus de spurter, han faktisk koerte efter. Ingen
//   ekstra pris, naar han ikke jagede fra feltet."
//
// Hullet (dommerens dom over PR #8155): morgenudbruddet er hentet, et nyt udbrud gaar, og
// hjaelperen kommer med. Dagens spurt ligger i samme segment som det nye udbrud, EFTER det sted,
// udbruddet blev dannet. Motoren afgoer spurten med ham i udbruddet. Alligevel taeller dagen,
// som om han havde jaget fra feltet.
//
// DOMMERENS FORSIGTIGE LAESNING:
//   - "Koster" er traetheden efter etapen.
//   - "Kom med": han var i dagens udbrud, og motorens haendelse for udbruddets dannelse
//     (breakaway_formed) naevner ham. "Sent": paa motorens foerste gruppebillede sad han i feltet.
//   - "Samme stykke, efter dannelsen": paa gruppebilledet foer spurten sad han i feltet, paa
//     billedet efter laa han foran, dannelsen ligger mellem de to billeder, og spurtens km er
//     stoerre end dannelsens km.
//   - Dage, hvor spurten ligger FOER dannelsens km i samme stykke, doemmes IKKE: det er et aabent
//     spoergsmaal til ejeren. Dage, hvor han ogsaa jagede en spurt fra feltet i et andet stykke,
//     doemmes heller ikke her.
//   - Kun hjaelpere og "Hent point".
//
// Proeven kender ingen tal fra motoren. Den sammenligner kun motorens egne svar, afrundet, og
// skriver ingen priser eller forhold ud, naar den fejler.
// Skrevet FOER rettelsen. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, pris, prisPaaTrin, jagede, passager, medIUdbrud, tider, afrund, HJAELPERE } from "./dommer7855.fixtures.mjs";

// Dommerens egne dage: rigtige etapeformer med etapernes egne spurter.
const ETAPER = [26, 78, 114, 135];
const FROE = ["h1-b", "h1-c", "q-9"];
const r6 = (x) => afrund(x, 6);

const FORAN = new Set(["breakaway", "solo"]);
const liggerForan = (billede, id) => (billede.groups ?? []).some((g) => FORAN.has(g.kind) && g.rider_ids.includes(id));

/** Den dannelse af dagens udbrud, han var med i (motorens egen haendelse), eller null. */
function dannelse(koersel, id) {
  const ev = (koersel.output.timeline?.events ?? []).filter((e) => e.type === "breakaway_formed" && (e.params?.rider_ids ?? []).includes(id));
  return ev.length ? ev.at(-1) : null;
}
/** Hvor koerte han spurten? "foran", "efter-dannelsen" (samme stykke, efter dannelsen) eller "andet". */
function sted(koersel, id, p, dannet) {
  const billeder = koersel.output.groupSnapshots ?? [];
  const foer = billeder.filter((b) => b.km <= p.km).at(-1);
  const efter = billeder.find((b) => b.km >= p.km);
  if (!efter || !liggerForan(efter, id)) return "andet";
  if (foer && liggerForan(foer, id)) return "foran";
  if (!foer || !dannet) return "andet";
  return dannet.km > foer.km && dannet.km <= efter.km && p.km > dannet.km ? "efter-dannelsen" : "andet";
}

let cache = null;
async function alleDage() {
  if (cache) return cache;
  cache = [];
  for (const nr of ETAPER) for (const id of HJAELPERE) for (const froe of FROE) {
    const begge = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }] } });
    const billeder = begge.output.groupSnapshots ?? [];
    if (!(await medIUdbrud(begge, id)) || billeder.length < 2 || liggerForan(billeder[0], id)) continue;
    const dannet = dannelse(begge, id);
    const steder = passager(begge, "sprint").filter((p) => (p.hunters ?? []).includes(id)).map((p) => sted(begge, id, p, dannet));
    if (!steder.includes("efter-dannelsen") || steder.includes("andet")) continue;
    const rent = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway" }] } });
    cache.push({
      navn: `etape ${nr}`, id, froe,
      komMedRent: await medIUdbrud(rent, id),
      jagede: jagede(begge, id, "sprint"),
      sammeLoebSomRent: JSON.stringify(tider(begge)) === JSON.stringify(tider(rent)),
      pris: { begge: await pris(begge, id), rent: await pris(rent, id), paaRentTrin: await prisPaaTrin(begge, id, rent.efforts.get(id)) },
    });
  }
  return cache;
}

test("samme stykke, forudsaetning: paa dommerens dage kommer hjaelperen med i et nyt udbrud, og spurten ligger i samme stykke efter dannelsen", async () => {
  const dage = await alleDage();
  assert.ok(dage.length >= 6, `kun ${dage.length} dage med spurten i samme stykke efter dannelsen; proeven ville vaere tom`);
  assert.ok(new Set(dage.map((d) => d.navn)).size >= 3, "dagene skal ligge paa flere etapeformer");
  for (const d of dage) {
    assert.equal(d.komMedRent, true, `${d.navn} ${d.id} ${d.froe}: jagten aendrede, om han kom med i udbruddet`);
    assert.ok(d.sammeLoebSomRent, `${d.navn} ${d.id} ${d.froe}: kom han med, er loebet det samme som rent udbrud`);
    assert.ok(d.jagede >= 1, `${d.navn} ${d.id} ${d.froe}: han skal have koert efter spurten`);
  }
});

test("samme stykke (ejer 14/11, 'Som rent udbrud'): spurten koert i udbruddet efter dannelsen taeller ikke som jagt fra feltet; dagen taeller paa samme trin som rent udbrud", async () => {
  const fejl = [];
  for (const d of await alleDage()) {
    if (r6(d.pris.begge) !== r6(d.pris.paaRentTrin)) fejl.push(`${d.navn} ${d.id} ${d.froe}: dagen er ${d.pris.begge > d.pris.paaRentTrin ? "dyrere" : "billigere"} end samme dag paa rent udbruds trin, selv om han koerte spurten i udbruddet`);
  }
  assert.deepEqual(fejl, [], "ekstra pris for en hjaelper, der kom med i det nye udbrud og koerte spurten derfra");
});

test("samme stykke (ejer 14/11): spurterne kommer oveni et rent udbrud, aldrig fra", async () => {
  const fejl = [];
  for (const d of await alleDage()) {
    if (r6(d.pris.begge) < r6(d.pris.rent)) fejl.push(`${d.navn} ${d.id} ${d.froe}: udbrud + Hent point er billigere end rent udbrud`);
  }
  assert.deepEqual(fejl, [], "prisen foelger ikke 'rent udbrud plus de spurter, han koerte efter'");
});
