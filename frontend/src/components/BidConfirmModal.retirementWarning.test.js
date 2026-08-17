import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2700: pensions-varsel i selve bud-bekræftelses-modalen (ejer-accept 22/7 på
// #2700 — "i bekræftelses-modalen, ikke kun som badge på kortet"). Badget på
// kortet (retirementRiskBadgeKey, #2943) fandtes allerede FØR denne ændring —
// gabet var udelukkende at BidConfirmModal ikke havde noget felt for det, og
// at ingen af de fire steder modalen bruges sendte tier'en med.
// node --test har ingen DOM → kildekode-strukturelle guards (samme mønster
// som TeamPage.squadTable.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const modalSrc = readFileSync(join(__dirname, "BidConfirmModal.jsx"), "utf8");
const auctionsPageSrc = readFileSync(join(__dirname, "..", "pages", "AuctionsPage.jsx"), "utf8");
const riderStatsPageSrc = readFileSync(join(__dirname, "..", "pages", "RiderStatsPage.jsx"), "utf8");
const transfersPageSrc = readFileSync(join(__dirname, "..", "pages", "TransfersPage.jsx"), "utf8");
const useAuctionBiddingSrc = readFileSync(join(__dirname, "..", "lib", "useAuctionBidding.js"), "utf8");
const localesDir = join(__dirname, "..", "..", "public", "locales");

test("BidConfirmModal accepterer retirementTier og renderer advarslen fra auctions:modal.retirementWarning.*", () => {
  assert.match(modalSrc, /retirementTier\s*=\s*null/, "prop skal have null-default (ingen advarsel som standard)");
  assert.match(
    modalSrc,
    /auctions:modal\.retirementWarning\.\$\{retirementTier\}/,
    "teksten skal slås op via i18n, ikke hardkodes i komponenten",
  );
});

test("useAuctionBidding beregner retirementTier og sender den med i BÅDE bid- og proxy-bekræftelsen", () => {
  assert.match(
    useAuctionBiddingSrc,
    /retirementTier\s*=\s*retirementBidWarningTier\(birthdate, seasonYear\)/,
    "tier skal udledes af de samme SSOT-tærskler som badget (riderAge.js)",
  );
  const bidPayload = useAuctionBiddingSrc.match(/mode:\s*"bid",[\s\S]{0,120}/);
  const proxyPayload = useAuctionBiddingSrc.match(/mode:\s*"proxy",[\s\S]{0,120}/);
  assert.ok(bidPayload && /retirementTier/.test(bidPayload[0]), "bid-bekræftelsen skal bære retirementTier med");
  assert.ok(proxyPayload && /retirementTier/.test(proxyPayload[0]), "autobud-bekræftelsen skal bære retirementTier med");
});

test("AuctionsPage sender birthdate/seasonYear ind i hooket og retirementTier videre til modalen", () => {
  assert.match(auctionsPageSrc, /birthdate:\s*r\?\.birthdate,\s*seasonYear,/);
  assert.match(auctionsPageSrc, /retirementTier=\{bidConfirm\?\.retirementTier\}/);
});

test("RiderStatsPage sender retirementTier videre for BÅDE auktions-bud-panelet og direkte transfer-tilbud", () => {
  // Auktions-bud (RiderBidPanel → useAuctionBidding, samme mønster som AuctionsPage).
  assert.match(riderStatsPageSrc, /birthdate:\s*r\?\.birthdate,\s*seasonYear,/);
  assert.match(riderStatsPageSrc, /retirementTier=\{bidConfirm\?\.retirementTier\}/);
  // Direkte transfer-tilbud (DirectOfferButton) bruger IKKE useAuctionBidding-hooket
  // og skal derfor kalde retirementBidWarningTier selv.
  assert.match(riderStatsPageSrc, /retirementTier=\{retirementBidWarningTier\(rider\.birthdate, seasonYear\)\}/);
});

test("TransfersPage (transferlistens bud-form) sender retirementTier videre til modalen", () => {
  assert.match(
    transfersPageSrc,
    /retirementTier=\{retirementBidWarningTier\(listing\.rider\?\.birthdate, seasonYear\)\}/,
  );
});

test("EN+DA auctions.json har modal.retirementWarning.risk + .certain med {windowStart}/{guaranteedAge}-interpolation", () => {
  for (const locale of ["en", "da"]) {
    const json = JSON.parse(readFileSync(join(localesDir, locale, "auctions.json"), "utf8"));
    const warning = json.modal?.retirementWarning;
    assert.ok(warning, `${locale}/auctions.json mangler modal.retirementWarning`);
    for (const tier of ["risk", "certain"]) {
      assert.equal(typeof warning[tier], "string", `${locale}/auctions.json mangler modal.retirementWarning.${tier}`);
      assert.match(warning[tier], /\{guaranteedAge\}/, `${locale} ${tier}-teksten skal bruge {guaranteedAge}, ikke et hardkodet tal`);
    }
    assert.match(warning.risk, /\{windowStart\}/, `${locale} risk-teksten skal nævne vinduets start via {windowStart}`);
  }
});
