// #7982 trin 4a: det, trin 4a SKAL goere. Dommerens krav-proever (AGENTS.md regel 40), skrevet foer
// foerste kodelinje. Ejes af dommeren; byggeren aendrer dem ikke.
//
// De er ROEDE paa main (efter trin 3) med vilje, og skal vaere groenne, naar trin 4a er bygget:
//   K5  Faerre ventetider: et tryk staar og venter paa databasen faerre gange efter hinanden.
//   K6  De fire sidste dag-felter laeser ikke alt forfra: efter trykkets foerste gemme-kald venter
//       trykket hoejst 9 gange paa databasen: de fire gemme-kald, og plads til de faa laesninger,
//       der maa blive (fx skadens slutdato ved datoens sidste dag-felt).
//   K7  Faerre kald i alt: de laesninger, der forsvinder, er vaek, ikke flyttet.
// At resultatet er det samme som foer, staar i saettet (trainNowSameResult7982.test.js) og i
// proeven mod den rigtige database (trainNowDatabaseSvar7982.integration.test.js).
//
// Udvidet 13/11 efter aarsagsanalysen af trin 3 (stadig foer foerste kodelinje): de to sidste forloeb
// er et hold, hvis loebsryttere er BUNDET til et loeb paa datoens loebsdage, efter etapen er koert.
// Saadan ser et rigtigt tryk om eftermiddagen ud. For saadan et hold laeser hvert dag-felt i dag en
// kaede af fem loebs-opslag efter hinanden (15 ventetider pr. dag-felt i stedet for 10), og det er
// dér, tiden gaar om eftermiddagen. Opslagene gaelder én loebsdag hver og ligger i tabeller, trykket
// ikke selv skriver i, saa de maa flytte hen foran foerste gemme-kald; de maa ikke blive liggende
// mellem gemme-kaldene.
import test from "node:test";
import assert from "node:assert/strict";
import { seedState, createFake, SCENARIOS, countCalls } from "./trainNowSameResult7982.harness.js";

const isCommit = (entry) => entry.kind === "rpc" && entry.target.endsWith("commit_training_date_tick");

// Scenariet koeres praecis som i saettet (samme frø, samme forberedelse, samme tryk).
async function pressOnce(name) {
  const state = seedState(SCENARIOS[name].seed);
  const fake = createFake(state);
  const out = [];
  const saved = { warn: console.warn, error: console.error, info: console.info };
  console.warn = () => {}; console.error = () => {}; console.info = () => {};
  try { await SCENARIOS[name].run(state, fake, out); } finally { Object.assign(console, saved); }
  assert.equal(out.length, 1, `${name}: scenariet er ét tryk`);
  assert.equal(out[0].response.status, 200, `${name}: trykket gik igennem`);
  const firstCommit = fake.log.findIndex(isCommit);
  assert.ok(firstCommit > 0, `${name}: trykket gemte mindst ét dag-felt`);
  return { all: countCalls(fake.log), afterFirstCommit: countCalls(fake.log.slice(firstCommit + 1)), commits: fake.log.filter(isCommit).length };
}

// Lofterne. Tallet i kommentaren er main efter trin 3 (stedfortraeder, kold kontakt-cache).
const CASES = [
  // [scenarie, ventetider i alt, ventetider efter foerste gemme-kald, kald i alt]
  ["stort_hold_beta_tryk", 46 /* 78 */, 9 /* 41 */, 90 /* 144 */],
  ["stort_hold_almindeligt_tryk", 44 /* 76 */, 9 /* 41 */, 88 /* 141 */],
  ["lille_hold_uden_loeb", 38 /* 64 */, 9 /* 34 */, 82 /* 129 */],
  ["bundet_etape_koert", 52 /* 96 */, 9 /* 59 */, 125 /* 167 */],
  ["almindeligt_tryk_bundet", 52 /* 95 */, 9 /* 59 */, 125 /* 165 */],
];

for (const [name, rounds, roundsAfter, calls] of CASES) {
  test(`K5 faerre ventetider paa databasen: ${name} hoejst ${rounds} runder`, async () => {
    const { all } = await pressOnce(name);
    assert.ok(all.rounds <= rounds, `${name}: ${all.rounds} runder; trin 4a skal ned paa hoejst ${rounds}.`);
  });
  test(`K6 efter foerste gemme-kald laeses datoen ikke forfra: ${name} hoejst ${roundsAfter} runder derefter`, async () => {
    const { afterFirstCommit, commits } = await pressOnce(name);
    assert.equal(commits, 5, `${name}: fem gemme-kald, ét pr. dag-felt (de er de samme som foer)`);
    assert.ok(afterFirstCommit.rounds <= roundsAfter, `${name}: ${afterFirstCommit.rounds} runder efter foerste gemme-kald; trin 4a skal ned paa hoejst ${roundsAfter}.`);
  });
  test(`K7 faerre kald i alt: ${name} hoejst ${calls} kald`, async () => {
    const { all } = await pressOnce(name);
    assert.ok(all.total <= calls, `${name}: ${all.total} kald; trin 4a skal ned paa hoejst ${calls}.`);
  });
}
