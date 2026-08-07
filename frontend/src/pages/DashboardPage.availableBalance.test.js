import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3508 — dashboard-headeren viste holdets RÅ team.balance, mens FinancePage
// viste en korrigeret DISPONIBEL saldo (rå minus beløb bundet i førende
// auktionsbud + proxy-max). Prod-eksempel: header viste 316.004 CZ$ mens
// ~191.000 CZ$ reelt var bundet i to aktive auktioner.
//
// Fix: reserveret/disponibel-beregningen er extraheret til en delt, testet
// helper (lib/availableBalance.js — se availableBalance.test.js for
// dækning af selve beregningen) som BÅDE FinancePage og DashboardPage nu
// bruger, så tallene aldrig kan drifte fra hinanden.
//
// Repoet kører `node --test` uden DOM-renderer, så wiringen verificeres
// kildekode-strukturelt (samme mønster som DashboardPage.goldCtaPriority.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

test("#3508 DashboardPage importerer den delte availableBalance-helper i stedet for at genopfinde beregningen", () => {
  assert.match(
    source,
    /import \{ fetchReservedBalance, computeAvailableBalance \} from "\.\.\/lib\/availableBalance\.js";/,
    "skal importere BÅDE fetchReservedBalance og computeAvailableBalance fra den delte helper",
  );
});

test("#3508 DashboardPage henter reservedBalance via fetchReservedBalance (samme queries som FinancePage)", () => {
  assert.match(
    source,
    /fetchReservedBalance\(supabase, teamData\.id\)/,
    "skal kalde den delte fetch-helper med supabase-klienten + teamData.id",
  );
  assert.match(
    source,
    /setReservedBalance\(reservedBalanceValue \|\| 0\)/,
    "skal gemme resultatet i reservedBalance-state",
  );
});

test("#3508 header-saldoen renderer computeAvailableBalance(team?.balance, reservedBalance), ikke rå team.balance", () => {
  assert.match(
    source,
    /\{formatNumber\(computeAvailableBalance\(team\?\.balance, reservedBalance\)\)\} CZ\$/,
    "det store tal i header skal være den disponible saldo, ikke rå team.balance",
  );
  assert.doesNotMatch(
    source,
    /font-mono font-bold text-xl group-hover:underline">\{formatNumber\(team\?\.balance\)\} CZ\$/,
    "rå team.balance må ikke længere renderes direkte som header-saldoen",
  );
});

test("#3508 det bundne beløb er synligt i headeren når reservedBalance > 0", () => {
  assert.match(
    source,
    /\{reservedBalance > 0 && \(/,
    "skal gate en synlig 'bundet i bud'-linje på reservedBalance > 0 (samme mønster som FinancePage's reservedBalance-gate)",
  );
  assert.match(
    source,
    /t\("dashboard:header\.lockedInBids", \{ value: formatNumber\(reservedBalance\) \}\)/,
    "skal genbruge det delte i18n-formsprog for 'låst i bud' (samme nøglenavn som FinancePage's balance.lockedInBids)",
  );
});
