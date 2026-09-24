// #5242 — regressionsværn for de apiFetch-netværksfejl-huller PR #5554 lukkede
// 23/9 aften (se PR-body, afsnittet "Rettelser 23/9 aften").
//
// RiderStatsPage.jsx/AuctionsPage.jsx har ingen egne testfiler (siderne er for
// store til at rendere i node --test), så disse regressionsværn testes på
// kilden — samme mønster som useBlockedAction.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), "utf8");

const riderStats = read("../pages/RiderStatsPage.jsx");
const auctions = read("../pages/AuctionsPage.jsx");
const finance = read("../pages/FinancePage.jsx");
const adminSystem = read("../pages/admin/AdminSystemTab.jsx");
const adminData = read("../pages/admin/AdminDataTab.jsx");
const founderTeams = read("useFounderTeams.js");

const THROW_LINE = 'if (res.networkError) throw res.error ?? new Error("Network request failed");';

// Bud-grenen: begge sider sender bud/proxy-handlinger via useAuctionBidding.js,
// som fanger et KAST i try/catch og viser "errors:generic.networkError" +
// reportActionFailure(reason:"network") (se useAuctionBidding.test.js). Uden
// dette kast rammer et tabt netværk i stedet den generiske resolveApiError-
// fallback og ingen network-telemetri (#3619's klasse, genopstået via #5322).
const BID_HANDLERS = [
  { page: "RiderStatsPage", src: () => riderStats, name: "handleAuctionBid", start: "async function handleAuctionBid(", end: "async function handleConfirmRaceBid()" },
  { page: "RiderStatsPage", src: () => riderStats, name: "handleSetProxy", start: "async function handleSetProxy(", end: "// #2719: se AuctionsPage.handleRemoveProxy" },
  { page: "RiderStatsPage", src: () => riderStats, name: "handleRemoveProxy", start: "async function handleRemoveProxy(auctionId) {", end: "function requestBidConfirm(" },
  { page: "AuctionsPage", src: () => auctions, name: "handleBid", start: "async function handleBid(", end: "async function handleConfirmRaceBid()" },
  { page: "AuctionsPage", src: () => auctions, name: "handleSetProxy", start: "async function handleSetProxy(", end: "// #2719: returnerer nu { ok }" },
  { page: "AuctionsPage", src: () => auctions, name: "handleRemoveProxy", start: "async function handleRemoveProxy(auctionId) {", end: "function showWatchlistError()" },
];

for (const { page, src, name, start, end } of BID_HANDLERS) {
  test(`${page}.${name}(): kaster på res.networkError, FØR res.ok/res.status læses`, () => {
    const source = src();
    const startIdx = source.indexOf(start);
    const endIdx = source.indexOf(end, startIdx);
    assert.ok(startIdx >= 0 && endIdx > startIdx, `fandt ikke ${page}.${name}()'s body`);
    const body = source.slice(startIdx, endIdx);

    const throwIdx = body.indexOf(THROW_LINE);
    assert.ok(throwIdx >= 0, `${page}.${name} skal have '${THROW_LINE}' lige efter apiFetch-kaldet (#3619)`);

    // Kun de FAKTISKE if-tjek tæller — kommentarerne omkring kastet nævner
    // bevidst `res.ok`/`res.status` i prosa, hvilket ellers ville give falske
    // positiver hvis vi lavede en bar substring-søgning.
    const firstOkOrStatusCheck = [body.indexOf("if (res.status === 409)"), body.indexOf("if (res.ok)")]
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    assert.ok(
      firstOkOrStatusCheck === undefined || throwIdx < firstOkOrStatusCheck,
      `${page}.${name}: networkError-kastet skal ligge FØR res.ok/res.status tjekkes`,
    );
  });
}

test("bud-branchen findes præcis 6 gange (3 handlere × 2 sider) — ingen glemte kaldsteder", () => {
  const total = (riderStats.match(new RegExp(THROW_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length
    + (auctions.match(new RegExp(THROW_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  assert.equal(total, 6);
});

// FinancePage: 401/429-svar uden data.error viste "Fejl: undefined", fordi
// resolveApiError/den manuelle errText-udregning ikke havde nogen fallback.
test("FinancePage submitLoan()/handleRepay(): manglende error-tekst falder tilbage til errors:generic.unknown, ikke undefined", () => {
  const hits = finance.match(/: result\.error \|\| t\("errors:generic\.unknown"\)/g) || [];
  assert.equal(hits.length, 2, "både submitLoan og handleRepay skal have fallback-teksten");
});

// RiderStatsPage: samme klasse bug i tilbud/bytte/salgsliste — resolveApiError
// blev kaldt UDEN et 3. fallback-argument.
test("RiderStatsPage tilbud/bytte/salgsliste: resolveApiError() får en fallback-tekst (ikke tom streng ved 401/429)", () => {
  const hits = riderStats.match(/resolveApiError\(data, t, t\("errors:generic\.unknown"\)\)/g) || [];
  assert.equal(hits.length, 4, "sendSwap, performSendOffer, submit og removeListing skal alle have fallback-teksten");
  assert.ok(
    !/resolveApiError\(data, t\)\)/.test(riderStats),
    "intet kaldsted må længere kalde resolveApiError uden fallback (tom fejltekst ved 401/429)",
  );
});

test("AdminSystemTab loadData(): res.data ?? { webhooks: [] } — et tomt 200-svar må ikke kaste på w.webhooks", () => {
  assert.match(adminSystem, /return res\.data \?\? \{ webhooks: \[\] \};/);
});

// CodeRabbit-fund (den ene CLI-runde, 23/9): uden dette kast blev det
// hardkodede loft (50) cachet for resten af sessionen efter ÉT tabt kald —
// catch'ens "cachedCapPromise = null; næste mount prøver igen" blev aldrig
// nået, fordi apiFetch ikke selv kaster ved en transportfejl (#5322).
test("useFounderTeams fetchFounderCap(): kaster på res.networkError, så catch nulstiller cachen i stedet for at cache fallback-loftet permanent", () => {
  const start = founderTeams.indexOf("function fetchFounderCap()");
  const end = founderTeams.indexOf("// Returnerer { founderMap, founderCap, loading }");
  assert.ok(start >= 0 && end > start, "fandt ikke fetchFounderCap()'s body");
  const body = founderTeams.slice(start, end);

  const throwIdx = body.indexOf('if (res.networkError) throw res.error ?? new Error("Network request failed");');
  const okReadIdx = body.indexOf("return res.ok ? res.data : null;");
  assert.ok(throwIdx >= 0, "fetchFounderCap skal kaste på res.networkError");
  assert.ok(throwIdx < okReadIdx, "kastet skal ligge FØR res.ok læses");
  assert.match(body, /\.catch\(\(\) => \{\s*cachedCapPromise = null;\s*return 50;\s*\}\)/);
});

test("AdminDataTab saveRaceEdit(): bruger adminErrorMessage() (status-0-guard), ikke rå `HTTP ${res.status}`", () => {
  const start = adminData.indexOf("async function saveRaceEdit()");
  const end = adminData.indexOf("async function handleDeleteRace(");
  assert.ok(start >= 0 && end > start, "fandt ikke saveRaceEdit()'s body");
  const body = adminData.slice(start, end);

  assert.match(body, /showMsg\(adminErrorMessage\(data, res\), "error"\);/);
  assert.ok(
    !/showMsg\(data\.error \|\| `HTTP \$\{res\.status\}`, "error"\);/.test(body),
    "den gamle manuelle fallback viste 'HTTP 0' ved en transportfejl (apiFetch sætter status:0)",
  );
});
