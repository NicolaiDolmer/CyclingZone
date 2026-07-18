import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computeReleaseBuyoutFee, computeContractExtension } from "./contractSeed.js";

// #1719 (fyrings-/opsigelsesknap med buyout-gebyr) + #1720 (kontraktforlængelse)
// + #2179 (kontraktforlængelse direkte på akademi-ryttere, ingen op-/nedrykning).
// Rytter-handlinger på api.js der deler frontend-modal:
//   POST /api/riders/:id/release          — fyr senior-rytter (buyout-gebyr; akademi afvist, egen flow)
//   POST /api/riders/:id/extend-contract  — forlæng + genforhandl løn (senior OG akademi)
//   GET  /api/riders/:id/release-quote     — preview af gebyr (frontend-bekræftelse)
//   GET  /api/riders/:id/extend-quote      — preview af ny løn (frontend-bekræftelse)
//
// Samme statiske source-contract-stil som loanAmountValidation.routes.test.js /
// orFilterParamGuard.test.js: vi beviser at routerne findes med de rigtige
// guards og kalder de testede pure helpers — uden at booте hele Express-stakken.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(method, routePath) {
  const marker = `router.${method}("${routePath}"`;
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `route ${method.toUpperCase()} ${routePath} findes ikke i api.js`);
  const end = apiSource.indexOf("\nrouter.", start + marker.length);
  return apiSource.slice(start, end === -1 ? start + 3000 : end);
}

// ── Invariant 1: routerne findes med de korrekte guards ─────────────────────

test("POST /riders/:id/release findes med requireAuth + marketWriteLimiter", () => {
  const block = routeBlock("post", "/riders/:id/release");
  assert.match(block, /requireAuth/, "release-route skal bruge requireAuth");
  assert.match(block, /marketWriteLimiter/, "release-route skal bruge marketWriteLimiter");
});

test("POST /riders/:id/extend-contract findes med requireAuth + marketWriteLimiter", () => {
  const block = routeBlock("post", "/riders/:id/extend-contract");
  assert.match(block, /requireAuth/, "extend-route skal bruge requireAuth");
  assert.match(block, /marketWriteLimiter/, "extend-route skal bruge marketWriteLimiter");
});

test("GET /riders/:id/release-quote findes med requireAuth", () => {
  const block = routeBlock("get", "/riders/:id/release-quote");
  assert.match(block, /requireAuth/, "release-quote skal bruge requireAuth");
});

test("GET /riders/:id/extend-quote findes med requireAuth", () => {
  const block = routeBlock("get", "/riders/:id/extend-quote");
  assert.match(block, /requireAuth/, "extend-quote skal bruge requireAuth");
});

// ── Invariant 2: guard-helperne håndhæver de rigtige ejer/retired/akademi-regler ──
// #2179 splittede den tidligere fælles guard i to: release beholder
// akademi-eksklusionen (egen flow), extend gør ikke (op-/nedrykning er ikke
// længere nødvendig for at forlænge).

function helperBlock(name) {
  const marker = `async function ${name}(`;
  const start = apiSource.indexOf(marker);
  assert.notEqual(start, -1, `helper ${name} findes ikke i api.js`);
  const end = apiSource.indexOf("\n}\n", start);
  return apiSource.slice(start, end === -1 ? start + 1500 : end);
}

test("loadOwnedSeniorRiderForAction guarder owner, retired og akademi (release-flow)", () => {
  const block = helperBlock("loadOwnedSeniorRiderForAction");
  // Owner-check: rytteren skal tilhøre req.team
  assert.match(block, /rider\.team_id !== req\.team\.id/, "guard skal owner-check'e team_id === req.team.id");
  // Retired-check
  assert.match(block, /is_retired/, "guard skal afvise pensionerede ryttere");
  // Akademi-check (akademi har egen release-flow)
  assert.match(block, /is_academy/, "guard skal afvise akademi-ryttere (egen flow)");
});

test("loadOwnedRiderForExtension guarder owner + retired, men IKKE akademi (#2179)", () => {
  const block = helperBlock("loadOwnedRiderForExtension");
  assert.match(block, /rider\.team_id !== req\.team\.id/, "guard skal owner-check'e team_id === req.team.id");
  assert.match(block, /is_retired/, "guard skal afvise pensionerede ryttere");
  assert.doesNotMatch(block, /is_academy/, "extend-guarden må IKKE afvise akademi-ryttere");
});

test("release-routen kalder den delte owner/retired/akademi-guard", () => {
  const block = routeBlock("post", "/riders/:id/release");
  assert.match(block, /loadOwnedSeniorRiderForAction/, "release skal bruge den delte guard-helper");
});

test("release-routen beregner gebyret via computeReleaseBuyoutFee + blokerer ved manglende balance", () => {
  const block = routeBlock("post", "/riders/:id/release");
  assert.match(block, /computeReleaseBuyoutFee/, "release skal bruge computeReleaseBuyoutFee-helperen");
  // Balance-blokering: 4xx hvis balance < gebyr
  assert.match(block, /insufficient|afford|råd|cannot_afford/i, "release skal blokere ved utilstrækkelig balance");
  // Finance-transaktion via den atomiske RPC
  assert.match(block, /incrementBalanceWithAudit/, "release skal bogføre gebyret via incrementBalanceWithAudit");
  // Nulstil kontrakt-felter + frigør rytter
  assert.match(block, /team_id: null/, "release skal sætte team_id = NULL");
  assert.match(block, /salary: null/, "release skal nulstille salary");
});

// ── Invariant 3: extend-routen guarder owner/retired + genberegner løn ──────

test("extend-routen kalder extension-guarden (akademi tilladt) + bruger computeContractExtension", () => {
  const block = routeBlock("post", "/riders/:id/extend-contract");
  assert.match(block, /loadOwnedRiderForExtension/, "extend skal bruge #2179-guarden der IKKE afviser akademi-ryttere");
  assert.match(block, /computeContractExtension/, "extend skal bruge computeContractExtension-helperen");
});

test("extend-quote-routen kalder samme extension-guard som extend-contract", () => {
  const block = routeBlock("get", "/riders/:id/extend-quote");
  assert.match(block, /loadOwnedRiderForExtension/, "extend-quote skal bruge samme #2179-guard som POST-routen");
});

// ── Invariant 4: behaviour — genskab guard-prædikaterne ─────────────────────

// Spejler release-routens balance-guard: balance < fee → blokér.
function releaseAllowed({ balance, fee }) {
  return Number(balance) >= Number(fee);
}

test("release blokeres når balance < gebyr, tillades ellers", () => {
  const fee = computeReleaseBuyoutFee({ salary: 100_000, contractEndSeason: 5, currentSeason: 3 }); // 150k
  assert.equal(releaseAllowed({ balance: 200_000, fee }), true);
  assert.equal(releaseAllowed({ balance: 150_000, fee }), true); // = gebyr → råd nok
  assert.equal(releaseAllowed({ balance: 149_999, fee }), false);
});

test("extend producerer en højere udløbssæson + frisk løn fra værdi", () => {
  // #2594: lønnen kommer nu fra current_production_value × req.team.division-sats
  // (ikke længere market_value × 0.067).
  const next = computeContractExtension({
    current_production_value: 500_000,
    division: 3,
    contract_end_season: 3,
    contract_length: 1,
    currentSeason: 2,
  });
  assert.equal(next.contract_end_season, 4); // 3 + 1
  assert.equal(next.contract_length, 2);
  assert.equal(next.salary, 74_050); // 500_000 × 0.1481 (division 3)
});
