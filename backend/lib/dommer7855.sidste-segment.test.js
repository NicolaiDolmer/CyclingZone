// DOMMER #7855, RUNDE 1, VAGT: EN SPURT I ETAPENS SIDSTE STYKKE TAELLER MED I "SAMME PRIS".
//   Ejer 13/11 (valg 3): "Samme pris". Kommer hjaelperen ikke med i udbruddet, koster jagten fra
//   feltet det samme som "Hent point" alene.
//   Ejer 7/11: opgaven taeller som hans haardeste indsats og vises som ordet Haard.
//
// Hvorfor proeven findes: en indsat fejl, der sprang spurterne i etapens sidste segment over,
// blev ikke fanget af nogen proeve (dom over PR #8155).
//
// DOMMERENS LAESNING:
//   - Spurten er dommerens egen og opdigtet: flyttet til faa km foer maal, saa den ligger i
//     etapens sidste segment (efter motorens naestsidste gruppebillede). Ingen etape i spillet har
//     en saadan spurt i dag.
//   - "Kom ikke med": han var ikke i dagens udbrud og laa aldrig foran feltet.
//   - Dagene sammenlignes kun, naar han koerte efter lige mange spurter og betalte for lige mange
//     paa begge planer, og hans oevrige arbejde er det samme.
//   - Kun hjaelpere og "Hent point".
//
// Proeven kender ingen tal fra motoren og skriver ingen priser ud, naar den fejler.
// Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, medSpurter, pris, prisPaaTrin, betalte, jagede, arbejde, passager, medIUdbrud, foranFeltet, afrund, HJAELPERE } from "./dommer7855.fixtures.mjs";

const KM_FOER_MAAL = 4;
const ETAPER = [5, 13, 20, 26, 37, 53];
const FROE = ["z1", "z2", "z3"];
const r6 = (x) => afrund(x, 6);
const sen = (nr) => medSpurter(etape(nr), [etape(nr).distance_km - KM_FOER_MAAL]);

let cache = null;
async function alleDage() {
  if (cache) return cache;
  cache = [];
  for (const nr of ETAPER) for (const id of HJAELPERE) for (const froe of FROE) {
    const begge = await koerEtape(sen(nr), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }] } });
    if ((await medIUdbrud(begge, id)) || foranFeltet(begge, id)) continue;
    const billeder = begge.output.groupSnapshots ?? [];
    const naestsidste = billeder.length > 1 ? billeder.at(-2).km : 0;
    const alene = await koerEtape(sen(nr), froe, { planer: { [id]: [{ task: "hunt_points" }] } });
    cache.push({
      navn: `etape ${nr}`, id, froe,
      iSidsteSegment: billeder.length > 1 && passager(begge, "sprint").every((p) => p.km > naestsidste),
      pris: { begge: await pris(begge, id), alene: await pris(alene, id), haard: await prisPaaTrin(begge, id, "protect") },
      jagede: { begge: jagede(begge, id, "sprint"), alene: jagede(alene, id, "sprint") },
      betalte: { begge: betalte(begge, id, "sprint"), alene: betalte(alene, id, "sprint") },
      arbejde: { begge: await arbejde(begge, id), alene: await arbejde(alene, id) },
    });
  }
  return cache;
}
const dageMedJagt = async () => (await alleDage()).filter((d) => d.iSidsteSegment && d.jagede.begge > 0);

test("sidste stykke, forudsaetning: paa dommerens dage misser hjaelpere udbruddet og koerer efter en spurt i etapens sidste segment fra feltet", async () => {
  const dage = await dageMedJagt();
  assert.ok(dage.length >= 12, `kun ${dage.length} dage med en spurt i sidste segment jaget fra feltet; proeven ville vaere tom`);
  assert.ok(new Set(dage.map((d) => d.navn)).size >= 4, "dagene skal ligge paa flere etapeformer");
});

test("sidste stykke (ejer 13/11, 'Samme pris'): en spurt i etapens sidste segment jaget fra feltet koster det samme som 'Hent point' alene", async () => {
  const fejl = [];
  let sammenlignet = 0;
  for (const d of await dageMedJagt()) {
    if (d.jagede.begge !== d.jagede.alene || d.betalte.begge !== d.betalte.alene) continue;
    if (JSON.stringify(d.arbejde.begge) !== JSON.stringify(d.arbejde.alene)) continue;
    sammenlignet++;
    if (r6(d.pris.begge) !== r6(d.pris.alene)) fejl.push(`${d.navn} ${d.id} ${d.froe}: udbrud + Hent point er ${d.pris.begge < d.pris.alene ? "billigere" : "dyrere"} end 'Hent point' alene`);
  }
  assert.ok(sammenlignet >= 10, `kun ${sammenlignet} dage kunne sammenlignes; proeven ville vaere tom`);
  assert.deepEqual(fejl, [], "to priser for samme jagt fra feltet (spurten i sidste segment er ikke talt med)");
});

test("sidste stykke (ejer 7/11 og 13/11): har han jaget spurten fra feltet, er dagen aldrig billigere end Haard", async () => {
  const fejl = [];
  for (const d of await dageMedJagt()) {
    if (r6(d.pris.begge) < r6(d.pris.haard)) fejl.push(`${d.navn} ${d.id} ${d.froe}: dagen er billigere end samme dag paa Haard, selv om han jagede spurten fra feltet`);
  }
  assert.deepEqual(fejl, [], "jagten fra feltet er billigere end Haard (spurten i sidste segment er ikke talt med)");
});
