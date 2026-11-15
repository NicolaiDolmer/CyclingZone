// DOMMER #7855, RUNDE 1, VAGT: DAGEN, HVOR HAN KOM MED, BLEV HENTET OG DEREFTER JAGEDE FRA FELTET,
// ER UAENDRET (dommerens spoergsmaal S7).
//   Ejeren har IKKE svaret paa S7 (issue #7855, 14/11: "S7 ... er IKKE besvaret og roeres ikke").
//   Indtil ejeren svarer, taeller dagen som paa main: paa samme trin som rent udbrud. De spurter,
//   opgaven fik ham med i, koster oveni som foer.
//
// Hvorfor proeven findes: en indsat fejl, der gav den hentede rytter jagtens trin, blev ikke
// fanget af dommerens proever (dom over PR #8155).
//
// DOMMERENS LAESNING:
//   - "Kom med": han var i dagens udbrud og laa foran paa motorens foerste gruppebillede.
//   - "Hentet og jagede derefter fra feltet": mindst en spurt, han koerte efter, laa han i feltet
//     ved (baade paa billedet foer og efter). Alle andre spurter, han koerte efter, laa han foran ved.
//   - Kun hjaelpere og "Hent point".
//
// Proeven kender ingen tal fra motoren og skriver ingen priser ud, naar den fejler.
// Svarer ejeren paa S7, skriver dommeren proeven om. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";

import { koerEtape, etape, pris, prisPaaTrin, passager, medIUdbrud, tider, afrund, HJAELPERE } from "./dommer7855.fixtures.mjs";

const ETAPER = [4, 20, 26, 36, 72, 106];
const FROE = ["s-a", "s-b", "s-c"];
const r6 = (x) => afrund(x, 6);

const FORAN = new Set(["breakaway", "solo"]);
const liggerForan = (billede, id) => (billede.groups ?? []).some((g) => FORAN.has(g.kind) && g.rider_ids.includes(id));
function stedVed(koersel, id, km) {
  const billeder = koersel.output.groupSnapshots ?? [];
  const foer = billeder.filter((b) => b.km <= km).at(-1);
  const efter = billeder.find((b) => b.km >= km);
  const svar = [foer, efter].filter(Boolean).map((b) => liggerForan(b, id));
  if (svar.length < 2) return "uklar";
  return svar.every(Boolean) ? "foran" : svar.some(Boolean) ? "uklar" : "felt";
}

let cache = null;
async function alleDage() {
  if (cache) return cache;
  cache = [];
  for (const nr of ETAPER) for (const id of HJAELPERE) for (const froe of FROE) {
    const begge = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_points" }] } });
    const billeder = begge.output.groupSnapshots ?? [];
    if (!(await medIUdbrud(begge, id)) || billeder.length < 2 || !liggerForan(billeder[0], id)) continue;
    const steder = passager(begge, "sprint").filter((p) => (p.hunters ?? []).includes(id)).map((p) => stedVed(begge, id, p.km));
    if (!steder.includes("felt") || steder.includes("uklar")) continue;
    const rent = await koerEtape(etape(nr), froe, { planer: { [id]: [{ task: "breakaway" }] } });
    cache.push({
      navn: `etape ${nr}`, id, froe,
      sammeLoebSomRent: JSON.stringify(tider(begge)) === JSON.stringify(tider(rent)),
      pris: { begge: await pris(begge, id), rent: await pris(rent, id), paaRentTrin: await prisPaaTrin(begge, id, rent.efforts.get(id)) },
    });
  }
  return cache;
}

test("hentet (S7), forudsaetning: paa dommerens dage kommer hjaelperen med, bliver hentet og koerer derefter efter en spurt fra feltet", async () => {
  const dage = await alleDage();
  assert.ok(dage.length >= 8, `kun ${dage.length} dage, hvor han blev hentet og jagede fra feltet; proeven ville vaere tom`);
  assert.ok(new Set(dage.map((d) => d.navn)).size >= 4, "dagene skal ligge paa flere etapeformer");
  for (const d of dage) assert.ok(d.sammeLoebSomRent, `${d.navn} ${d.id} ${d.froe}: kom han med, er loebet det samme som rent udbrud`);
});

test("hentet (S7, ikke besvaret af ejeren): dagen er uaendret og taeller paa samme trin som rent udbrud", async () => {
  const fejl = [];
  for (const d of await alleDage()) {
    if (r6(d.pris.begge) !== r6(d.pris.paaRentTrin)) fejl.push(`${d.navn} ${d.id} ${d.froe}: dagen er ${d.pris.begge > d.pris.paaRentTrin ? "dyrere" : "billigere"} end samme dag paa rent udbruds trin; S7 er aendret uden ejerens svar`);
    if (r6(d.pris.begge) < r6(d.pris.rent)) fejl.push(`${d.navn} ${d.id} ${d.froe}: udbrud + Hent point er billigere end rent udbrud`);
  }
  assert.deepEqual(fejl, [], "prisen for den hentede udbrudsrytter er aendret (S7 er ejerens valg)");
});
