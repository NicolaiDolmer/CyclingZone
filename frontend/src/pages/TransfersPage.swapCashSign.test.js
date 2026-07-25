import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2843 — spillerrapporteret 23/7 via in-game feedback-knappen (#2602), første
// rigtige indsendelse nogensinde: et bytte-MODTILBUD vendte pengeretningen om.
//
// Feltet er mærket "positive = you receive" (transfers.json cashReceiveLabel), men
// den modtagende parts send-knap negerede værdien inden den blev sendt. Konventionen
// er ÉN og den samme hele vejen:
//
//   database/schema.sql:359   -- positive = proposing pays receiving
//   transferExecution.js      const payerId = cash > 0 ? proposing : receiving
//   routes/api.js (counter)   gemmer counter_cash verbatim, ingen fortegnsskift
//
// Og inputtet prefilles med den RÅ lagrede værdi (`swap.counter_cash ??
// swap.cash_adjustment`), så input'et ER i rå konvention. En negering betød derfor
// at den modtagende part, der bad om at MODTAGE penge, i stedet blev registreret
// som betaler. Rapportøren opdagede det kun fordi modparten gennemskuede det og
// lod være med at acceptere.
//
// node --test uden DOM → kildekode-strukturel guard, samme mønster som
// TransfersPage.defaultTab.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TransfersPage.jsx"), "utf8");

test("#2843 modtilbud sender ALDRIG et negeret counter_cash", () => {
  assert.doesNotMatch(
    src,
    /counter_cash:\s*-/,
    "counter_cash må ikke negeres på vej ud — konventionen er identisk med cash_adjustment (positiv = proposing betaler receiving), og input'et prefilles med den rå lagrede værdi",
  );
});

test("#2843 begge modtilbuds-stier sender den rå værdi, så de ikke kan divergere igen", () => {
  const sendSites = [...src.matchAll(/counter_cash:\s*([-A-Za-z0-9_.]+)/g)].map((m) => m[1]);

  assert.ok(sendSites.length >= 2, `forventede mindst 2 counter_cash-sendesteder, fandt ${sendSites.length}`);
  for (const value of sendSites) {
    assert.equal(
      value,
      "counterCash",
      `hvert sendested skal sende den rå counterCash; fandt "${value}". Asymmetri mellem de to stier var netop bugget i #2843`,
    );
  }
});

test("#2843 de to perspektiv-labels er stadig forskellige (modtager vs. betaler)", () => {
  // Fortegnet er kun rigtigt fordi labelen fortæller hvad positiv betyder for
  // NETOP den part der ser feltet. Kollapser de to labels til én, er teksten
  // forkert for den ene part igen — uden at fortegnet er rørt.
  assert.match(src, /swapCard\.form\.cashReceiveLabel/, "modtagende part skal se modtager-labelen");
  assert.match(src, /swapCard\.form\.cashPayLabel/, "foreslående part skal se betaler-labelen");
});
