import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #778 — Flash-auktion på egne ryttere skal kunne startes fra holdsiden.
// Backend understøttede allerede `flash_auction` (POST /api/auctions), men
// TeamPage's RiderActionModal sendte aldrig flaget. Testene her holder os
// ærlige hvis flash-flowet fjernes fra holdsiden igen:
//   1) POST-body skal indeholde flash_auction
//   2) flash-checkboxen skal være Deadline Day-gated (ddActive) ligesom
//      RiderStatsPage's AuctionButton — backend afviser flash udenfor DD (403)
//   3) TeamPage skal slå DD-status op via /api/deadline-day/status
//   4) i18n-nøglerne skal findes i BÅDE en og da (key-parity, jf. #410-guarden)

const __dirname = dirname(fileURLToPath(import.meta.url));
const teamPageSource = readFileSync(join(__dirname, "TeamPage.jsx"), "utf8");
// #3786: sluttidspunkt-vælgeren (window-fetch + endWall/endTimeIssue-validering)
// flyttede til et delt hook (useAuctionEndTimeSelector.js) så rytterprofilens
// AuctionButton kan bruge nøjagtig samme regler — se hookets filhoved.
const endTimeSelectorSource = readFileSync(join(__dirname, "..", "lib", "useAuctionEndTimeSelector.js"), "utf8");

// #2884: den oprindelige regex matchede POST-body'en med `[^}]*`, altså "frem
// til første krøllede slutparentes". Da body'en fik et nested objekt (spread af
// ends_at), stoppede matchet for tidligt og testen faldt — uden at det den
// beskytter var i stykker. Den finder nu startAuction-funktionen og asserter
// indholdet, så den fanger den ægte regression (flaget forsvinder) i stedet for
// at være bundet til hvordan body'en er formateret.
test("TeamPage auktions-POST sender flash_auction (#778) og ends_at (#2884)", () => {
  const startAuctionFn = teamPageSource.match(/async function startAuction\(\)[\s\S]*?\n {2}\}/);
  assert.ok(startAuctionFn, "startAuction-funktionen skal kunne findes i TeamPage.jsx");
  const body = startAuctionFn[0];
  assert.match(body, /rider_id:\s*rider\.id/, "auktions-POST mangler rider_id");
  assert.match(body, /starting_price/, "auktions-POST mangler starting_price");
  assert.match(
    body,
    /flash_auction/,
    "auktions-POST fra holdsiden mangler flash_auction — flash-auktion på egne ryttere kan så ikke startes derfra (#778)",
  );
  assert.match(
    body,
    /ends_at/,
    "auktions-POST mangler ends_at — sælgeren kan så ikke vælge sit eget sluttidspunkt (#2884)",
  );
});

test("TeamPage sender ikke ends_at sammen med flash_auction (#2884/#3786)", () => {
  // Backend afviser kombinationen med 400 (flash har fast 30 min). UI'et skal
  // aldrig kunne sende begge — ellers ser sælgeren en fejl han ikke kan forstå.
  // #3786: gaten er nu delt over to filer — TeamPage udelukker flash-kombinationen,
  // det delte hook udelukker et ugyldigt/tomt tidspunkt (endsAtIso = null).
  assert.match(
    teamPageSource,
    /!\(ddActive && flash\) && endsAtIso/,
    "ends_at må kun sendes når flash IKKE er valgt",
  );
  assert.match(
    endTimeSelectorSource,
    /endWall && !endTimeIssue\s*\?\s*gameWallClockToUTC\(endWall\)\.toISOString\(\)\s*:\s*null/,
    "endsAtIso må kun være sat når tidspunktet er gyldigt — ellers sender kalderen et ugyldigt ends_at",
  );
});

test("team.json har sluttidspunkt-nøgler i både en og da (#2884)", () => {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  for (const lng of ["en", "da"]) {
    const auction = JSON.parse(readFileSync(join(localesDir, lng, "team.json"), "utf8"))?.actionModal?.auction;
    for (const key of ["endLabel", "endHint", "endWindowHint"]) {
      assert.equal(typeof auction?.[key], "string", `${lng}/team.json mangler actionModal.auction.${key}`);
    }
  }
});

test("fejlbeskederne for sluttidspunkt bor KUN i errors.json (#2884)", () => {
  // Fladen validerer før POST, serveren efter. Begge veje viser samme streng —
  // en kopi i team.json ville lade de to drive fra hinanden, og den vejer i
  // language-chunken fordi alle namespaces bundles inline (#412).
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  for (const lng of ["en", "da"]) {
    const api = JSON.parse(readFileSync(join(localesDir, lng, "errors.json"), "utf8"))?.api;
    for (const key of ["auction_end_too_soon", "auction_end_too_late", "auction_end_outside_window", "auction_end_invalid"]) {
      assert.equal(typeof api?.[key], "string", `${lng}/errors.json mangler api.${key}`);
    }
    const auction = JSON.parse(readFileSync(join(localesDir, lng, "team.json"), "utf8"))?.actionModal?.auction;
    for (const key of ["endTooSoon", "endTooLate", "endOutsideWindow", "endInvalid"]) {
      assert.equal(auction?.[key], undefined, `${lng}/team.json har en dublet af api.${key}`);
    }
  }
});

test("TeamPage flash-checkbox er Deadline Day-gated via ddActive (#778)", () => {
  assert.match(
    teamPageSource,
    /\{ddActive\s*&&\s*\(/,
    "flash-valget skal kun rendres når Deadline Day er aktiv (ddActive) — backend afviser flash udenfor DD med 403",
  );
  assert.match(
    teamPageSource,
    /flash_auction:\s*ddActive\s*&&\s*flash/,
    "flash_auction må kun sendes som true når ddActive && flash — ellers 403 fra backend ved stale checkbox-state",
  );
});

test("TeamPage henter Deadline Day-status fra /api/deadline-day/status (#778)", () => {
  assert.match(
    teamPageSource,
    /\/api\/deadline-day\/status/,
    "TeamPage skal slå DD-status op (samme endpoint som RiderStatsPage) for at vide om flash-valget skal vises",
  );
});

test("team.json har flash-auktion-nøgler i både en og da (#778)", () => {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  for (const lng of ["en", "da"]) {
    const teamJson = JSON.parse(readFileSync(join(localesDir, lng, "team.json"), "utf8"));
    const auction = teamJson?.actionModal?.auction;
    assert.ok(auction, `${lng}/team.json mangler actionModal.auction`);
    for (const key of ["flashLabel", "flashHint", "startFlashButton"]) {
      assert.equal(
        typeof auction[key],
        "string",
        `${lng}/team.json mangler actionModal.auction.${key} — flash-UI'et på holdsiden viser så rå i18n-nøgler`,
      );
    }
  }
});
