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

test("TeamPage auktions-POST sender flash_auction (#778)", () => {
  const postBody = teamPageSource.match(/JSON\.stringify\(\{\s*rider_id:\s*rider\.id,\s*starting_price[^}]*\}\)/);
  assert.ok(postBody, "auktions-POST-body (rider_id + starting_price) skal kunne findes i TeamPage.jsx");
  assert.match(
    postBody[0],
    /flash_auction/,
    "auktions-POST fra holdsiden mangler flash_auction — flash-auktion på egne ryttere kan så ikke startes derfra (#778)",
  );
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
