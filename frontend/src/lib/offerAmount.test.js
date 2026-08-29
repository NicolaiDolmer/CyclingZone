import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getEffectiveOfferAmount, isCounterAmount } from "./offerAmount.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// #4156 — penge på skærmen. Begge tilstande skal vise det beløb der FAKTISK
// afregnes: et almindeligt bud viser buddet, et accepteret modbud viser modbuddet.

test("#4156 almindeligt bud (intet modbud) viser buddet", () => {
  const offer = { status: "pending", offer_amount: 25000, counter_amount: null };
  assert.equal(getEffectiveOfferAmount(offer), 25000);
  assert.equal(isCounterAmount(offer), false);
});

test("#4156 åbent modbud viser modbuddet", () => {
  const offer = { status: "countered", offer_amount: 25000, counter_amount: 30000 };
  assert.equal(getEffectiveOfferAmount(offer), 30000);
  assert.equal(isCounterAmount(offer), true);
});

test("#4156 ACCEPTERET modbud viser modbuddet, ikke det oprindelige bud (selve bug-rapporten)", () => {
  // Spiller-rapporten 23/8: bud 25.000, modbud 30.000, modbuddet accepteret.
  // Statussen er ikke længere "countered", så den gamle status-betingelse faldt
  // tilbage til 25.000 mens der blev afregnet 30.000.
  for (const status of ["awaiting_confirmation", "accepted", "window_pending"]) {
    const offer = { status, offer_amount: 25000, counter_amount: 30000 };
    assert.equal(getEffectiveOfferAmount(offer), 30000, `status=${status}`);
    assert.equal(isCounterAmount(offer), true, `status=${status}`);
  }
});

test("#4156 nyt bud fra køber nulstiller modbuddet -> buddet vises igen", () => {
  // PATCH-grenen `new_offer` skriver offer_amount = det nye beløb OG
  // counter_amount = null. Visningen skal følge med tilbage til buddet.
  const offer = { status: "pending", offer_amount: 28000, counter_amount: null };
  assert.equal(getEffectiveOfferAmount(offer), 28000);
  assert.equal(isCounterAmount(offer), false);
});

test("#4156 afsluttede tilstande med modbud viser stadig modbuddet", () => {
  for (const status of ["rejected", "withdrawn"]) {
    const offer = { status, offer_amount: 25000, counter_amount: 30000 };
    assert.equal(getEffectiveOfferAmount(offer), 30000, `status=${status}`);
  }
});

test("#4156 tåler manglende data uden at kaste", () => {
  assert.equal(getEffectiveOfferAmount(null), null);
  assert.equal(getEffectiveOfferAmount(undefined), null);
  assert.equal(isCounterAmount(null), false);
  assert.equal(getEffectiveOfferAmount({ offer_amount: undefined, counter_amount: undefined }), undefined);
});

// Regressions-anker: frontendens regel SKAL være identisk med den backend
// afregner efter. Divergerer de, viser skærmen ét beløb og kontoen et andet —
// præcis den fejlklasse #4156 er.
test("#4156 reglen er ordret den samme som backends getTransferPrice", () => {
  const backendSource = readFileSync(
    resolve(__dirname, "../../../backend/lib/transferExecution.js"),
    "utf8",
  );
  assert.match(
    backendSource,
    /function getTransferPrice\(offer\)\s*\{\s*return offer\.counter_amount \|\| offer\.offer_amount;\s*\}/,
    "backendens getTransferPrice har ændret form — opdatér getEffectiveOfferAmount i samme ombæring",
  );

  const frontendSource = readFileSync(resolve(__dirname, "./offerAmount.js"), "utf8");
  assert.match(
    frontendSource,
    /return offer\.counter_amount \|\| offer\.offer_amount;/,
    "getEffectiveOfferAmount skal bruge samme udtryk som backends getTransferPrice",
  );
});

// Regressions-anker mod selve bug'en: kortene må ikke igen betinge det viste
// beløb paa status. En ren unit-test ville stadig være grøn hvis TransfersPage
// beholdt sin egen `offer.status === "countered" ? ... : ...`-visning.
test("#4156 TransfersPage viser beløbet via helperen, ikke via en status-betingelse", () => {
  const pageSource = readFileSync(
    resolve(__dirname, "../pages/TransfersPage.jsx"),
    "utf8",
  );
  assert.match(
    pageSource,
    /import \{ getEffectiveOfferAmount, isCounterAmount \} from "\.\.\/lib\/offerAmount\.js";/,
  );
  assert.doesNotMatch(
    pageSource,
    /offer\.status === "countered" \? offer\.counter_amount : offer\.offer_amount/,
    'det viste beløb må ikke igen udledes af status === "countered"',
  );
  // ReceivedOfferCard: det store beløb ER det effektive beløb.
  assert.match(pageSource, /formatNumber\(priceNum\)\} CZ\$/);
  // SentOfferCard: kun mens modbuddet STÅR ÅBENT er de to beløb konkurrerende
  // forslag. I alle andre tilstande vises det effektive beløb.
  assert.match(
    pageSource,
    /const primaryAmount = isCountered \? offer\.offer_amount : priceNum;/,
  );
  assert.match(pageSource, /formatNumber\(primaryAmount\)\} CZ\$/);
});
