// DOMMER #7855, HUL 2 i ejerens valg 3 (13/11): EN TIDLIG SPURT, JAGET FRA FELTET, SKAL TAELLES.
//   Ejer 13/11 (valg 3): "Samme pris". Kommer hjaelperen ikke med i udbruddet, koster jagten fra
//   feltet det samme som "Hent point" alene.
//   Ejer 7/11: opgaven koeres paa samme indsatstrin som tempo og foelg med, og efter etapen taeller
//   leddet som hans haardeste indsats. Vist som ordet Haard.
//
// Hullet (fundet af Codex og genskabt af dommeren 13/11): ligger en indlagt spurt helt i starten
// af etapen, og har planen "Gaa i udbrud + Hent point" efterfulgt af et led "naar han er sat", saa
// jager hjaelperen spurten fra feltet, men dagen taeller, som om han aldrig havde jaget. Samme
// jagt fra feltet har altsaa stadig to priser i det hjoerne.
//
// Proeven gentager dommerens R9 (samme pris) og R8 (aldrig billigere end Haard) for netop de dage:
// en indlagt spurt tidligt paa etapen, og et led "naar han er sat" efter udbrudsleddet.
//
// DOMMERENS FORSIGTIGE LAESNING (som i valg 3-proeven):
//   - "Koster" er traetheden efter etapen.
//   - Kun hjaelpere og "Hent point" (ejerens ord naevner dem). Bjergjagt, jaeger og fri rolle
//     proeves ikke her.
//   - "Kom ikke med": han var hverken i dagens udbrud eller paa noget tidspunkt foran feltet.
//   - Prisen sammenlignes kun paa dage, der kan sammenlignes: samme etape, samme froe, samme led
//     bagefter, han koerte efter lige mange spurter paa begge planer, og hans oevrige arbejde
//     (andel i front og i grupetto) var det samme.
//   - Etaperne har en opdigtet tidlig spurt. Ingen etape i spillet har en saa tidlig spurt i dag.
//
// Proeven kender ingen tal fra motoren. Den sammenligner kun motorens egne svar, afrundet, og
// skriver ingen priser eller forhold ud, naar den fejler.
// Skrevet FOER rettelsen. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, medSpurter, pris, prisPaaTrin, betalte, jagede, arbejde, medIUdbrud, foranFeltet, afrund, HJAELPERE } from "./dommer7855.fixtures.mjs";

const FROE = ["hul2-a", "hul2-b", "hul2-c", "hul2-d"];
const r6 = (x) => afrund(x, 6);

// Dommerens egne dage: rigtige etapeformer, hvor den ene indlagte spurt er flyttet helt frem.
const TIDLIG_SPURT_KM = 10;
const ETAPER = [
  ["flad", () => medSpurter(etape(20), [TIDLIG_SPURT_KM])],
  ["flad (b)", () => medSpurter(etape(26), [TIDLIG_SPURT_KM])],
  ["rullende", () => medSpurter(etape(37), [TIDLIG_SPURT_KM])],
  ["kuperet", () => medSpurter(etape(5), [TIDLIG_SPURT_KM])],
  ["bjerg", () => medSpurter(etape(13), [TIDLIG_SPURT_KM])],
];
// Leddet efter udbrudsleddet. Alle fire er "naar han er sat" og er lettere end Haard.
const NAAR_SAT = { at: "dropped" };
const HALER = [
  ["Koer roligt i maal, naar han er sat", { task: "ride_in", from: NAAR_SAT }],
  ["Bliv i laeet, naar han er sat", { task: "stay_sheltered", from: NAAR_SAT }],
  ["Hold lederen fremme, naar han er sat", { task: "shelter_leader", from: NAAR_SAT }],
  ["Grupetto, naar han er sat", { task: "grupetto", from: NAAR_SAT }],
];

let cache = null;
/** For hver etape, hale, hjaelper og froe: udbrud + Hent point og Hent point alene, begge med samme led bagefter. */
async function alleDage() {
  if (cache) return cache;
  cache = [];
  for (const [navn, row] of ETAPER) for (const [haleNavn, hale] of HALER) {
    for (const id of HJAELPERE) for (const froe of FROE) {
      const begge = await koerEtape(row(), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }, hale] } });
      const alene = await koerEtape(row(), froe, { planer: { [id]: [{ task: "hunt_points" }, hale] } });
      cache.push({
        navn, haleNavn, id, froe,
        ikkeMed: !(await medIUdbrud(begge, id)) && !foranFeltet(begge, id),
        pris: { begge: await pris(begge, id), alene: await pris(alene, id), haard: await prisPaaTrin(begge, id, "protect") },
        jagede: { begge: jagede(begge, id, "sprint"), alene: jagede(alene, id, "sprint") },
        betalte: { begge: betalte(begge, id, "sprint"), alene: betalte(alene, id, "sprint") },
        arbejde: { begge: await arbejde(begge, id), alene: await arbejde(alene, id) },
      });
    }
  }
  return cache;
}

test("hul 2, forudsaetning: paa dommerens dage misser hjaelpere udbruddet og koerer alligevel efter den tidlige spurt fra feltet", async () => {
  const pr = new Map();
  for (const d of await alleDage()) if (d.ikkeMed && d.jagede.begge > 0) pr.set(d.navn, (pr.get(d.navn) ?? 0) + 1);
  for (const [navn] of ETAPER) assert.ok((pr.get(navn) ?? 0) >= 4, `${navn}: for faa dage med en tidlig spurt jaget fra feltet (${pr.get(navn) ?? 0}); proeven ville vaere tom`);
});

test("hul 2 (ejer 13/11, valg 3 'Samme pris'): en tidlig spurt jaget fra feltet koster det samme som 'Hent point' alene, ogsaa med et led 'naar han er sat' bagefter", async () => {
  const fejl = [];
  let sammenlignet = 0;
  const prHale = new Map();
  for (const d of await alleDage()) {
    if (!d.ikkeMed) continue; // han kom med: ikke dette hul
    if (d.jagede.begge === 0 || d.jagede.begge !== d.jagede.alene || d.betalte.begge !== d.betalte.alene) continue;
    if (JSON.stringify(d.arbejde.begge) !== JSON.stringify(d.arbejde.alene)) continue;
    sammenlignet++;
    prHale.set(d.haleNavn, (prHale.get(d.haleNavn) ?? 0) + 1);
    if (r6(d.pris.begge) !== r6(d.pris.alene)) fejl.push(`${d.navn}, ${d.haleNavn}, ${d.id} ${d.froe}: udbrud + Hent point er ${d.pris.begge < d.pris.alene ? "billigere" : "dyrere"} end 'Hent point' alene (${d.jagede.begge} spurt fra feltet paa begge)`);
  }
  assert.ok(sammenlignet >= 40, `kun ${sammenlignet} dage kunne sammenlignes; proeven ville vaere tom`);
  for (const [haleNavn] of HALER.slice(0, 3)) assert.ok((prHale.get(haleNavn) ?? 0) >= 8, `${haleNavn}: for faa dage kunne sammenlignes (${prHale.get(haleNavn) ?? 0})`);
  assert.deepEqual(fejl, [], "to priser for samme jagt fra feltet (den tidlige spurt er ikke talt med)");
});

test("hul 2 (ejer 7/11 og 13/11): har han jaget en spurt fra feltet, er dagen aldrig billigere end Haard, uanset leddet bagefter", async () => {
  const fejl = [];
  let dage = 0;
  for (const d of await alleDage()) {
    if (!d.ikkeMed || d.jagede.begge === 0) continue;
    dage++;
    if (r6(d.pris.begge) < r6(d.pris.haard)) fejl.push(`${d.navn}, ${d.haleNavn}, ${d.id} ${d.froe}: dagen er billigere end samme dag paa Haard, selv om han jagede ${d.jagede.begge} spurt fra feltet`);
  }
  assert.ok(dage >= 60, `kun ${dage} dage med en spurt jaget fra feltet; proeven ville vaere tom`);
  assert.deepEqual(fejl, [], "jagten fra feltet er billigere end Haard (den tidlige spurt er ikke talt med)");
});
