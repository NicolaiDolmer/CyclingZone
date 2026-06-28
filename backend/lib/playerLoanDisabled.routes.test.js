import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #1948: Spiller-initierede finanslån er fjernet. UI-knappen ("Optag lån") er taget væk,
// og POST /finance/loans er hård-deaktiveret (svarer 403 player_loans_disabled). Nødlån
// gives automatisk via createEmergencyLoan (cron). Denne fil er en FORWARD-GUARD: den
// fejler hvis ruten nogensinde gen-aktiveres til at oprette spiller-lån (kalder createLoan),
// så misbrugsvinduet (en spiller der trækker op til gældsloftet lige før et løb) ikke kan
// snige sig tilbage. Erstatter den tidligere loanAmountValidation.routes.test.js, hvis
// amount-parsing-hærdning er moot når ruten er lukket.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

// Bemærk: både GET og POST registrerer "/finance/loans". Vi rammer POST-blokken (optag lån)
// fra den eksplicitte router.post-markør og frem til næste route-registrering.
function postRouteBlock(routePath) {
  const marker = `router.post("${routePath}"`;
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route POST ${routePath} findes ikke i api.js`);
  const end = apiSource.indexOf("router.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 1200 : end);
}

test("POST /finance/loans er deaktiveret (#1948) — returnerer player_loans_disabled", () => {
  const block = postRouteBlock("/finance/loans");
  assert.match(
    block,
    /errorCode: "player_loans_disabled"/,
    "ruten skal returnere errorCode player_loans_disabled (403)",
  );
});

test("POST /finance/loans opretter IKKE længere spiller-lån (createLoan væk)", () => {
  const block = postRouteBlock("/finance/loans");
  assert.doesNotMatch(
    block,
    /createLoan\(/,
    "POST /finance/loans må ikke kalde createLoan — spiller-initierede lån er fjernet",
  );
});
