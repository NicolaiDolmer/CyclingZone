import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #3669 · Et FORHANDLET byttetilbud kunne ikke afvises: PATCH
// /api/transfers/swaps/:id svarede "Ugyldig handling" fordi withdraw-grenen
// kun accepterede status "pending", mens et modbudt bytte står i "countered".
// SwapCard'ets "Afvis"-knap (countered + isProposing, TransfersPage.jsx) sender
// netop `withdraw`, så knappen var død for præcis den tilstand hvor der er mest
// på spil.
//
// Selve fra-tilstandene testes som ren logik i transferExecution.test.js
// (getSwapWithdrawIssue). DENNE fil dækker wiringen: at routen faktisk spørger
// guarden i stedet for at hardcode status igen — en unit-test alene ville
// stadig være grøn hvis api.js beholdt sin egen `swap.status === "pending"`.
// Samme kilde-scannings-teknik som auctionExpiredErrorCode.routes.test.js; en
// fuld HTTP-mock ville kræve at stubbe hele supabase-kæden i handleren.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function swapPatchBlock() {
  const marker = 'router.patch("/transfers/swaps/:id"';
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route-markør "${marker}" findes ikke i api.js`);
  const end = apiSource.indexOf("router.", start + marker.length);
  assert.notEqual(end, -1, "kunne ikke afgrænse swap-PATCH-handleren");
  return apiSource.slice(start, end);
}

test("#3669 api.js importerer getSwapWithdrawIssue fra transferExecution", () => {
  const importBlock = apiSource.slice(
    apiSource.indexOf('from "../lib/transferExecution.js"') - 400,
    apiSource.indexOf('from "../lib/transferExecution.js"'),
  );
  assert.match(importBlock, /getSwapWithdrawIssue,/);
});

test("#3669 PATCH /transfers/swaps/:id — withdraw-grenen spørger guarden, ikke en hardcodet status", () => {
  const block = swapPatchBlock();

  assert.match(
    block,
    /if \(action === "withdraw" && !getSwapWithdrawIssue\(swap, \{ teamId: req\.team\.id \}\)\)/,
    "withdraw-grenen skal gate på getSwapWithdrawIssue",
  );

  // Regressions-anker: den gamle gate lukkede countered ude. Kommer den tilbage
  // (her eller i en ny gren), er det præcis bug #3669 igen.
  assert.doesNotMatch(
    block,
    /action === "withdraw"[^\n]*swap\.status === "pending"/,
    'withdraw må ikke igen hardcode status "pending" — så er et forhandlet bytte fanget igen',
  );
});

test("#3669 withdraw sætter withdrawn + updated_at og notificerer modparten om at forslaget er trukket", () => {
  const block = swapPatchBlock();
  const withdrawBranch = block.slice(block.indexOf('action === "withdraw"'));

  assert.match(withdrawBranch, /status: "withdrawn", updated_at: new Date\(\)\.toISOString\(\)/);
  // Efter et modbud VENTER modtageren på svar; uden besked ville modbuddet bare
  // forsvinde fra deres skærm (GET /transfers/swaps filtrerer withdrawn fra).
  assert.match(
    withdrawBranch,
    /notifyTeamOwnerBuilt\(swap\.receiving_team_id, transferNotif\.buildSwapPulledOutNotification\(/,
  );
});

test("#3669 notifikationens i18n-nøgler findes i BÅDE en og da locale (regressions-anker)", () => {
  const enSource = readFileSync(resolve(__dirname, "../../frontend/public/locales/en/backendMessages.json"), "utf8");
  const daSource = readFileSync(resolve(__dirname, "../../frontend/public/locales/da/backendMessages.json"), "utf8");
  assert.match(enSource, /"swapPulledOut":\s*\{/);
  assert.match(daSource, /"swapPulledOut":\s*\{/);
});
