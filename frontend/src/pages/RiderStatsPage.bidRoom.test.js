import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3066 — rytterprofilens bud-panel (RiderBidPanel) havde INGEN bud-plads-gate
// (computeBidRoom), i modsætning til AuctionsPage.jsx's AuctionRow/AuctionCard.
// En spiller med fuld trup kunne derfor sende et bud fra rytterprofilen som
// serveren garanteret afviser (getAuctionBidRoomBlock, backend/lib/auctionRules.js)
// uden at se hvorfor først — kun AuctionsPage viste "Din senior-trup er fuld"/
// "Ingen plads i dit akademi eller senior-trup" FØR POST'en.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RiderStatsPage.jsx"), "utf8");

test("RiderBidPanel bruger computeBidRoom (#3066)", () => {
  assert.match(
    source,
    /computeBidRoom\(\{\s*isYouth:\s*auction\.is_youth,\s*seniorCount,\s*academyCount\s*\}\)/,
    "RiderBidPanel skal spejle samme bud-plads-gate som AuctionsPage.jsx (AuctionRow/AuctionCard)",
  );
});

test("RiderBidPanel skjuler bud-/autobud-UI'et når pladsen er fuld (#3066)", () => {
  assert.match(
    source,
    /roomBlocked\s*\?\s*\(\s*<BidRoomBlockNotice reason=\{bidRoom\.reason\} t=\{t\} \/>/,
    "et bud der er garanteret afvist (fuld trup) skal blokeres FØR POST'en, ikke bare fejle pænere bagefter",
  );
});

test("RiderStatsPage henter senior-/akademi-optælling til gaten (#3066)", () => {
  assert.match(
    source,
    /eq\("team_id", t\.id\)\.eq\("is_academy", false\)\.eq\("is_retired", false\)/,
    "senior-optællingen skal matche backendens getTeamMarketState (akademi + pensionerede tæller ikke med, #1308/#2748)",
  );
  assert.match(
    source,
    /eq\("team_id", t\.id\)\.eq\("is_academy", true\)/,
    "akademi-optællingen mangler — uden den kan youth-auktioners akademi-fallback ikke vises",
  );
});

test("auction-selecten henter is_youth, ellers er computeBidRoom altid ikke-youth (#3066)", () => {
  assert.match(
    source,
    /\.select\(`id, current_price, min_increment, calculated_end, status, is_guaranteed_sale, is_flash, is_youth,/,
    "loadActiveAuctionFull skal hente is_youth — ellers falder youth-auktioner altid tilbage til den strengere ikke-youth-gate",
  );
});
