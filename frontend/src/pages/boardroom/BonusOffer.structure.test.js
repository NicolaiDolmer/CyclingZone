import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #4557 (overblik + faner) · Bonustilbuddet (BOARD_RULES §4, lag 6) fik sit
// hjem paa den nye Boardroom-side. Guards: ingen ny mekanik, ingen ny rute,
// ingen guld-knap, ingen opdigtede tal.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "BonusOffer.jsx"), "utf8");
const apiSource = readFileSync(join(__dirname, "..", "..", "components", "board", "bonusOfferApi.js"), "utf8");

test("#4557 bonus: accept/afslag rammer de EKSISTERENDE endpoints, ingen ny rute", () => {
  assert.match(apiSource, /\/api\/board\/bonus-offer\/\$\{action\}/);
  assert.match(apiSource, /offer_id: offerId/);
  assert.match(source, /import \{ postBonusOfferAction \} from "\.\.\/\.\.\/components\/board\/bonusOfferApi\.js"/);
  assert.doesNotMatch(source, /fetch\(/, "selve kaldet bor i bonusOfferApi.js, delt med den gamle BoardPage");
});

test("#4557 bonus: ingen guld-knap (sidens ene guld er aarsmoedet) — accept er secondary, afslag er quiet", () => {
  assert.doesNotMatch(source, /variant="primary"/);
  assert.match(source, /<Button variant="secondary" size="sm" onClick=\{onAccept\} loading=\{busy\}>/);
});

test("#4557 bonus: striben vises KUN for et aktivt tilbud, kvitteringen KUN for et accepteret", () => {
  assert.match(source, /if \(!offer \|\| offer\.status !== "active"\) return null;/);
  assert.match(source, /if \(!offer \|\| offer\.status !== "accepted"\) return null;/);
});

test("#4557 bonus: beloeb og maal kommer fra payloaden, aldrig fra en hardkodet konstant (TASTE P11)", () => {
  assert.match(source, /formatCz\(offer\.amount\)/);
  assert.match(source, /resolveBonusGoalLabel\(t, offer\.extraGoal\)/);
  assert.doesNotMatch(source, /200[._]?000/, "beloebet er rows severity, ikke en tekst i UI'et");
});

test("#4557 bonus: ekstra-maalets titel gaar gennem den kanoniske resolver (aldrig raa dansk DB-tekst paa EN)", () => {
  assert.match(source, /import \{ getBoardGoalLabel \} from "\.\.\/\.\.\/lib\/boardGoalLabel"/);
  assert.match(source, /t\("bonusOffer\.defaultGoal"\)/, "manglende label falder til den eksisterende fallback-noegle");
});

test("#4557 bonus: en fejlet accept siger det, i stedet for at se ud som om intet skete (#2718-klassen)", () => {
  assert.match(source, /setFailed\(true\)/);
  assert.match(source, /t\("boardroom\.bonusOffer\.actionFailed"\)/);
});

test("#4557 bonus: en gennemfoert handling genhenter payloaden (striben forsvinder af sig selv)", () => {
  assert.match(source, /await onResolved\?\.\(\)/);
});
