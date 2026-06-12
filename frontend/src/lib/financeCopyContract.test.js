// Økonomi-copy-kontrakt — Refs #788 + #981.
//
// #788: lånerente kapitaliseres i lånet (loans.amount_remaining += interest,
// loanEngine.processLoanInterest) og trækkes ALDRIG fra saldoen — men
// transaktionsrækken viser et negativt beløb, og afdraget viser senere samme
// kroner igen. Labels SKAL derfor entydigt skelne tilskrivning (til gæld) fra
// afdrag (fra saldo), ellers ligner det dobbelt-debitering. tx.* renderes fra
// metadata-koder gemt i DB, så stringene her gælder retroaktivt for alle rækker.
//
// #981: prize-prognosen har realiseret sæson-præmie som gulv; detail-nøglen
// forecast.prizeDetail.realizedFloor skal findes i begge sprog.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const localesDir = resolve(import.meta.dirname, "../../public/locales");
const loadJson = (lang, ns) =>
  JSON.parse(readFileSync(resolve(localesDir, lang, `${ns}.json`), "utf8"));

const backendMessages = {
  en: loadJson("en", "backendMessages"),
  da: loadJson("da", "backendMessages"),
};
const dashboard = {
  en: loadJson("en", "dashboard"),
  da: loadJson("da", "dashboard"),
};

test("#788: tx.loanInterest markerer entydigt at renten lægges til gælden, ikke trækkes fra saldoen", () => {
  const en = backendMessages.en.tx.loanInterest;
  const da = backendMessages.da.tx.loanInterest;
  assert.ok(en, "EN tx.loanInterest findes");
  assert.ok(da, "DA tx.loanInterest findes");
  // Tilskrivning skal nævne gæld + afgrænse mod saldo-træk.
  assert.match(en, /debt/i, "EN nævner at renten går til gælden");
  assert.match(en, /not deducted/i, "EN afkræfter saldo-træk eksplicit");
  assert.match(da, /gæld/i, "DA nævner at renten går til gælden");
  assert.match(da, /ikke trukket/i, "DA afkræfter saldo-træk eksplicit");
  // {rate}-parameteren fra loanEngine.processLoanInterest skal stadig bruges.
  assert.match(en, /\{rate\}/, "EN beholder {rate}-param");
  assert.match(da, /\{rate\}/, "DA beholder {rate}-param");
});

test("#788: afdrags-labels forbliver betalinger (afgrænsning mod tilskrivning)", () => {
  for (const lang of ["en", "da"]) {
    for (const key of ["loanRepayment", "loanRepaymentFinal", "loanRepaymentRemaining"]) {
      const label = backendMessages[lang].tx[key];
      assert.ok(label, `${lang} tx.${key} findes`);
      assert.match(label, /paid|betalt/i, `${lang} tx.${key} er tydeligt en betaling`);
    }
  }
});

test("#981: forecast.prizeDetail.realizedFloor findes i begge sprog", () => {
  assert.ok(dashboard.en.forecast.prizeDetail?.realizedFloor, "EN-nøgle findes");
  assert.ok(dashboard.da.forecast.prizeDetail?.realizedFloor, "DA-nøgle findes");
});
