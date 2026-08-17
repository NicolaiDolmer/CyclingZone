import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3786 — auktionens sluttidspunkt kunne kun vælges fra holdsiden (TeamPage's
// RiderActionModal, #2884). Startede spilleren auktionen fra rytterprofilen
// (AuctionButton) i stedet, fik han altid serverens globale standard-varighed
// uden at kunne se eller vælge den — jf. Discord-tråden citeret i issuet:
// "I do not have any options to chose how long the auction is" (@egomadsen).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RiderStatsPage.jsx"), "utf8");

test("AuctionButton bruger det delte useAuctionEndTimeSelector-hook (#3786)", () => {
  assert.match(
    source,
    /useAuctionEndTimeSelector\(\{\s*active:\s*open\s*\}\)/,
    "AuctionButton skal bruge samme hook (og dermed samme regler) som TeamPage's RiderActionModal",
  );
});

test("sluttidspunkt-feltet skjules under flash-auktion (#3786)", () => {
  assert.match(
    source,
    /auctionWindow && !\(ddActive && flash\) && \(/,
    "flash har sin egen faste 30-min-længde og må ikke kombineres med et valgt sluttidspunkt (samme betingelse som TeamPage.jsx)",
  );
});

test("Start-knappen spærres ved et ugyldigt sluttidspunkt (#3786)", () => {
  assert.match(
    source,
    /disabled=\{loading \|\| priceError \|\| Boolean\(!\(ddActive && flash\) && endTimeIssue\)\}/,
    "et afvist sluttidspunkt (for tidligt/sent/uden for vinduet) skal fange spilleren FØR POST'en, ikke bagefter",
  );
});

test("startAuction sender ends_at videre til POST /api/auctions (#3786)", () => {
  const startAuctionFn = source.match(/async function startAuction\([\s\S]*?\n {2}\}/);
  assert.ok(startAuctionFn, "startAuction-funktionen skal kunne findes i RiderStatsPage.jsx");
  assert.match(
    startAuctionFn[0],
    /endsAtIso\s*\?\s*\{\s*ends_at:\s*endsAtIso\s*\}\s*:\s*\{\}/,
    "ends_at skal kun sendes med når spilleren faktisk har valgt et gyldigt tidspunkt",
  );
});

test("rider.json har sluttidspunkt-nøgler i både en og da (#3786)", () => {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  for (const lng of ["en", "da"]) {
    const end = JSON.parse(readFileSync(join(localesDir, lng, "rider.json"), "utf8"))?.auctionStart?.end;
    for (const key of ["label", "hint", "windowHint"]) {
      assert.equal(typeof end?.[key], "string", `${lng}/rider.json mangler auctionStart.end.${key}`);
    }
  }
});
