// DOMMER #7855, RUNDE 1, VAGT: "SAMME PRIS" GAELDER KUN HJAELPEREN, INDTIL EJEREN HAR SVARET (S6).
//   Ejer 13/11 (valg 3): "Samme pris". Kommer HJAELPEREN ikke med i udbruddet, koster jagten fra
//   feltet det samme som "Hent point" alene.
//   Dommerens spoergsmaal S6 (om det ogsaa gaelder jaeger og fri rolle) er ikke besvaret. De
//   kaemper om spurterne af sig selv, og opgaven aendrer intet for dem. Indtil ejeren svarer,
//   taeller deres dag som paa main: paa samme trin som rent udbrud.
//
// Hvorfor proeven findes: en indsat fejl, der lod "samme pris" ramme alle roller, blev ikke fanget
// af dommerens proever (dom over PR #8155).
//
// DOMMERENS LAESNING:
//   - Rytterne er jaegere og frie roller paa menneskeholdene med "Gaa i udbrud + Hent point".
//   - "Kom ikke med": han var ikke i dagens udbrud og laa aldrig foran feltet. Han koerte efter
//     mindst en spurt.
//
// Proeven kender ingen tal fra motoren og skriver ingen priser ud, naar den fejler.
// Svarer ejeren paa S6, skriver dommeren proeven om. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, pris, prisPaaTrin, jagede, medIUdbrud, foranFeltet, tider, afrund, rolleAf } from "./dommer7855.fixtures.mjs";

const RYTTERE = ["t0r4", "t0r5", "t1r4", "t1r5"];
const ETAPER = [1, 5, 20, 26];
const FROE = ["ro-a", "ro-b", "ro-c"];
const r6 = (x) => afrund(x, 6);

let cache = null;
async function alleDage() {
  if (cache) return cache;
  cache = [];
  for (const nr of ETAPER) for (const id of RYTTERE) for (const froe of FROE) {
    const begge = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }] } });
    if ((await medIUdbrud(begge, id)) || foranFeltet(begge, id) || jagede(begge, id, "sprint") === 0) continue;
    const rent = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway" }] } });
    cache.push({
      navn: `etape ${nr}`, id, froe, rolle: rolleAf(id),
      sammeLoebSomRent: JSON.stringify(tider(begge)) === JSON.stringify(tider(rent)),
      pris: { begge: await pris(begge, id), rent: await pris(rent, id), paaRentTrin: await prisPaaTrin(begge, id, rent.efforts.get(id)) },
    });
  }
  return cache;
}

test("roller (S6), forudsaetning: rytterne er jaegere og frie roller, og paa dommerens dage misser de udbruddet og koerer efter en spurt fra feltet", async () => {
  for (const id of RYTTERE) assert.ok(["hunter", "free_role"].includes(rolleAf(id)), `${id} er hverken jaeger eller fri rolle`);
  const dage = await alleDage();
  assert.ok(dage.length >= 8, `kun ${dage.length} dage; proeven ville vaere tom`);
  assert.ok(dage.some((d) => d.rolle === "hunter"), "ingen dage med en jaeger");
  assert.ok(dage.some((d) => d.rolle === "free_role"), "ingen dage med en fri rolle");
  for (const d of dage) assert.ok(d.sammeLoebSomRent, `${d.navn} ${d.id} ${d.froe}: jagten aendrede loebet for en rolle, der kaemper i forvejen`);
});

test("roller (S6, ikke besvaret af ejeren): 'samme pris' rammer ikke jaeger og fri rolle; dagen taeller paa samme trin som rent udbrud", async () => {
  const fejl = [];
  for (const d of await alleDage()) {
    if (r6(d.pris.begge) !== r6(d.pris.paaRentTrin)) fejl.push(`${d.navn} ${d.id} (${d.rolle}) ${d.froe}: dagen er ${d.pris.begge > d.pris.paaRentTrin ? "dyrere" : "billigere"} end samme dag paa rent udbruds trin; S6 er aendret uden ejerens svar`);
    if (r6(d.pris.begge) < r6(d.pris.rent)) fejl.push(`${d.navn} ${d.id} (${d.rolle}) ${d.froe}: udbrud + Hent point er billigere end rent udbrud`);
  }
  assert.deepEqual(fejl, [], "'samme pris' rammer andre roller end hjaelperen (S6 er ejerens valg)");
});
